-- Allow a currently authorised senior instructor to make an explicit, audited
-- commitment to supervise an otherwise uncovered booking. The commitment
-- replaces roster availability only; authorisation scope, qualification, duty
-- and concurrent-supervision limits remain mandatory.

create table if not exists public.booking_supervision_commitments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  supervising_instructor_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'accepted'
    check (status in ('accepted', 'withdrawn', 'invalidated', 'cancelled')),
  booking_instructor_id uuid not null references public.users(id) on delete restrict,
  covered_start timestamptz not null,
  covered_end timestamptz not null,
  booking_location text not null,
  activity_type text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  ended_by uuid references public.users(id) on delete set null,
  end_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (covered_end > covered_start)
);

create unique index if not exists booking_supervision_commitments_one_active_idx
  on public.booking_supervision_commitments(booking_id)
  where status = 'accepted';

create index if not exists booking_supervision_commitments_supervisor_idx
  on public.booking_supervision_commitments(
    supervising_instructor_id,
    covered_start,
    covered_end
  )
  where status = 'accepted';

alter table public.booking_supervision_commitments enable row level security;

drop policy if exists "Staff read supervision commitments"
  on public.booking_supervision_commitments;
create policy "Staff read supervision commitments"
  on public.booking_supervision_commitments
  for select
  to authenticated
  using (public.current_user_has_staff_role());

revoke all on table public.booking_supervision_commitments
  from public, anon, authenticated;
grant select on table public.booking_supervision_commitments to authenticated;
grant select, insert, update, delete on table public.booking_supervision_commitments
  to service_role;

