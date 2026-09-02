-- Edit one recurring occurrence or atomically apply the same change to that
-- occurrence and every later active occurrence in its stable series.

create unique index if not exists idx_notifications_recurring_edit_batch_recipient
  on public.notifications(user_id, ((metadata ->> 'recurring_edit_batch_id')))
  where metadata ->> 'recurring_series_update' = 'true'
    and metadata ? 'recurring_edit_batch_id';

create or replace function public.suppress_recurring_edit_batch_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id text := nullif(current_setting('bfc.recurring_edit_series_id', true), '');
begin
  if v_series_id is null
     or new.booking_id is null
     or coalesce((new.metadata ->> 'recurring_series_update')::boolean, false) then
    return new;
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.id = new.booking_id
      and b.recurrence_series_id::text = v_series_id
  ) then
    return null;
  end if;

  return new;
end;
$$;

-- PostgreSQL runs same-event triggers alphabetically. This guard must run
-- before the ordinary settings/deduplication trigger.
drop trigger if exists a_suppress_recurring_edit_batch_notification on public.notifications;
create trigger a_suppress_recurring_edit_batch_notification
before insert on public.notifications
for each row execute function public.suppress_recurring_edit_batch_notification();

create or replace function public.reconcile_resource_waitlist_after_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An atomic recurring edit temporarily vacates later occurrence slots while
  -- processing the series in a collision-safe order. Reconcile once after the
  -- entire final schedule exists, not against an intermediate schedule.
  if nullif(current_setting('bfc.recurring_edit_series_id', true), '') is not null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if pg_trigger_depth() <= 1 then
    perform public.promote_available_resource_waitlist();
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.update_recurring_booking_series_from_occurrence(
  p_booking_id uuid,
  p_new_start timestamptz,
  p_new_end timestamptz,
  p_student_id uuid,
  p_instructor_id uuid,
  p_aircraft_id uuid,
  p_payment_type text,
  p_notes text,
  p_booking_kind text,
  p_flight_type_id uuid,
  p_is_guest_booking boolean,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_trial_flight_voucher_id uuid,
  p_casual_contact_id uuid,
  p_booking_purpose text,
  p_location text,
  p_location_id uuid,
  p_duty_override_reason text default null,
  p_membership_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source public.bookings%rowtype;
  v_target public.bookings%rowtype;
  v_is_staff boolean := false;
  v_start_delta interval;
  v_end_delta interval;
  v_updated_count integer := 0;
  v_batch_id uuid := gen_random_uuid();
  v_old_recipients uuid[] := array[]::uuid[];
  v_first_start timestamptz;
  v_last_start timestamptz;
  v_local_timezone text := 'Australia/Sydney';
  v_summary_message text;
begin
  if p_booking_id is null then
    raise exception 'A booking is required' using errcode = '22023';
  end if;
  if p_new_start is null or p_new_end is null or p_new_end <= p_new_start then
    raise exception 'End time must be after start time' using errcode = '22023';
  end if;
  if p_student_id is null then
    raise exception 'A pilot or student is required' using errcode = '22023';
  end if;
  if p_booking_kind not in ('flight', 'ground') then
    raise exception 'Booking kind must be flight or ground' using errcode = '22023';
  end if;
  if p_booking_kind = 'flight' and p_aircraft_id is null then
    raise exception 'Aircraft is required for a flight booking' using errcode = '22023';
  end if;
  if p_booking_kind = 'ground' and p_instructor_id is null then
    raise exception 'Instructor is required for a ground session' using errcode = '22023';
  end if;

  select * into v_source
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_source.recurrence_series_id is null or v_source.recurrence_occurrence_index is null then
    raise exception 'This booking is not linked to a recurring series' using errcode = '22023';
  end if;
  if v_source.deleted_at is not null or v_source.status in ('cancelled', 'no-show', 'completed') then
    raise exception 'Only an active recurring booking can be edited' using errcode = '22023';
  end if;

  v_is_staff := public.current_user_has_staff_role();
  if auth.role() <> 'service_role' and (
    v_actor_id is null
    or not (
      v_is_staff
      or (
        public.current_user_has_full_portal_access()
        and v_source.student_id = v_actor_id
        and p_student_id = v_actor_id
      )
    )
  ) then
    raise exception 'You cannot update this recurring booking series' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_source.recurrence_series_id::text, 0));

  if exists (
    select 1
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
      and (
        coalesce(b.flight_logged, false)
        or coalesce(b.ground_session_logged, false)
        or exists (select 1 from public.flight_logs fl where fl.booking_id = b.id)
        or exists (select 1 from public.ground_session_logs gl where gl.booking_id = b.id)
      )
  ) then
    raise exception 'A future occurrence already has a flight or ground-session log. Edit that occurrence separately.'
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct recipient_id) filter (where recipient_id is not null), array[]::uuid[])
    into v_old_recipients
  from (
    select b.student_id as recipient_id
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
    union
    select b.instructor_id
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
    union
    select b.supervising_instructor_id
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
  ) recipients;

  v_start_delta := p_new_start - v_source.start_time;
  v_end_delta := p_new_end - v_source.end_time;
  perform set_config('bfc.recurring_edit_series_id', v_source.recurrence_series_id::text, true);

  -- Directional ordering prevents a shifted occurrence from colliding with the
  -- old slot of another occurrence that is also moving in this transaction.
  for v_target in
    select b.*
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
    order by
      case when v_start_delta >= interval '0' then b.recurrence_occurrence_index end desc nulls last,
      case when v_start_delta < interval '0' then b.recurrence_occurrence_index end asc nulls last,
      b.id
    for update
  loop
    if v_target.end_time + v_end_delta <= v_target.start_time + v_start_delta then
      raise exception 'The requested change would make an occurrence end before it starts'
        using errcode = '22023';
    end if;

    update public.bookings b
       set student_id = p_student_id,
           instructor_id = p_instructor_id,
           aircraft_id = case when p_booking_kind = 'ground' then null else p_aircraft_id end,
           start_time = v_target.start_time + v_start_delta,
           end_time = v_target.end_time + v_end_delta,
           payment_type = coalesce(p_payment_type, ''),
           notes = nullif(btrim(coalesce(p_notes, '')), ''),
           booking_kind = p_booking_kind,
           flight_type_id = p_flight_type_id,
           is_guest_booking = coalesce(p_is_guest_booking, false),
           guest_name = nullif(btrim(coalesce(p_guest_name, '')), ''),
           guest_email = nullif(btrim(coalesce(p_guest_email, '')), ''),
           guest_phone = nullif(btrim(coalesce(p_guest_phone, '')), ''),
           trial_flight_voucher_id = p_trial_flight_voucher_id,
           casual_contact_id = p_casual_contact_id,
           booking_purpose = coalesce(nullif(btrim(p_booking_purpose), ''), 'standard'),
           location = nullif(btrim(coalesce(p_location, '')), ''),
           location_id = p_location_id,
           duty_override_reason = nullif(btrim(coalesce(p_duty_override_reason, '')), ''),
           membership_override_reason = coalesce(
             nullif(btrim(coalesce(p_membership_override_reason, '')), ''),
             b.membership_override_reason
           ),
           updated_at = now()
     where b.id = v_target.id;

    v_updated_count := v_updated_count + 1;
  end loop;

  if v_updated_count = 0 then
    raise exception 'No active future occurrences were found' using errcode = 'P0002';
  end if;

  -- Re-open any genuinely available slots only after the full final schedule
  -- exists. Notifications for unrelated promoted bookings remain enabled.
  perform public.promote_available_resource_waitlist();

  select min(b.start_time), max(b.start_time)
    into v_first_start, v_last_start
  from public.bookings b
  where b.recurrence_series_id = v_source.recurrence_series_id
    and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
    and b.deleted_at is null
    and b.status not in ('cancelled', 'no-show', 'completed');

  select coalesce(nullif(timezone, ''), v_local_timezone)
    into v_local_timezone
  from public.organisation_settings
  order by updated_at desc nulls last
  limit 1;

  v_summary_message := format(
    '%s recurring %s updated from %s to %s.',
    v_updated_count,
    case when v_updated_count = 1 then 'booking was' else 'bookings were' end,
    to_char(v_first_start at time zone v_local_timezone, 'DD Mon YYYY HH24:MI'),
    to_char(v_last_start at time zone v_local_timezone, 'DD Mon YYYY HH24:MI')
  );

  perform set_config('bfc.recurring_edit_series_id', '', true);

  with recipients as (
    select unnest(v_old_recipients) as user_id
    union select b.student_id
      from public.bookings b
     where b.recurrence_series_id = v_source.recurrence_series_id
       and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
       and b.deleted_at is null and b.status not in ('cancelled', 'no-show', 'completed')
    union select b.instructor_id
      from public.bookings b
     where b.recurrence_series_id = v_source.recurrence_series_id
       and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
       and b.deleted_at is null and b.status not in ('cancelled', 'no-show', 'completed')
    union select b.supervising_instructor_id
      from public.bookings b
     where b.recurrence_series_id = v_source.recurrence_series_id
       and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
       and b.deleted_at is null and b.status not in ('cancelled', 'no-show', 'completed')
    union select u.id
      from public.users u
     where coalesce(u.is_active, true)
       and exists (
         select 1 from public.bookings b
          where b.recurrence_series_id = v_source.recurrence_series_id
            and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
            and b.deleted_at is null and b.status = 'pending_approval'
       )
       and (
         u.role = 'admin'
         or exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin')
       )
    union select u.id
      from public.users u
     where coalesce(u.is_active, true)
       and exists (
         select 1 from public.bookings b
          where b.recurrence_series_id = v_source.recurrence_series_id
            and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
            and b.deleted_at is null and b.status = 'pending_supervision'
       )
       and (
         u.role in ('admin', 'cfi')
         or exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role in ('admin', 'cfi'))
         or exists (
           select 1 from public.senior_instructor_authorisations a
            where a.instructor_id = u.id and a.is_active
         )
       )
  )
  insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
  select recipient.user_id,
         'booking',
         'Recurring booking series updated',
         v_summary_message,
         p_booking_id,
         jsonb_build_object(
           'notification_kind', 'booking_change',
           'recurring_series_update', true,
           'recurring_edit_batch_id', v_batch_id::text,
           'recurrence_series_id', v_source.recurrence_series_id::text,
           'occurrence_count', v_updated_count,
           'booking_id', p_booking_id::text,
           'route', '/calendar'
         ),
         false
    from recipients recipient
   where recipient.user_id is not null
  on conflict do nothing;

  return jsonb_build_object(
    'seriesId', v_source.recurrence_series_id,
    'updatedCount', v_updated_count,
    'firstStart', v_first_start,
    'lastStart', v_last_start,
    'batchId', v_batch_id
  );
