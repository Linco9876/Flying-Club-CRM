-- Give a CFI / DCFI a controlled way to allocate a currently authorised
-- supervisor to an uncovered instructor booking. Roster availability is the
-- only bypass: authorisation scope, qualification, duty and concurrent
-- capacity remain mandatory, and the selected supervisor is notified so they
-- can acknowledge the assignment themselves.

create or replace function public.assign_booking_supervisor(
  p_booking_id uuid,
  p_supervisor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_requirement public.instructor_supervision_requirements%rowtype;
  v_preflight_minutes integer := 30;
  v_postflight_minutes integer := 30;
  v_activity_type text;
  v_covered_start timestamptz;
  v_covered_end timestamptz;
  v_supervisor_name text;
begin
  if v_actor_id is null then
    raise exception 'Sign in again before allocating supervision';
  end if;
  if not public.current_user_is_cfi() then
    raise exception 'CFI / DCFI authority is required to allocate a supervisor';
  end if;
  if p_supervisor_id is null then
    raise exception 'Select an authorised supervisor';
  end if;

  select booking.*
  into v_booking
  from public.bookings booking
  where booking.id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;
  if v_booking.deleted_at is not null
    or v_booking.status in ('cancelled', 'no-show', 'completed')
  then
    raise exception 'Only an open booking can receive a supervisor allocation';
  end if;
  if v_booking.end_time <= now() then
    raise exception 'Past bookings cannot receive a new supervisor allocation';
  end if;
  if v_booking.instructor_id is null then
    raise exception 'This booking does not have an instructor who requires supervision';
  end if;
  if p_supervisor_id = v_booking.instructor_id then
    raise exception 'The booking instructor cannot supervise themselves';
  end if;
  if not v_booking.supervision_required
    or v_booking.supervision_status <> 'pending'
  then
    raise exception 'This booking no longer needs a supervisor allocation';
  end if;
  if exists (
    select 1 from public.flight_logs flight_log
    where flight_log.booking_id = v_booking.id
  ) or exists (
    select 1 from public.ground_session_logs ground_log
    where ground_log.booking_id = v_booking.id
  ) then
    raise exception 'A logged activity cannot receive a new supervisor allocation';
  end if;
  if not exists (
    select 1
    from public.users portal_user
    where portal_user.id = p_supervisor_id
      and coalesce(portal_user.is_active, true)
  ) then
    raise exception 'The selected supervisor is not an active portal user';
  end if;

  v_activity_type := case
    when coalesce(v_booking.booking_kind, 'flight') = 'ground' then 'ground'
    else 'flight'
  end;

  select requirement.*
  into v_requirement
  from public.instructor_supervision_requirements requirement
  where requirement.instructor_id = v_booking.instructor_id
    and requirement.effective_from <= (
      v_booking.start_time at time zone 'Australia/Sydney'
    )::date
    and (
      requirement.effective_to is null
      or requirement.effective_to >= (
        v_booking.end_time at time zone 'Australia/Sydney'
      )::date
    )
  limit 1;

  if found then
    v_preflight_minutes := coalesce(v_requirement.preflight_minutes, 30);
    v_postflight_minutes := coalesce(v_requirement.postflight_minutes, 30);
  end if;

  v_covered_start := v_booking.start_time
    - make_interval(mins => v_preflight_minutes);
  v_covered_end := v_booking.end_time
    + make_interval(mins => v_postflight_minutes);

  if not private.manual_supervisor_available_for_slot(
    p_supervisor_id,
    v_booking.instructor_id,
    v_covered_start,
    v_covered_end,
    coalesce(v_booking.location, 'Bendigo'),
    v_activity_type,
    v_booking.id
  ) then
    raise exception using
      message = 'The selected person cannot supervise this booking',
      detail = 'Check their active senior-instructor authorisation, qualification, location/activity scope, duty limits and concurrent-supervision capacity.';
  end if;

  update public.booking_supervision_commitments commitment
  set status = 'invalidated',
      ended_at = clock_timestamp(),
      ended_by = v_actor_id,
      end_reason = 'Replaced by a CFI supervisor allocation',
      updated_at = clock_timestamp()
  where commitment.booking_id = v_booking.id
    and commitment.status = 'accepted';

  insert into public.booking_supervision_commitments (
    booking_id,
    supervising_instructor_id,
    booking_instructor_id,
    covered_start,
    covered_end,
    booking_location,
    activity_type,
    metadata
  ) values (
    v_booking.id,
    p_supervisor_id,
    v_booking.instructor_id,
    v_covered_start,
    v_covered_end,
    coalesce(v_booking.location, 'Bendigo'),
    v_activity_type,
    jsonb_build_object(
      'bookingStart', v_booking.start_time,
      'bookingEnd', v_booking.end_time,
      'source', 'cfi_booking_action_menu',
      'allocationMode', 'cfi_assigned',
      'assignedByCfi', v_actor_id,
      'rosterAvailabilityOverridden', true,
      'supervisorAcknowledgementRequired', true
    )
  );

  -- The existing booking trigger sees this exact-slot override, performs the
  -- normal assignment transition and sends notifications to both instructors.
  update public.bookings booking
  set updated_at = clock_timestamp()
  where booking.id = v_booking.id;

  select booking.*
  into v_booking
  from public.bookings booking
  where booking.id = p_booking_id;

  if v_booking.supervising_instructor_id is distinct from p_supervisor_id
    or v_booking.supervision_status <> 'assigned'
  then
    raise exception 'The supervisor allocation could not be applied safely';
  end if;

  update public.booking_supervision_assignments assignment
  set assignment_reason = 'Allocated by a CFI / DCFI despite roster unavailability'
  where assignment.booking_id = v_booking.id
    and assignment.supervising_instructor_id = p_supervisor_id
    and assignment.status = 'assigned';

  insert into public.operations_audit_events (
    entity_type,
    entity_id,
    action,
    actor_id,
    before_data,
    after_data,
    metadata
  ) values (
    'booking',
    v_booking.id,
    'cfi_supervisor_allocated',
    v_actor_id,
    jsonb_build_object(
      'supervisionStatus', 'pending',
      'supervisingInstructorId', null
    ),
    jsonb_build_object(
      'supervisionStatus', 'assigned',
      'supervisingInstructorId', p_supervisor_id
    ),
    jsonb_build_object(
      'coveredStart', v_covered_start,
      'coveredEnd', v_covered_end,
      'assignedByCfi', v_actor_id,
      'rosterAvailabilityOverridden', true,
      'supervisorAcknowledgementRequired', true
    )
  );

  select portal_user.name
  into v_supervisor_name
  from public.users portal_user
  where portal_user.id = p_supervisor_id;

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'supervisingInstructorId', p_supervisor_id,
    'supervisingInstructorName', coalesce(v_supervisor_name, 'Senior instructor'),
    'supervisionStatus', 'assigned',
    'bookingStatus', v_booking.status
  );
end;
$$;

revoke all on function public.assign_booking_supervisor(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assign_booking_supervisor(uuid, uuid)
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
  'public.assign_booking_supervisor(p_booking_id uuid, p_supervisor_id uuid)',
  'assign_booking_supervisor',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'CFI/DCFI-only booking action. The function locks the booking and enforces target authorisation, scope, qualification, duty and capacity while deliberately bypassing roster availability.',
  date '2026-08-26'
)
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

select private.assert_function_permission_manifest();

comment on function public.assign_booking_supervisor(uuid, uuid) is
  'Lets a CFI/DCFI allocate an authorised senior instructor to an uncovered future booking without requiring roster availability. The normal acknowledgement workflow remains required.';

comment on table public.booking_supervision_commitments is
  'Auditable exact-slot supervision selections that bypass roster availability, created either by an authorised senior accepting responsibility or by a CFI/DCFI allocation awaiting supervisor acknowledgement.';