create or replace function private.manual_supervisor_available_for_slot(
  p_supervisor_id uuid,
  p_trainee_instructor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_location text,
  p_activity_type text,
  p_exclude_booking_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_maximum integer;
  v_count integer;
  v_duty_assessment jsonb;
begin
  if p_supervisor_id is null
    or p_supervisor_id = p_trainee_instructor_id
    or p_start is null
    or p_end is null
    or p_end <= p_start
  then
    return false;
  end if;

  select authorisation.maximum_concurrent
  into v_maximum
  from public.senior_instructor_authorisations authorisation
  where authorisation.instructor_id = p_supervisor_id
    and authorisation.is_active
    and (
      p_end < now()
      or authorisation.effective_from <= (
        p_start at time zone 'Australia/Sydney'
      )::date
    )
    and (
      authorisation.effective_to is null
      or authorisation.effective_to >= (
        p_end at time zone 'Australia/Sydney'
      )::date
    )
    and (
      authorisation.qualification_expires_on is null
      or authorisation.qualification_expires_on >= (
        p_end at time zone 'Australia/Sydney'
      )::date
    )
    and (
      authorisation.remote_supervision_allowed
      or cardinality(authorisation.locations) = 0
      or exists (
        select 1
        from unnest(authorisation.locations) authorised_location
        where lower(authorised_location) = lower(coalesce(p_location, 'Bendigo'))
      )
    )
    and (
      cardinality(authorisation.activity_types) = 0
      or exists (
        select 1
        from unnest(authorisation.activity_types) authorised_activity
        where lower(authorised_activity) = lower(coalesce(p_activity_type, 'flight'))
      )
    );

  if not found then
    return false;
  end if;

  v_duty_assessment := public.assess_instructor_duty_booking(
    p_supervisor_id,
    p_start,
    p_end,
    p_exclude_booking_id
  );
  if v_duty_assessment->>'result' = 'warning' then
    return false;
  end if;

  select count(*)
  into v_count
  from public.bookings booking
  where booking.supervising_instructor_id = p_supervisor_id
    and booking.id is distinct from p_exclude_booking_id
    and booking.deleted_at is null
    and booking.status not in ('cancelled', 'no-show')
    and booking.supervision_status in ('assigned', 'acknowledged')
    and booking.start_time < p_end
    and booking.end_time > p_start;

  return v_count < v_maximum;
end;
$$;

revoke all on function private.manual_supervisor_available_for_slot(
  uuid, uuid, timestamptz, timestamptz, text, text, uuid
) from public, anon, authenticated, service_role;

-- Prefer a valid explicit commitment for this exact supervision window. If it
-- is absent or no longer valid, retain the existing roster-based selection.
create or replace function public.find_available_supervisor(
  p_trainee_instructor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_location text default 'Bendigo',
  p_activity_type text default 'flight',
  p_exclude_booking_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select commitment.supervising_instructor_id
      from public.booking_supervision_commitments commitment
      where commitment.booking_id = p_exclude_booking_id
        and commitment.status = 'accepted'
        and commitment.booking_instructor_id = p_trainee_instructor_id
        and commitment.covered_start = p_start
        and commitment.covered_end = p_end
        and lower(commitment.booking_location) = lower(coalesce(p_location, 'Bendigo'))
        and lower(commitment.activity_type) = lower(coalesce(p_activity_type, 'flight'))
        and private.manual_supervisor_available_for_slot(
          commitment.supervising_instructor_id,
          p_trainee_instructor_id,
          p_start,
          p_end,
          p_location,
          p_activity_type,
          p_exclude_booking_id
        )
      order by commitment.accepted_at desc
      limit 1
    ),
    (
      select authorisation.instructor_id
      from public.senior_instructor_authorisations authorisation
      where authorisation.is_active
        and authorisation.instructor_id <> p_trainee_instructor_id
        and (
          p_end < now()
          or authorisation.effective_from <= (
            p_start at time zone 'Australia/Sydney'
          )::date
        )
        and (
          authorisation.effective_to is null
          or authorisation.effective_to >= (
            p_end at time zone 'Australia/Sydney'
          )::date
        )
        and (
          authorisation.qualification_expires_on is null
          or authorisation.qualification_expires_on >= (
            p_end at time zone 'Australia/Sydney'
          )::date
        )
        and (
          authorisation.remote_supervision_allowed
          or cardinality(authorisation.locations) = 0
          or p_location = any(authorisation.locations)
        )
        and (
          cardinality(authorisation.activity_types) = 0
          or p_activity_type = any(authorisation.activity_types)
        )
        and exists (
          select 1
          from public.duty_clock_locations location
          where location.is_active
            and lower(location.name) = lower(p_location)
            and (
              public.instructor_available_at_location_for_slot(
                authorisation.instructor_id,
                p_start,
                p_end,
                location.id
              )
              or location.id = any(
                public.supervisor_roster_locations_for_slot(
                  authorisation.instructor_id,
                  p_start,
                  p_end
                )
              )
            )
        )
        and public.supervisor_available_for_slot(
          authorisation.instructor_id,
          p_start,
          p_end,
          p_exclude_booking_id
        )
      order by authorisation.priority, authorisation.instructor_id
      limit 1
    )
  );
$$;

comment on function public.find_available_supervisor(
  uuid, timestamptz, timestamptz, text, text, uuid
) is
  'Prefers an authorised senior instructor who explicitly committed to the exact booking, otherwise finds ordinary rostered supervision. Manual commitment bypasses roster availability only.';

