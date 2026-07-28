-- Configurable membership governance, renewal preparation and auditable waivers.

alter table public.membership_settings
  add column if not exists proration_method text not null default 'daily',
  add column if not exists minimum_prorated_fee numeric(10,2) not null default 0,
  add column if not exists renewal_invoice_lead_days integer not null default 30,
  add column if not exists renewal_reminder_days_before_due integer[] not null default array[30, 7],
  add column if not exists overdue_reminder_days integer[] not null default array[7, 30, 45, 55],
  add column if not exists technical_retry_minutes integer[] not null default array[5, 30, 120, 720],
  add column if not exists payment_retry_days integer[] not null default array[3, 7],
  add column if not exists waiver_types text[] not null default array[
    'Volunteer contribution',
    'Hardship',
    'Honorary',
    'Promotional',
    'Administrative correction'
  ],
  add column if not exists require_waiver_authority_reference boolean not null default true,
  add column if not exists statutory_register_cleanup_days integer not null default 14;

alter table public.membership_settings
  drop constraint if exists membership_settings_proration_method_check,
  add constraint membership_settings_proration_method_check
    check (proration_method in ('daily', 'monthly', 'none')),
  drop constraint if exists membership_settings_minimum_prorated_fee_check,
  add constraint membership_settings_minimum_prorated_fee_check
    check (minimum_prorated_fee >= 0),
  drop constraint if exists membership_settings_renewal_invoice_lead_days_check,
  add constraint membership_settings_renewal_invoice_lead_days_check
    check (renewal_invoice_lead_days between 0 and 120),
  drop constraint if exists membership_settings_renewal_reminders_check,
  add constraint membership_settings_renewal_reminders_check
    check (
      cardinality(renewal_reminder_days_before_due) between 1 and 10
      and 0 < all(renewal_reminder_days_before_due)
    ),
  drop constraint if exists membership_settings_overdue_reminders_check,
  add constraint membership_settings_overdue_reminders_check
    check (
      cardinality(overdue_reminder_days) between 1 and 10
      and 0 < all(overdue_reminder_days)
    ),
  drop constraint if exists membership_settings_technical_retries_check,
  add constraint membership_settings_technical_retries_check
    check (
      cardinality(technical_retry_minutes) between 1 and 10
      and 0 < all(technical_retry_minutes)
    ),
  drop constraint if exists membership_settings_payment_retries_check,
  add constraint membership_settings_payment_retries_check
    check (
      cardinality(payment_retry_days) between 1 and 10
      and 0 < all(payment_retry_days)
    ),
  drop constraint if exists membership_settings_waiver_types_check,
  add constraint membership_settings_waiver_types_check
    check (cardinality(waiver_types) between 1 and 20),
  drop constraint if exists membership_settings_register_cleanup_check,
  add constraint membership_settings_register_cleanup_check
    check (statutory_register_cleanup_days between 1 and 90);

update public.membership_settings
set xero_status_stale_hours = 12,
    updated_at = now()
where id = true
  and xero_status_stale_hours = 24;

alter table public.membership_financial_periods
  add column if not exists waiver_type text,
  add column if not exists waiver_authority_reference text;

create table if not exists public.membership_fee_reminders (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.membership_financial_periods(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('upcoming', 'overdue')),
  reminder_offset_days integer not null check (reminder_offset_days > 0),
  sent_at timestamptz not null default now(),
  unique (period_id, reminder_kind, reminder_offset_days)
);

alter table public.membership_fee_reminders enable row level security;

drop policy if exists "Members read own membership fee reminders" on public.membership_fee_reminders;
create policy "Members read own membership fee reminders"
on public.membership_fee_reminders for select to authenticated
using (
  public.current_user_is_admin()
  or exists (
    select 1
    from public.membership_financial_periods period
    join public.club_memberships membership on membership.id = period.membership_id
    where period.id = period_id
      and membership.user_id = auth.uid()
  )
);

grant select on public.membership_fee_reminders to authenticated;
grant all on public.membership_fee_reminders to service_role;

create or replace function public.membership_period_amount(
  p_class_id uuid,
  p_commencement_date date
) returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_fee numeric;
  v_start date;
  v_end date;
  v_settings public.membership_settings%rowtype;
  v_amount numeric;
  v_remaining_months integer;
begin
  select annual_fee into v_fee
  from public.membership_classes
  where id = p_class_id;

  select * into v_settings
  from public.membership_settings
  where id = true;

  select financial_year_start, financial_year_end into v_start, v_end
  from public.membership_financial_year_bounds(p_commencement_date);

  if coalesce(v_fee, 0) <= 0 then
    return 0;
  end if;

  if v_settings.proration_method = 'none' then
    v_amount := v_fee;
  elsif v_settings.proration_method = 'monthly' then
    v_remaining_months :=
      ((extract(year from v_end)::integer - extract(year from p_commencement_date)::integer) * 12)
      + extract(month from v_end)::integer
      - extract(month from p_commencement_date)::integer
      + 1;
    v_amount := round(v_fee * (greatest(v_remaining_months, 1)::numeric / 12), 2);
  else
    v_amount := round(
      v_fee * ((v_end - p_commencement_date + 1)::numeric / (v_end - v_start + 1)::numeric),
      2
    );
  end if;

  return least(
    v_fee,
    greatest(v_amount, coalesce(v_settings.minimum_prorated_fee, 0))
  );
