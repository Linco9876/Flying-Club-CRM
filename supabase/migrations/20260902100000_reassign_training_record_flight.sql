-- Correct a lesson/review record that was attached to the wrong logged flight.
-- The move is deliberately atomic: record metadata, related review data, both
-- outstanding-record states, acknowledgement tokens and audit history either
-- all move together or none of them do.

create unique index if not exists training_records_one_per_flight_log_idx
  on public.training_records(flight_log_id)
  where flight_log_id is not null;

create unique index if not exists training_records_one_per_booking_idx
  on public.training_records(booking_id)
  where booking_id is not null;

create or replace function public.current_user_has_staff_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(((select auth.jwt()) -> 'app_metadata' -> 'roles') ?| array['admin','cfi','instructor','senior_instructor'], false)
    or exists (
      select 1
      from public.user_roles ur
      where ur.user_id = (select auth.uid())
        and ur.role = any (array['admin','cfi','instructor','senior_instructor'])
    )
    or exists (
      select 1
      from public.users u
      where u.id = (select auth.uid())
        and coalesce(u.is_active, true)
        and (
          u.role = any (array['admin','cfi','instructor','senior_instructor'])
          or coalesce(u.is_senior_instructor, false)
        )
    );
$$;

create or replace function public.reassign_training_record_flight(
  p_training_record_id uuid,
  p_target_flight_log_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_record public.training_records%rowtype;
  v_source_log public.flight_logs%rowtype;
  v_target_log public.flight_logs%rowtype;
  v_target_aircraft public.aircraft%rowtype;
  v_actor_is_staff boolean := false;
  v_actor_can_manage_any boolean := false;
  v_was_acknowledged boolean := false;
  v_next_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target_date date;
  v_target_registration text;
  v_target_aircraft_type text;
  v_audit_entry jsonb;
begin
  if v_actor_id is null then
    raise exception 'Sign in again before reassigning a training record';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Enter a short reason for the reassignment';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'The reassignment reason must be 500 characters or fewer';
  end if;

  select
    coalesce(((select auth.jwt()) -> 'app_metadata' -> 'roles') ?| array['admin','cfi','instructor','senior_instructor'], false)
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = v_actor_id
        and ur.role = any (array['admin','cfi','instructor','senior_instructor'])
    )
    or exists (
      select 1 from public.users u
      where u.id = v_actor_id
        and coalesce(u.is_active, true)
        and (
          u.role = any (array['admin','cfi','instructor','senior_instructor'])
          or coalesce(u.is_senior_instructor, false)
        )
    ),
    coalesce(((select auth.jwt()) -> 'app_metadata' -> 'roles') ?| array['admin','cfi','senior_instructor'], false)
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = v_actor_id
        and ur.role = any (array['admin','cfi','senior_instructor'])
    )
    or exists (
      select 1 from public.users u
      where u.id = v_actor_id
        and coalesce(u.is_active, true)
        and (
          u.role = any (array['admin','cfi','senior_instructor'])
          or coalesce(u.is_senior_instructor, false)
        )
    )
  into v_actor_is_staff, v_actor_can_manage_any;

  if not v_actor_is_staff then
    raise exception 'Only instructors, CFI/DCFI users or administrators can reassign training records';
  end if;

  select training_record.*
  into v_record
  from public.training_records training_record
  where training_record.id = p_training_record_id
  for update;

  if not found then
    raise exception 'Training record not found';
  end if;
  if v_record.status = 'draft' or v_record.flight_log_id is null then
    raise exception 'Only a submitted record attached to a logged flight can be reassigned';
  end if;
  if p_target_flight_log_id is null or p_target_flight_log_id = v_record.flight_log_id then
    raise exception 'Select a different logged flight';
  end if;

  -- Lock both flight rows in stable UUID order to prevent crossed moves from
  -- racing each other or temporarily assigning two records to one flight.
  perform flight_log.id
  from public.flight_logs flight_log
  where flight_log.id in (v_record.flight_log_id, p_target_flight_log_id)
  order by flight_log.id
  for update;

  select source_log.*
  into v_source_log
  from public.flight_logs source_log
  where source_log.id = v_record.flight_log_id;

  select target_log.*
  into v_target_log
  from public.flight_logs target_log
  where target_log.id = p_target_flight_log_id;

  if v_source_log.id is null then
    raise exception 'The currently linked flight log no longer exists';
  end if;
  if v_target_log.id is null then
    raise exception 'The target flight log no longer exists';
  end if;
  if v_target_log.student_id is distinct from v_record.student_id then
    raise exception 'A training record can only move to another flight for the same student';
  end if;
  if v_target_log.instructor_id is null then
    raise exception 'The target flight does not have an instructor';
  end if;
  if v_target_log.training_record_status not in ('pending', 'dismissed') then
    raise exception 'The target flight is no longer available in Outstanding Records';
  end if;

  if not v_actor_can_manage_any and (
    v_record.instructor_id is distinct from v_actor_id
    or v_target_log.instructor_id is distinct from v_actor_id
  ) then
    raise exception 'Instructors can only reassign their own record to another flight they instructed';
  end if;

  if exists (
    select 1
    from public.training_records existing
    where existing.id <> v_record.id
      and (
        existing.flight_log_id = p_target_flight_log_id
        or (
          v_target_log.booking_id is not null
          and existing.booking_id = v_target_log.booking_id
        )
      )
  ) then
    raise exception 'The target flight already has a training record';
  end if;

  select aircraft.*
  into v_target_aircraft
  from public.aircraft aircraft
  where aircraft.id = v_target_log.aircraft_id;

  v_target_date := (v_target_log.start_time at time zone 'Australia/Sydney')::date;
  v_target_registration := coalesce(nullif(v_target_aircraft.registration, ''), v_record.registration, '');
  v_target_aircraft_type := coalesce(nullif(v_target_aircraft.type, ''), v_record.aircraft_type, 'single-engine');
  v_was_acknowledged := coalesce(v_record.student_ack, false);
  v_next_status := case when v_was_acknowledged then 'submitted' else v_record.status end;
  v_audit_entry := public.training_record_audit_entry(
    'flight_log_reassigned',
    jsonb_build_object(
      'reason', v_reason,
      'sourceFlightLogId', v_source_log.id,
      'sourceBookingId', v_source_log.booking_id,
      'sourceStartTime', v_source_log.start_time,
      'sourceAircraftId', v_source_log.aircraft_id,
      'sourceInstructorId', v_source_log.instructor_id,
      'targetFlightLogId', v_target_log.id,
      'targetBookingId', v_target_log.booking_id,
      'targetStartTime', v_target_log.start_time,
      'targetAircraftId', v_target_log.aircraft_id,
      'targetInstructorId', v_target_log.instructor_id,
      'studentAcknowledgementReset', v_was_acknowledged
    )
  );

  update public.training_records training_record
  set flight_log_id = p_target_flight_log_id,
      booking_id = v_target_log.booking_id,
      date = v_target_date,
      aircraft_id = v_target_log.aircraft_id,
      aircraft_type = v_target_aircraft_type,
      registration = v_target_registration,
      instructor_id = v_target_log.instructor_id,
      dual_time_min = greatest(0, round(coalesce(v_target_log.dual_time, 0) * 60)::integer),
      solo_time_min = greatest(0, round(coalesce(v_target_log.solo_time, 0) * 60)::integer),
      status = v_next_status,
      student_ack = case when v_was_acknowledged then false else training_record.student_ack end,
      student_ack_name = case when v_was_acknowledged then null else training_record.student_ack_name end,
      student_ack_timestamp = case when v_was_acknowledged then null else training_record.student_ack_timestamp end,
      audit_log = (case when jsonb_typeof(training_record.audit_log) = 'array' then training_record.audit_log else '[]'::jsonb end)
        || jsonb_build_array(v_audit_entry),
      updated_at = clock_timestamp()
  where training_record.id = v_record.id;

  update public.flight_review_records review_record
  set booking_id = v_target_log.booking_id,
      flight_log_id = v_target_log.id,
      review_date = v_target_date,
      aircraft_id = v_target_log.aircraft_id,
      aircraft_type = v_target_aircraft_type,
      registration = v_target_registration,
      flight_minutes = greatest(
        0,
        round((coalesce(v_target_log.dual_time, 0) + coalesce(v_target_log.solo_time, 0)) * 60)::integer
      ),
      updated_by = v_actor_id,
      updated_at = clock_timestamp(),
      version = coalesce(review_record.version, 0) + 1
  where review_record.source_training_record_id = v_record.id;

  update public.training_record_acknowledgement_tokens token
  set superseded_at = clock_timestamp()
  where token.training_record_id = v_record.id
    and token.used_at is null
    and token.superseded_at is null;

  update public.flight_logs source_log
  set training_record_status = 'pending',
      training_record_overdue_email_sent_at = null,
      updated_at = clock_timestamp()
  where source_log.id = v_source_log.id
    and not exists (
      select 1
      from public.training_records remaining
      where remaining.flight_log_id = source_log.id
        or (
          source_log.booking_id is not null
          and remaining.booking_id = source_log.booking_id
        )
    );

  update public.flight_logs target_log
  set training_record_status = 'recorded',
      training_record_overdue_email_sent_at = null,
      updated_at = clock_timestamp()
  where target_log.id = v_target_log.id;

  insert into public.operations_audit_events (
    entity_type,
    entity_id,
    action,
    actor_id,
    before_data,
    after_data,
    metadata
  ) values (
    'training_record',
    v_record.id,
    'flight_log_reassigned',
    v_actor_id,
    jsonb_build_object(
      'flightLogId', v_source_log.id,
      'bookingId', v_source_log.booking_id,
      'date', v_record.date,
      'aircraftId', v_record.aircraft_id,
      'instructorId', v_record.instructor_id
    ),
    jsonb_build_object(
      'flightLogId', v_target_log.id,
      'bookingId', v_target_log.booking_id,
      'date', v_target_date,
      'aircraftId', v_target_log.aircraft_id,
      'instructorId', v_target_log.instructor_id
    ),
    jsonb_build_object(
      'reason', v_reason,
      'sourceReturnedToOutstandingRecords', true,
      'targetMarkedRecorded', true,
      'studentAcknowledgementReset', v_was_acknowledged
    )
  );

  return jsonb_build_object(
    'trainingRecordId', v_record.id,
    'sourceFlightLogId', v_source_log.id,
    'targetFlightLogId', v_target_log.id,
    'targetBookingId', v_target_log.booking_id,
    'targetDate', v_target_date,
    'targetRegistration', v_target_registration,
    'studentAcknowledgementReset', v_was_acknowledged,
    'acknowledgementEmailRequired', v_next_status = 'submitted'
  );
end;
$$;

revoke all on function public.reassign_training_record_flight(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reassign_training_record_flight(uuid, uuid, text)
  to authenticated, service_role;

insert into private.function_permission_manifest (
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values (
  'public.reassign_training_record_flight(p_training_record_id uuid, p_target_flight_log_id uuid, p_reason text)',
  'reassign_training_record_flight',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Staff correction workflow. The function locks both flights, enforces same-student and vacant-target rules, limits ordinary instructors to their own flights, moves related review data, resets stale acknowledgement state and records a durable audit event.',
  date '2026-09-02'
)
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

comment on function public.reassign_training_record_flight(uuid, uuid, text) is
  'Atomically moves a submitted training record and related review metadata to a vacant logged flight for the same student, with staff permission checks, acknowledgement reset and audit history.';

select private.assert_function_permission_manifest();