end;
$$;

-- The masked member calendar may safely expose series identity/position. It
-- does not expose another member's private notes, payment or guest details.
create or replace view public.calendar_booking_public
with (security_invoker = false, security_barrier = true)
as
with viewer as (
  select
    auth.uid() as uid,
    public.current_user_has_staff_role() as is_staff,
    public.current_user_has_full_portal_access() as has_full_access
)
select
  b.id,
  b.student_id,
  b.instructor_id,
  b.aircraft_id,
  b.start_time,
  b.end_time,
  case when viewer.is_staff or b.student_id = viewer.uid then b.payment_type else null end as payment_type,
  case when viewer.is_staff or b.student_id = viewer.uid then b.notes else null end as notes,
  b.status,
  coalesce(b.has_conflict, false) as has_conflict,
  b.deleted_at,
  coalesce(b.flight_logged, false) as flight_logged,
  case when viewer.is_staff or b.student_id = viewer.uid then b.flight_type_id else null end as flight_type_id,
  case when viewer.is_staff or b.student_id = viewer.uid then b.trial_flight_voucher_id else null end as trial_flight_voucher_id,
  b.is_guest_booking,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_name else null end as guest_name,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_email else null end as guest_email,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_phone else null end as guest_phone,
  case
    when viewer.is_staff or b.student_id = viewer.uid then coalesce(b.guest_name, hirer.name)
    else null
  end as hirer_name,
  instructor.name as instructor_name,
  b.recurrence_series_id,
  b.recurrence_occurrence_index,
  b.recurrence_occurrence_count,
  b.recurrence_notifications_finalised_at