create or replace function public.accept_booking_supervision(
  p_booking_id uuid
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
    raise exception 'Sign in again before accepting supervision';
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
    raise exception 'Only an open booking can be accepted for supervision';
  end if;
  if v_booking.end_time <= now() then
    raise exception 'Past bookings cannot receive a new supervision commitment';
  end if;
  if v_booking.instructor_id is null then
    raise exception 'This booking does not have an instructor who requires supervision';
  end if;
  if not v_booking.supervision_required
    or v_booking.supervision_status <> 'pending'
  then
    raise exception 'This booking no longer needs a manual supervisor';
  end if;
  if exists (
    select 1 from public.flight_logs flight_log
    where flight_log.booking_id = v_booking.id
  ) or exists (
    select 1 from public.ground_session_logs ground_log
    where ground_log.booking_id = v_booking.id
  ) then
    raise exception 'A logged activity cannot receive a new supervision commitment';
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
    v_actor_id,
    v_booking.instructor_id,
    v_covered_start,
    v_covered_end,
    coalesce(v_booking.location, 'Bendigo'),
    v_activity_type,
    v_booking.id
  ) then
    raise exception using
      message = 'You cannot supervise this booking',
      detail = 'Check that your senior-instructor authorisation, qualification, location/activity scope, duty limits and concurrent-supervision capacity cover this booking.';
  end if;

  update public.booking_supervision_commitments commitment
  set status = 'invalidated',
      ended_at = clock_timestamp(),
      ended_by = v_actor_id,
      end_reason = 'Replaced by a new manual supervision commitment',
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
    v_actor_id,
    v_booking.instructor_id,
    v_covered_start,
    v_covered_end,
    coalesce(v_booking.location, 'Bendigo'),
    v_activity_type,
    jsonb_build_object(
      'bookingStart', v_booking.start_time,
      'bookingEnd', v_booking.end_time,
      'source', 'booking_action_menu',
      'rosterAvailabilityOverridden', true
    )
  );

  -- Touching the booking invokes the existing preparation and record triggers.
  -- find_available_supervisor now sees the locked, exact-slot commitment.
  update public.bookings booking
  set updated_at = clock_timestamp()
  where booking.id = v_booking.id;

  select booking.*
  into v_booking
  from public.bookings booking
  where booking.id = p_booking_id;

  if v_booking.supervising_instructor_id is distinct from v_actor_id
    or v_booking.supervision_status = 'pending'
  then
    raise exception 'The supervision commitment could not be applied safely';
  end if;

  update public.bookings booking
  set supervision_status = 'acknowledged',
      updated_at = clock_timestamp()
  where booking.id = v_booking.id;

  update public.booking_supervision_assignments assignment
  set status = 'acknowledged',
      assignment_reason = 'Authorised senior instructor explicitly committed despite roster unavailability',
      acknowledged_at = clock_timestamp()
  where assignment.booking_id = v_booking.id
    and assignment.supervising_instructor_id = v_actor_id
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
    'manual_supervision_accepted',
    v_actor_id,
    jsonb_build_object(
      'supervisionStatus', 'pending',
      'supervisingInstructorId', null
    ),
    jsonb_build_object(
      'supervisionStatus', 'acknowledged',
      'supervisingInstructorId', v_actor_id
    ),
    jsonb_build_object(
      'coveredStart', v_covered_start,
      'coveredEnd', v_covered_end,
      'rosterAvailabilityOverridden', true
    )
  );

  select portal_user.name
  into v_supervisor_name
  from public.users portal_user
  where portal_user.id = v_actor_id;

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'supervisingInstructorId', v_actor_id,
    'supervisingInstructorName', coalesce(v_supervisor_name, 'Senior instructor'),
    'supervisionStatus', 'acknowledged',
    'bookingStatus', (
      select booking.status from public.bookings booking where booking.id = v_booking.id
    )
  );
end;
$$;

revoke all on function public.accept_booking_supervision(uuid)
  from public, anon, authenticated;
grant execute on function public.accept_booking_supervision(uuid)
  to authenticated, service_role;

create or replace function private.invalidate_booking_supervision_commitment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.booking_supervision_commitments commitment
  set status = case
        when new.deleted_at is not null
          or new.status in ('cancelled', 'no-show')
        then 'cancelled'
        else 'invalidated'
      end,
      ended_at = clock_timestamp(),
      ended_by = auth.uid(),
      end_reason = case
        when new.deleted_at is not null
          or new.status in ('cancelled', 'no-show')
        then 'Booking cancelled'
        else 'Booking supervision details changed'
      end,
      updated_at = clock_timestamp()
  where commitment.booking_id = new.id
    and commitment.status = 'accepted';

  return null;
