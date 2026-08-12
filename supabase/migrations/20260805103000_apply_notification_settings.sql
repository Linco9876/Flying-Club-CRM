-- Make the notification switches enforce real in-app behaviour. Delivery
-- channels without an installed provider remain read-only in the UI.

create or replace function public.apply_notification_delivery_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  config public.notification_settings%rowtype;
  preference public.user_preferences%rowtype;
  notification_kind text := coalesce(new.metadata ->> 'notification_kind', '');
  is_maintenance boolean := (
    new.type in ('reminder', 'conflict', 'system')
    and (
      new.metadata ? 'aircraft_id'
      or new.metadata ? 'milestone_id'
      or new.metadata ? 'defect_id'
    )
  );
begin
  select * into config
  from public.notification_settings
  order by updated_at desc nulls last
  limit 1;

  if config.id is null then
    return new;
  end if;

  if not config.in_app_notifications_enabled then
    return null;
  end if;

  if notification_kind = 'booking_confirmation' and not config.booking_confirmation_enabled then return null; end if;
  if notification_kind = 'booking_change' and not config.booking_change_notification_enabled then return null; end if;
  if notification_kind = 'booking_cancellation' and not config.cancellation_notification_enabled then return null; end if;
  if notification_kind = 'booking_waitlist' and not config.waitlist_notification_enabled then return null; end if;

  if new.type in ('booking_approval', 'licence_verification', 'supervision_required')
     and not config.approval_request_notification_enabled then
    return null;
  end if;

  if new.type in ('supervision_assigned', 'supervision_changed')
     and not config.booking_change_notification_enabled then
    return null;
  end if;

  if is_maintenance and not config.maintenance_alert_enabled then
    return null;
  end if;

  if is_maintenance and new.metadata ? 'defect_id' and not config.defect_report_notification_enabled then
    return null;
  end if;

  select * into preference
  from public.user_preferences
  where user_id = new.user_id
  limit 1;

  if is_maintenance and preference.id is not null and not preference.maintenance_alerts then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists apply_notification_delivery_policy_trigger on public.notifications;
create trigger apply_notification_delivery_policy_trigger
before insert on public.notifications
for each row execute function public.apply_notification_delivery_policy();

create or replace function public.notify_booking_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_kind text;
  event_title text;
  event_message text;
  local_timezone text := 'Australia/Sydney';
  aircraft_registration text;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.status = 'cancelled' then return new; end if;
    event_kind := 'booking_confirmation';
    event_title := case when new.status = 'pending_approval' then 'Booking request received' else 'Booking confirmed' end;
  elsif (old.deleted_at is null and new.deleted_at is not null)
     or (old.status is distinct from 'cancelled' and new.status = 'cancelled') then
    event_kind := 'booking_cancellation';
    event_title := 'Booking cancelled';
  elsif coalesce(old.has_conflict, false) is distinct from coalesce(new.has_conflict, false) then
    event_kind := 'booking_waitlist';
    event_title := case when coalesce(new.has_conflict, false) then 'Booking needs attention' else 'Booking conflict cleared' end;
  elsif old.start_time is distinct from new.start_time
     or old.end_time is distinct from new.end_time
     or old.aircraft_id is distinct from new.aircraft_id
     or old.instructor_id is distinct from new.instructor_id
     or old.status is distinct from new.status then
    event_kind := 'booking_change';
    event_title := 'Booking updated';
  else
    return new;
  end if;

  select coalesce(nullif(timezone, ''), local_timezone)
  into local_timezone
  from public.organisation_settings
  order by updated_at desc nulls last
  limit 1;

  select registration into aircraft_registration
  from public.aircraft
  where id = new.aircraft_id;

  event_message := case event_kind
    when 'booking_cancellation' then
      format('The booking for %s on %s has been cancelled.',
        coalesce(aircraft_registration, 'your session'),
        to_char(new.start_time at time zone local_timezone, 'DD Mon YYYY HH24:MI'))
    when 'booking_waitlist' then
      case when coalesce(new.has_conflict, false) then
        format('The booking for %s on %s has a resource conflict and needs review.',
          coalesce(aircraft_registration, 'your session'),
          to_char(new.start_time at time zone local_timezone, 'DD Mon YYYY HH24:MI'))
      else
        format('The resource conflict for %s on %s has been cleared.',
          coalesce(aircraft_registration, 'your session'),
          to_char(new.start_time at time zone local_timezone, 'DD Mon YYYY HH24:MI'))
      end
    else
      format('%s is scheduled for %s to %s.',
        coalesce(aircraft_registration, case when new.booking_kind = 'ground' then 'Your ground session' else 'Your booking' end),
        to_char(new.start_time at time zone local_timezone, 'DD Mon YYYY HH24:MI'),
        to_char(new.end_time at time zone local_timezone, 'HH24:MI'))
  end;

  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
    select recipient_id,
      'booking',
      event_title,
      event_message,
      new.id,
      jsonb_build_object(
        'notification_kind', event_kind,
        'booking_id', new.id,
        'route', '/calendar'
      ),
      false
    from (
      values (new.student_id), (new.instructor_id)
    ) recipients(recipient_id)
    where recipient_id is not null;
  else
    insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
    select recipient_id,
      'booking',
      event_title,
      event_message,
      new.id,
      jsonb_build_object(
        'notification_kind', event_kind,
        'booking_id', new.id,
        'route', '/calendar'
      ),
      false
    from (
      select new.student_id as recipient_id
      union select new.instructor_id
      union select old.student_id
      union select old.instructor_id
    ) recipients
    where recipient_id is not null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_booking_participants_trigger on public.bookings;
create trigger notify_booking_participants_trigger
after insert or update of start_time, end_time, aircraft_id, instructor_id, status, deleted_at, has_conflict
on public.bookings
for each row execute function public.notify_booking_participants();

revoke all on function public.apply_notification_delivery_policy() from public, anon, authenticated, service_role;
revoke all on function public.notify_booking_participants() from public, anon, authenticated, service_role;

comment on function public.apply_notification_delivery_policy() is
  'Enforces club-wide in-app notification settings and supported personal maintenance preferences at insert time.';
comment on function public.notify_booking_participants() is
  'Creates settings-aware in-app booking confirmation, change, cancellation and conflict notifications.';

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values
  (
    'public.apply_notification_delivery_policy()',
    'apply_notification_delivery_policy',
    'trigger_internal',
    array[]::text[],
    true,
    true,
    'Invoked only by a database trigger; client EXECUTE is unnecessary.',
    date '2026-08-05'
  ),
  (
    'public.notify_booking_participants()',
    'notify_booking_participants',
    'trigger_internal',
    array[]::text[],
    true,
    true,
    'Invoked only by a database trigger; client EXECUTE is unnecessary.',
    date '2026-08-05'
  )
on conflict(signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

select private.assert_function_permission_manifest();