from public.bookings b
cross join viewer
left join public.users hirer on hirer.id = b.student_id
left join public.users instructor on instructor.id = b.instructor_id
where viewer.has_full_access;

revoke all on public.calendar_booking_public from anon;
grant select on public.calendar_booking_public to authenticated;
grant all on public.calendar_booking_public to service_role;

revoke all on function public.update_recurring_booking_series_from_occurrence(
  uuid, timestamptz, timestamptz, uuid, uuid, uuid, text, text, text, uuid,
  boolean, text, text, text, uuid, uuid, text, text, uuid, text, text
) from public, anon;
grant execute on function public.update_recurring_booking_series_from_occurrence(
  uuid, timestamptz, timestamptz, uuid, uuid, uuid, text, text, text, uuid,
  boolean, text, text, text, uuid, uuid, text, text, uuid, text, text
) to authenticated, service_role;
revoke all on function public.suppress_recurring_edit_batch_notification()
  from public, anon, authenticated, service_role;

comment on function public.update_recurring_booking_series_from_occurrence(
  uuid, timestamptz, timestamptz, uuid, uuid, uuid, text, text, text, uuid,
  boolean, text, text, text, uuid, uuid, text, text, uuid, text, text
) is 'Atomically applies one occurrence edit to that active occurrence and all later active occurrences in its recurring series.';

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
  'public.update_recurring_booking_series_from_occurrence(p_booking_id uuid, p_new_start timestamp with time zone, p_new_end timestamp with time zone, p_student_id uuid, p_instructor_id uuid, p_aircraft_id uuid, p_payment_type text, p_notes text, p_booking_kind text, p_flight_type_id uuid, p_is_guest_booking boolean, p_guest_name text, p_guest_email text, p_guest_phone text, p_trial_flight_voucher_id uuid, p_casual_contact_id uuid, p_booking_purpose text, p_location text, p_location_id uuid, p_duty_override_reason text, p_membership_override_reason text)',
  'update_recurring_booking_series_from_occurrence',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Updates only a caller-owned series or a series managed by authorised staff, in one auditable transaction.',
  date '2026-09-01'
),
(
  'public.suppress_recurring_edit_batch_notification()',
  'suppress_recurring_edit_batch_notification',
  'trigger_internal',
  array[]::text[],
  true,
  true,
  'Suppresses per-occurrence alerts only during the protected atomic recurring-series update transaction.',
  date '2026-09-01'
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
