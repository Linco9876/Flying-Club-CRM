-- Supervision capacity is a limit on concurrently supervised instructors, not
-- on booking rows. Back-to-back bookings for the same instructor can have
-- overlapping briefing/debriefing windows and must consume only one place.

create or replace function private.supervision_capacity_available_for_slot(
  p_supervisor_id uuid,
  p_trainee_instructor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking_id uuid,
  p_maximum_concurrent integer
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct supervised.instructor_id) <= p_maximum_concurrent
  from (
    select booking.instructor_id
    from public.bookings booking
    where booking.supervising_instructor_id = p_supervisor_id
      and booking.instructor_id is not null
      and booking.id is distinct from p_exclude_booking_id
      and booking.deleted_at is null
      and booking.status not in ('cancelled', 'no-show')
      and booking.supervision_status in ('assigned', 'acknowledged')
      and booking.start_time < p_end
      and booking.end_time > p_start

    union all

    select p_trainee_instructor_id
    where p_trainee_instructor_id is not null
  ) supervised;
$$;

revoke all on function private.supervision_capacity_available_for_slot(
  uuid, uuid, timestamptz, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

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

  return private.supervision_capacity_available_for_slot(
    p_supervisor_id,
    p_trainee_instructor_id,
    p_start,
    p_end,
    p_exclude_booking_id,
    v_maximum
  );
end;
$$;

revoke all on function private.manual_supervisor_available_for_slot(
  uuid, uuid, timestamptz, timestamptz, text, text, uuid
) from public, anon, authenticated, service_role;

-- Retain the public compatibility helper for older internal callers. Without a
-- prospective trainee argument it remains conservative, but duplicate booking
-- rows for an already supervised instructor no longer inflate its count.
create or replace function public.supervisor_available_for_slot(
  p_supervisor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_maximum integer;
  v_count integer;
  v_duty_assessment jsonb;
begin
  select authorisation.maximum_concurrent
  into v_maximum
  from public.senior_instructor_authorisations authorisation
  where authorisation.instructor_id = p_supervisor_id
    and authorisation.is_active
    and (
      p_end < now()
      or authorisation.effective_from <= (p_start at time zone 'Australia/Sydney')::date
    )
    and (
      authorisation.effective_to is null
      or authorisation.effective_to >= (p_end at time zone 'Australia/Sydney')::date
    )
    and (
      authorisation.qualification_expires_on is null
      or authorisation.qualification_expires_on >= (p_end at time zone 'Australia/Sydney')::date
    );

  if not found then
    return false;
  end if;

  if not public.trial_voucher_instructor_available_for_slot(
    p_supervisor_id,
    p_start,
    p_end
  ) then
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

  select count(distinct booking.instructor_id)
  into v_count
  from public.bookings booking
  where booking.supervising_instructor_id = p_supervisor_id
    and booking.instructor_id is not null
    and booking.id is distinct from p_exclude_booking_id
    and booking.deleted_at is null
    and booking.status not in ('cancelled', 'no-show')
    and booking.supervision_status in ('assigned', 'acknowledged')
    and booking.start_time < p_end
    and booking.end_time > p_start;

  return v_count < v_maximum;
end;
$$;

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
        and public.trial_voucher_instructor_available_for_slot(
          authorisation.instructor_id,
          p_start,
          p_end
        )
        and (
          public.assess_instructor_duty_booking(
            authorisation.instructor_id,
            p_start,
            p_end,
            p_exclude_booking_id
          )->>'result'
        ) is distinct from 'warning'
        and private.supervision_capacity_available_for_slot(
          authorisation.instructor_id,
          p_trainee_instructor_id,
          p_start,
          p_end,
          p_exclude_booking_id,
          authorisation.maximum_concurrent
        )
      order by authorisation.priority, authorisation.instructor_id
      limit 1
    )
  );
$$;

comment on function private.supervision_capacity_available_for_slot(
  uuid, uuid, timestamptz, timestamptz, uuid, integer
) is 'Counts unique concurrently supervised instructors, including the prospective instructor. Multiple overlapping bookings for the same instructor consume one supervision place.';

comment on function public.supervisor_available_for_slot(
  uuid, timestamptz, timestamptz, uuid
) is 'Returns whether an authorised supervisor remains within duty and unique-instructor supervision-capacity limits for legacy callers.';

comment on function public.find_available_supervisor(
  uuid, timestamptz, timestamptz, text, text, uuid
) is 'Prefers an exact manual commitment, otherwise finds rostered coverage using authorisation, qualification, duty and unique-instructor concurrent capacity.';

-- Reconsider only uncovered bookings. Existing valid assignments remain stable.
update public.bookings
set updated_at = clock_timestamp()
where instructor_id is not null
  and deleted_at is null
  and supervision_required
  and supervision_status = 'pending'
  and status not in ('cancelled', 'no-show', 'completed');

select private.assert_function_permission_manifest();