end;
$$;

create or replace function public.authorize_membership_fee_waiver(
  p_period_id uuid,
  p_waiver_type text,
  p_reason text,
  p_authority_reference text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_period public.membership_financial_periods%rowtype;
  v_settings public.membership_settings%rowtype;
  v_user_id uuid;
  v_type text := nullif(btrim(coalesce(p_waiver_type, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_reference text := nullif(btrim(coalesce(p_authority_reference, '')), '');
begin
  if not public.current_user_is_admin() then
    raise exception 'Only administrators can authorise membership fee waivers';
  end if;

  select * into v_settings from public.membership_settings where id = true;
  if v_type is null or not (v_type = any(v_settings.waiver_types)) then
    raise exception 'Select an approved membership waiver type';
  end if;
  if char_length(coalesce(v_reason, '')) < 10 then
    raise exception 'A waiver reason of at least 10 characters is required';
  end if;
  if v_settings.require_waiver_authority_reference
     and char_length(coalesce(v_reference, '')) < 3 then
    raise exception 'Record the committee minute or other authority reference';
  end if;

  select * into v_period
  from public.membership_financial_periods
  where id = p_period_id
  for update;
  if not found then raise exception 'Membership financial period not found'; end if;
  if v_period.xero_invoice_id is not null
     and upper(coalesce(v_period.xero_invoice_status, '')) = 'PAID' then
    raise exception 'A paid Xero invoice cannot be replaced with a waiver';
  end if;

  select membership.user_id into v_user_id
  from public.club_memberships membership
  where membership.id = v_period.membership_id;

  update public.membership_financial_periods
  set fee_disposition = 'waived',
      financially_cleared_at = now(),
      waiver_type = v_type,
      waiver_reason = v_reason,
      waiver_authority_reference = v_reference,
      waiver_authorised_by = auth.uid(),
      waiver_authorised_at = now(),
      updated_at = now()
  where id = p_period_id;

  insert into public.membership_status_events(
    membership_id,
    user_id,
    event_type,
    actor_id,
    details
  ) values (
    v_period.membership_id,
    v_user_id,
    'membership_fee_waived',
    auth.uid(),
    jsonb_build_object(
      'periodId', p_period_id,
      'financialYearStart', v_period.financial_year_start,
      'type', v_type,
      'reason', v_reason,
      'authorityReference', v_reference
    )
  );
end;
$$;

revoke all on function public.authorize_membership_fee_waiver(uuid, text, text, text)
from public, anon;
grant execute on function public.authorize_membership_fee_waiver(uuid, text, text, text)
to authenticated, service_role;

-- Interactive administrators use the structured waiver function above. Keep
-- the older generic status function for trusted lifecycle/service work only.
revoke execute on function public.set_membership_fee_disposition(uuid, text, text)
from authenticated;
grant execute on function public.set_membership_fee_disposition(uuid, text, text)
to service_role;

create or replace function public.prepare_membership_renewals(
  p_as_of date default current_date
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_settings public.membership_settings%rowtype;
  v_current_start date;
  v_current_end date;
  v_next_start date;
  v_next_end date;
  v_created integer := 0;
  v_reminders integer := 0;
  v_reminder record;
begin
  if auth.uid() is not null and not public.current_user_is_admin() then
    raise exception 'Only administrators can prepare membership renewals';
  end if;

  select * into v_settings from public.membership_settings where id = true;
  select financial_year_start, financial_year_end
  into v_current_start, v_current_end
  from public.membership_financial_year_bounds(p_as_of);
  v_next_start := v_current_end + 1;
  v_next_end := (v_next_start + interval '1 year - 1 day')::date;

  if p_as_of >= v_next_start - v_settings.renewal_invoice_lead_days then
    insert into public.membership_financial_periods(
      membership_id,
      financial_year_start,
      financial_year_end,
      standard_fee,
      membership_fee_amount,
      scholarship_contribution_amount,
      amount_due,
      fee_disposition,
      due_date,
      grace_expires_at,
      financially_cleared_at
    )
    select
      membership.id,
      v_next_start,
      v_next_end,
      class.annual_fee,
      class.annual_fee,
      case
        when coalesce(preference.scholarship_contribution_enabled, false)
          then greatest(coalesce(preference.scholarship_contribution_amount, 0), 0)
        else 0
      end,
      class.annual_fee + case
        when coalesce(preference.scholarship_contribution_enabled, false)
          then greatest(coalesce(preference.scholarship_contribution_amount, 0), 0)
        else 0
      end,
      case
        when class.is_fee_exempt
          and not (
            coalesce(preference.scholarship_contribution_enabled, false)
            and greatest(coalesce(preference.scholarship_contribution_amount, 0), 0) > 0
          )
          then 'fee_exempt'
        else 'invoice_required'
      end,
      v_next_start,
      v_next_start::timestamptz + v_settings.non_payment_grace_days * interval '1 day',
      case
        when class.is_fee_exempt
          and not (
            coalesce(preference.scholarship_contribution_enabled, false)
            and greatest(coalesce(preference.scholarship_contribution_amount, 0), 0) > 0
          )
          then now()
        else null
      end
    from public.club_memberships membership
    join public.membership_classes class on class.id = membership.membership_class_id
    left join public.membership_payment_preferences preference
      on preference.user_id = membership.user_id
    where membership.legal_status = 'current'
    on conflict (membership_id, financial_year_start) do nothing;
    get diagnostics v_created = row_count;
  end if;

  for v_reminder in
    select
      period.id as period_id,
      membership.user_id,
      period.due_date,
      offset_days,
      'upcoming'::text as reminder_kind
    from public.membership_financial_periods period
    join public.club_memberships membership on membership.id = period.membership_id
    cross join lateral unnest(v_settings.renewal_reminder_days_before_due) offset_days
    where membership.legal_status = 'current'
      and period.fee_disposition not in ('paid', 'waived', 'fee_exempt', 'ceased')
      and p_as_of >= period.due_date - offset_days
      and p_as_of < period.due_date
    union all
    select
      period.id,
      membership.user_id,
      period.due_date,
      offset_days,
      'overdue'::text
    from public.membership_financial_periods period
    join public.club_memberships membership on membership.id = period.membership_id
    cross join lateral unnest(v_settings.overdue_reminder_days) offset_days
    where membership.legal_status = 'current'
      and period.fee_disposition not in ('paid', 'waived', 'fee_exempt', 'ceased')
      and p_as_of >= period.due_date + offset_days
  loop
    insert into public.membership_fee_reminders(
      period_id,
      reminder_kind,
      reminder_offset_days
    ) values (
      v_reminder.period_id,
      v_reminder.reminder_kind,
      v_reminder.offset_days
    )
    on conflict do nothing;

    if found then
      insert into public.notifications(user_id, type, title, message, metadata, is_read)
      values (
        v_reminder.user_id,
        'membership',
        case
          when v_reminder.reminder_kind = 'upcoming' then 'BFC membership renewal is coming up'
          else 'BFC membership payment is overdue'
        end,
        case
          when v_reminder.reminder_kind = 'upcoming'
            then format(
              'Your Bendigo Flying Club membership fee is due on %s. Review your payment preference in Club membership.',
              to_char(v_reminder.due_date, 'DD Mon YYYY')
            )
          else format(
            'Your Bendigo Flying Club membership fee was due on %s. Aircraft self-booking remains unavailable until the fee is paid or waived.',
            to_char(v_reminder.due_date, 'DD Mon YYYY')
          )
        end,
        jsonb_build_object(
          'membershipPeriodId', v_reminder.period_id,
          'path', '/membership',
          'reminderKind', v_reminder.reminder_kind,
          'offsetDays', v_reminder.offset_days
        ),
        false
      );
      v_reminders := v_reminders + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'periodsCreated', v_created,
    'remindersCreated', v_reminders,
    'nextFinancialYearStart', v_next_start
  );
end;
$$;

revoke all on function public.prepare_membership_renewals(date) from public, anon;
grant execute on function public.prepare_membership_renewals(date)
to authenticated, service_role;

create or replace view public.membership_statutory_register
with (security_invoker = true)
as
select
  membership.id,
  member.name,
  case when membership.legal_status = 'current' then application.residential_address else null end
    as residential_address,
  case when membership.legal_status = 'current' then class.name else null end
    as membership_class,
  case when membership.legal_status = 'current' then membership.commenced_at else null end
    as commenced_at,
  membership.ended_at as ceased_at,
  membership.legal_status
from public.club_memberships membership
join public.users member on member.id = membership.user_id
left join public.membership_applications application on application.id = membership.application_id
left join public.membership_classes class on class.id = membership.membership_class_id;

grant select on public.membership_statutory_register to authenticated, service_role;

comment on view public.membership_statutory_register is
  'Privacy-minimised statutory register projection. Ceased entries expose only the member name, cessation date and status.';
comment on column public.membership_settings.statutory_register_cleanup_days is
  'Governance target for removing former-member details from the statutory register projection; the projection removes them immediately.';

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for v_job_id in
      select jobid from cron.job where jobname = 'prepare-bfc-membership-renewals'
    loop
      perform cron.unschedule(v_job_id);
    end loop;
    perform cron.schedule(
      'prepare-bfc-membership-renewals',
      '5 2 * * *',
      'select public.prepare_membership_renewals(current_date);'
    );
  end if;
end;
$$;
