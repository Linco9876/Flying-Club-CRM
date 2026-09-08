-- Cancel one recurring occurrence through the ordinary booking path, or cancel
-- that occurrence and all later active occurrences atomically through this RPC.

create or replace function public.cancel_recurring_booking_series_from_occurrence(
  p_booking_id uuid,
  p_cancellation_reason_id uuid default null,
  p_cancellation_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source public.bookings%rowtype;
  v_reason public.booking_cancellation_reasons%rowtype;
  v_is_staff boolean := false;
  v_member_cancellation_enabled boolean := true;
  v_enforce_notice boolean := false;
  v_notice_hours integer := 0;
  v_notice_cutoff timestamptz;
  v_cancelled_at timestamptz := clock_timestamp();
  v_cancelled_count integer := 0;
  v_batch_id uuid := gen_random_uuid();
  v_recipients uuid[] := array[]::uuid[];
  v_first_start timestamptz;
  v_last_start timestamptz;
  v_local_timezone text := 'Australia/Sydney';
  v_summary_message text;
begin
  if p_booking_id is null then
    raise exception 'A booking is required' using errcode = '22023';
  end if;

  select * into v_source
  from public.bookings booking
  where booking.id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_source.recurrence_series_id is null or v_source.recurrence_occurrence_index is null then
    raise exception 'This booking is not linked to a recurring series' using errcode = '22023';
  end if;
  if v_source.deleted_at is not null or v_source.status in ('cancelled', 'no-show', 'completed') then
    raise exception 'Only an active recurring booking can be cancelled' using errcode = '22023';
  end if;

  v_is_staff := public.current_user_has_staff_role();
  select coalesce(setting.allow_booking_cancellation, true)
    into v_member_cancellation_enabled
  from public.portal_ux_settings setting
  order by setting.updated_at desc nulls last
  limit 1;
  v_member_cancellation_enabled := coalesce(v_member_cancellation_enabled, true);

  if auth.role() <> 'service_role' and (
    v_actor_id is null
    or not (
      v_is_staff
      or (
        public.current_user_has_full_portal_access()
        and v_source.student_id = v_actor_id
        and not coalesce(v_source.is_guest_booking, false)
        and v_member_cancellation_enabled
      )
    )
  ) then
    raise exception 'You cannot cancel this recurring booking series' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_source.recurrence_series_id::text, 0));

  if auth.role() <> 'service_role' and not v_is_staff and exists (
    select 1
    from public.bookings booking
    where booking.recurrence_series_id = v_source.recurrence_series_id
      and booking.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and booking.deleted_at is null
      and booking.status not in ('cancelled', 'no-show', 'completed')
      and booking.student_id is distinct from v_actor_id
  ) then
    raise exception 'You cannot cancel a series containing another member''s booking' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.bookings booking
    where booking.recurrence_series_id = v_source.recurrence_series_id
      and booking.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and booking.deleted_at is null
      and booking.status not in ('cancelled', 'no-show', 'completed')
      and (
        coalesce(booking.flight_logged, false)
        or coalesce(booking.ground_session_logged, false)
        or exists (select 1 from public.flight_logs flight where flight.booking_id = booking.id)
        or exists (select 1 from public.ground_session_logs session where session.booking_id = booking.id)
      )
  ) then
    raise exception 'A selected occurrence already has a flight or ground-session log. Cancel unlogged bookings individually.'
      using errcode = 'P0001';
  end if;

  select coalesce(rules.enforce_cancellation_notice, false),
         greatest(coalesce(rules.cancellation_notice_hours, 0), 0)
    into v_enforce_notice, v_notice_hours
  from public.booking_rules_settings rules
  order by rules.updated_at desc nulls last
  limit 1;
  v_enforce_notice := coalesce(v_enforce_notice, false);
  v_notice_hours := coalesce(v_notice_hours, 0);
  v_notice_cutoff := v_cancelled_at + make_interval(hours => v_notice_hours);

  if v_enforce_notice and p_cancellation_reason_id is null and exists (
    select 1
    from public.bookings booking
    where booking.recurrence_series_id = v_source.recurrence_series_id
      and booking.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and booking.deleted_at is null
      and booking.status not in ('cancelled', 'no-show', 'completed')
      and booking.start_time < v_notice_cutoff
  ) then
    raise exception 'Select a cancellation reason because at least one booking is within % hours of departure', v_notice_hours
      using errcode = '22023';
  end if;

  if p_cancellation_reason_id is not null then
    select * into v_reason
    from public.booking_cancellation_reasons reason
    where reason.id = p_cancellation_reason_id;
    if not found then
      raise exception 'The selected cancellation reason is no longer available' using errcode = 'P0002';
    end if;
    if not coalesce(v_reason.is_active, false) then
      raise exception 'The selected cancellation reason is no longer active' using errcode = '22023';
    end if;
    if lower(v_reason.name) = 'other' and nullif(btrim(coalesce(p_cancellation_notes, '')), '') is null then
      raise exception 'Add cancellation notes when the reason is Other' using errcode = '22023';
    end if;
  end if;

  select min(booking.start_time), max(booking.start_time),
         coalesce(array_agg(distinct recipient.user_id) filter (where recipient.user_id is not null), array[]::uuid[])
    into v_first_start, v_last_start, v_recipients
  from public.bookings booking
  cross join lateral (
    values (booking.student_id), (booking.instructor_id), (booking.supervising_instructor_id)
  ) recipient(user_id)
  where booking.recurrence_series_id = v_source.recurrence_series_id
    and booking.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
    and booking.deleted_at is null
    and booking.status not in ('cancelled', 'no-show', 'completed');

  perform set_config('bfc.recurring_edit_series_id', v_source.recurrence_series_id::text, true);

  update public.bookings booking
     set deleted_at = v_cancelled_at,
         status = case
           when v_enforce_notice
             and booking.start_time < v_notice_cutoff
             and v_reason.fee_type = 'no_show'
           then 'no-show'
           else 'cancelled'
         end,
         cancellation_reason_id = v_reason.id,
         cancellation_reason_name = v_reason.name,
         cancellation_notes = nullif(btrim(coalesce(p_cancellation_notes, '')), ''),
         cancellation_fee_type = case
           when v_enforce_notice and booking.start_time < v_notice_cutoff
           then coalesce(v_reason.fee_type, 'none')
           else 'none'
         end,
         cancellation_fee_amount = case
           when v_enforce_notice and booking.start_time < v_notice_cutoff
           then coalesce(v_reason.fee_amount, 0)
           else 0
         end,
         cancelled_at = v_cancelled_at,
         cancelled_by = v_actor_id,
         has_conflict = false,
         waitlist_reason = null,
         waitlisted_by_defect_id = null,
         updated_at = v_cancelled_at
   where booking.recurrence_series_id = v_source.recurrence_series_id
     and booking.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
     and booking.deleted_at is null
     and booking.status not in ('cancelled', 'no-show', 'completed');

  get diagnostics v_cancelled_count = row_count;
  if v_cancelled_count = 0 then
    raise exception 'No active future occurrences were found' using errcode = 'P0002';
  end if;

  perform public.promote_available_resource_waitlist();
  perform set_config('bfc.recurring_edit_series_id', '', true);

  select coalesce(nullif(setting.timezone, ''), v_local_timezone)
    into v_local_timezone
  from public.organisation_settings setting
  order by setting.updated_at desc nulls last
  limit 1;
  v_local_timezone := coalesce(v_local_timezone, 'Australia/Sydney');

  v_summary_message := format(
    '%s recurring %s from %s to %s cancelled.',
    v_cancelled_count,
    case when v_cancelled_count = 1 then 'booking' else 'bookings' end,
    to_char(v_first_start at time zone v_local_timezone, 'DD Mon YYYY HH24:MI'),
    to_char(v_last_start at time zone v_local_timezone, 'DD Mon YYYY HH24:MI')
  );

  insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
  select recipient_id,
         'booking',
         'Recurring booking series cancelled',
         v_summary_message,
         p_booking_id,
         jsonb_build_object(
           'notification_kind', 'booking_cancellation',
           'recurring_series_update', true,
           'recurring_edit_batch_id', v_batch_id::text,
           'recurrence_series_id', v_source.recurrence_series_id::text,
           'occurrence_count', v_cancelled_count,
           'booking_id', p_booking_id::text,
           'route', '/calendar'
         ),
         false
  from unnest(v_recipients) recipient_id
  where recipient_id is not null
  on conflict do nothing;

  return jsonb_build_object(
    'seriesId', v_source.recurrence_series_id,
    'cancelledCount', v_cancelled_count,
    'firstStart', v_first_start,
    'lastStart', v_last_start,
    'batchId', v_batch_id
  );
end;
$$;

revoke all on function public.cancel_recurring_booking_series_from_occurrence(uuid, uuid, text)
  from public, anon;
grant execute on function public.cancel_recurring_booking_series_from_occurrence(uuid, uuid, text)
  to authenticated, service_role;

comment on function public.cancel_recurring_booking_series_from_occurrence(uuid, uuid, text) is
  'Atomically cancels one active recurring occurrence and every later active, unlogged occurrence in the same stable series.';

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values (
  'public.cancel_recurring_booking_series_from_occurrence(p_booking_id uuid, p_cancellation_reason_id uuid, p_cancellation_notes text)',
  'cancel_recurring_booking_series_from_occurrence',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Cancels only a caller-owned recurring series or a series managed by authorised staff, with cancellation policy enforcement in one transaction.',
  date '2026-09-08'
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