end;
$$;

revoke all on function private.invalidate_booking_supervision_commitment()
  from public, anon, authenticated, service_role;

drop trigger if exists invalidate_manual_supervision_after_booking_change
  on public.bookings;
create trigger invalidate_manual_supervision_after_booking_change
after update of instructor_id, start_time, end_time, location, booking_kind, status, deleted_at
on public.bookings
for each row
when (
  old.instructor_id is distinct from new.instructor_id
  or old.start_time is distinct from new.start_time
  or old.end_time is distinct from new.end_time
  or old.location is distinct from new.location
  or old.booking_kind is distinct from new.booking_kind
  or old.deleted_at is distinct from new.deleted_at
  or (
    old.status is distinct from new.status
    and new.status in ('cancelled', 'no-show')
  )
)
execute function private.invalidate_booking_supervision_commitment();

create or replace function private.invalidate_manual_supervision_after_authorisation_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instructor_id uuid;
begin
  v_instructor_id := case when tg_op = 'DELETE'
    then old.instructor_id
    else new.instructor_id
  end;

  update public.booking_supervision_commitments commitment
  set status = 'invalidated',
      ended_at = clock_timestamp(),
      ended_by = auth.uid(),
      end_reason = 'Senior instructor authorisation changed',
      updated_at = clock_timestamp()
  where commitment.supervising_instructor_id = v_instructor_id
    and commitment.status = 'accepted';

  return null;
end;
$$;

revoke all on function private.invalidate_manual_supervision_after_authorisation_change()
  from public, anon, authenticated, service_role;

drop trigger if exists invalidate_manual_supervision_after_authorisation_change
  on public.senior_instructor_authorisations;
create trigger invalidate_manual_supervision_after_authorisation_change
after update of is_active, locations, activity_types, maximum_concurrent,
  remote_supervision_allowed, effective_from, effective_to,
  qualification_expires_on or delete
on public.senior_instructor_authorisations
for each row
execute function private.invalidate_manual_supervision_after_authorisation_change();

create or replace function private.invalidate_manual_supervision_after_requirement_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instructor_id uuid;
begin
  v_instructor_id := case when tg_op = 'DELETE'
    then old.instructor_id
    else new.instructor_id
  end;

  update public.booking_supervision_commitments commitment
  set status = 'invalidated',
      ended_at = clock_timestamp(),
      ended_by = auth.uid(),
      end_reason = 'Instructor supervision requirement changed',
      updated_at = clock_timestamp()
  where commitment.booking_instructor_id = v_instructor_id
    and commitment.status = 'accepted';

  return null;
end;
$$;

revoke all on function private.invalidate_manual_supervision_after_requirement_change()
  from public, anon, authenticated, service_role;

drop trigger if exists invalidate_manual_supervision_after_requirement_change
  on public.instructor_supervision_requirements;
create trigger invalidate_manual_supervision_after_requirement_change
after insert or update of supervision_required, activity_types, locations,
  preflight_minutes, postflight_minutes, effective_from, effective_to or delete
on public.instructor_supervision_requirements
for each row
execute function private.invalidate_manual_supervision_after_requirement_change();

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
  'public.accept_booking_supervision(p_booking_id uuid)',
  'accept_booking_supervision',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Authorised senior instructor self-service RPC. It locks the booking and enforces authorisation, scope, qualification, duty and capacity before recording an explicit supervision commitment.',
  date '2026-08-18'
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

comment on table public.booking_supervision_commitments is
  'Auditable promises by authorised senior instructors to cover an exact booking supervision window despite not being rostered available.';
comment on function public.accept_booking_supervision(uuid) is
  'Locks an uncovered future booking and lets the signed-in authorised senior instructor commit to its exact supervision window. Roster availability alone is bypassed.';
