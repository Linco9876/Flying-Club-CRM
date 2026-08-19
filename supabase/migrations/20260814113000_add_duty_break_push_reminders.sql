-- Send Duty Clock PWA reminders from the server so they are delivered even
-- while the installed app is asleep. Reminders use the club's live fatigue
-- policy and are idempotent per active duty period.

create table if not exists private.duty_break_notification_events (
  id uuid primary key default gen_random_uuid(),
  duty_period_id uuid not null references public.duty_periods(id) on delete cascade,
  instructor_id uuid not null references public.users(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('warning', 'due')),
  notification_id uuid references public.notifications(id) on delete set null,
  notified_at timestamptz not null default now(),
  unique (duty_period_id, reminder_kind)
);

revoke all on table private.duty_break_notification_events from public, anon, authenticated;
grant all on table private.duty_break_notification_events to service_role;

create or replace function private.dispatch_due_duty_break_notifications()
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_rules public.booking_rules_settings%rowtype;
  v_required_minutes integer;
  v_minimum_break_minutes integer;
  v_duty record;
  v_due_at timestamptz;
  v_warning_at timestamptz;
  v_kind text;
  v_event_id uuid;
  v_notification_id uuid;
  v_count integer := 0;
begin
  select * into v_rules
  from public.booking_rules_settings
  order by created_at
  limit 1;

  if not coalesce(v_rules.fatigue_rules_enabled, true) then
    return 0;
  end if;

  v_required_minutes := round(coalesce(v_rules.fatigue_break_required_after_hours, 5) * 60);
  v_minimum_break_minutes := coalesce(v_rules.fatigue_min_break_minutes, 30);

  for v_duty in
    select period.id, period.instructor_id, period.actual_start
    from public.duty_periods period
    where period.status = 'active'
      and period.actual_start is not null
    order by period.actual_start
  loop
    if not exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = v_duty.instructor_id
        and subscription.app_scope = 'duty_clock'
        and subscription.revoked_at is null
        and (subscription.expiration_time is null or subscription.expiration_time > now())
    ) then
      continue;
    end if;

    if exists (
      select 1
      from public.duty_breaks duty_break
      where duty_break.duty_period_id = v_duty.id
        and duty_break.break_start >= v_duty.actual_start
        and extract(epoch from (duty_break.break_end - duty_break.break_start)) / 60
          >= v_minimum_break_minutes
    ) or exists (
      select 1
      from public.duty_break_sessions session
      where session.duty_period_id = v_duty.id
        and session.instructor_id = v_duty.instructor_id
        and session.ended_at is null
    ) then
      continue;
    end if;

    v_due_at := v_duty.actual_start + make_interval(mins => v_required_minutes);
    v_warning_at := v_due_at - interval '30 minutes';
    v_kind := case
      when clock_timestamp() >= v_due_at then 'due'
      when clock_timestamp() >= v_warning_at then 'warning'
      else null
    end;

    if v_kind is null then
      continue;
    end if;

    insert into private.duty_break_notification_events(
      duty_period_id,
      instructor_id,
      reminder_kind
    ) values (
      v_duty.id,
      v_duty.instructor_id,
      v_kind
    )
    on conflict (duty_period_id, reminder_kind) do nothing
    returning id into v_event_id;

    if v_event_id is null then
      continue;
    end if;

    insert into public.notifications(
      user_id,
      type,
      title,
      message,
      metadata,
      is_read
    ) values (
      v_duty.instructor_id,
      'duty_break_reminder',
      case when v_kind = 'warning' then 'Break due in 30 minutes' else 'Required break is due' end,
      case
        when v_kind = 'warning' then format(
          'Your %s-minute break is due by %s. Start a break before then if you have not already had one.',
          v_minimum_break_minutes,
          to_char(v_due_at at time zone 'Australia/Sydney', 'FMHH12:MI am')
        )
        else format(
          'You have reached %s hours on duty without a recorded %s-minute break. Take a break now and remain free of all duty.',
          case
            when mod(v_required_minutes, 60) = 0 then (v_required_minutes / 60)::text
            else trim(trailing '.' from trim(trailing '0' from round(v_required_minutes::numeric / 60, 1)::text))
          end,
          v_minimum_break_minutes
        )
      end,
      jsonb_build_object(
        'route', '/duty',
        'target_app_scope', 'duty_clock',
        'duty_period_id', v_duty.id,
        'reminder_kind', v_kind,
        'break_due_at', v_due_at,
        'minimum_break_minutes', v_minimum_break_minutes
      ),
      false
    )
    returning id into v_notification_id;

    update private.duty_break_notification_events
    set notification_id = v_notification_id
    where id = v_event_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.dispatch_due_duty_break_notifications() from public, anon, authenticated;
grant execute on function private.dispatch_due_duty_break_notifications() to service_role;

-- An app-targeted notification should only reach that app's subscriptions.
-- Existing notifications without target_app_scope continue to reach all of the
-- recipient's active PWA subscriptions.
create or replace function public.enqueue_notification_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if new.is_read
     or lower(coalesce(new.metadata ->> 'suppress_push', 'false')) in ('true', '1', 'yes') then
    return new;
  end if;

  insert into public.notification_push_deliveries(notification_id, subscription_id)
  select new.id, subscription.id
  from public.push_subscriptions subscription
  where subscription.user_id = new.user_id
    and subscription.revoked_at is null
    and (subscription.expiration_time is null or subscription.expiration_time > now())
    and (
      nullif(new.metadata ->> 'target_app_scope', '') is null
      or subscription.app_scope = new.metadata ->> 'target_app_scope'
    )
  on conflict (notification_id, subscription_id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count > 0 then
    perform public.invoke_notification_push_worker(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_notification_push_deliveries() from public, anon, authenticated, service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'dispatch-duty-break-notifications';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'dispatch-duty-break-notifications',
    '* * * * *',
    'select private.dispatch_due_duty_break_notifications()'
  );
end;
$$;

comment on table private.duty_break_notification_events is
  'Idempotency ledger for warning and due Duty Clock break notifications.';
comment on function private.dispatch_due_duty_break_notifications() is
  'Creates server-timed break reminders for active duty periods using live fatigue settings.';

select private.assert_function_permission_manifest();
