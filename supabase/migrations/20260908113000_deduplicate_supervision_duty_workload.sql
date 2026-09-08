-- Concurrent supervision is workload for fatigue planning, but two instructors
-- supervised over the same period must not be counted as two elapsed hours.
-- Keep the existing duty assessment conservative, then correct its
-- MAX_DAILY_BOOKED_FLIGHT result with a union of the supervisor's occupied
-- time. All other duty, rest, currency, scope and capacity warnings remain
-- blocking for manual supervision.

create or replace function private.supervisor_scheduled_workload_hours(
  p_supervisor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with day_bounds as (
    select
      (((p_start at time zone 'Australia/Sydney')::date)::timestamp
        at time zone 'Australia/Sydney') as starts_at,
      ((((p_start at time zone 'Australia/Sydney')::date + 1)::timestamp)
        at time zone 'Australia/Sydney') as ends_at
  ), activity_intervals as (
    select p_start as starts_at, p_end as ends_at

    union all

    select booking.start_time, booking.end_time
    from public.bookings booking
    cross join day_bounds bounds
    where booking.id is distinct from p_exclude_booking_id
      and booking.deleted_at is null
      and booking.status not in ('cancelled', 'no-show')
      and coalesce(booking.has_conflict, false) is false
      and booking.start_time < bounds.ends_at
      and booking.end_time > bounds.starts_at
      and (
        booking.instructor_id = p_supervisor_id
        or (
          booking.supervising_instructor_id = p_supervisor_id
          and booking.supervision_status in ('assigned', 'acknowledged')
        )
      )
  ), clipped_intervals as (
    select
      greatest(activity.starts_at, bounds.starts_at) as starts_at,
      least(activity.ends_at, bounds.ends_at) as ends_at
    from activity_intervals activity
    cross join day_bounds bounds
    where activity.ends_at > activity.starts_at
  ), ordered_intervals as (
    select
      starts_at,
      ends_at,
      max(ends_at) over (
        order by starts_at, ends_at
        rows between unbounded preceding and 1 preceding
      ) as prior_max_end
    from clipped_intervals
  ), grouped_intervals as (
    select
      starts_at,
      ends_at,
      sum(
        case
          when prior_max_end is null or starts_at > prior_max_end then 1
          else 0
        end
      ) over (order by starts_at, ends_at) as interval_group
    from ordered_intervals
  ), merged_intervals as (
    select min(starts_at) as starts_at, max(ends_at) as ends_at
    from grouped_intervals
    group by interval_group
  )
  select coalesce(
    sum(extract(epoch from (ends_at - starts_at)) / 3600.0),
    0
  )
  from merged_intervals;
$$;

revoke all on function private.supervisor_scheduled_workload_hours(
  uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;

create or replace function private.supervisor_duty_available_for_slot(
  p_supervisor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assessment jsonb;
  v_rule_codes jsonb;
  v_maximum_hours numeric := 7;
  v_workload_hours numeric := 0;
begin
  v_assessment := public.assess_instructor_duty_booking(
    p_supervisor_id,
    p_start,
    p_end,
    p_exclude_booking_id
  );

  if v_assessment->>'result' = 'clear' then
    return true;
  end if;
  if v_assessment->>'result' <> 'warning' then
    return false;
  end if;

  v_rule_codes := coalesce(v_assessment->'ruleCodes', '[]'::jsonb);
  if jsonb_typeof(v_rule_codes) <> 'array'
    or jsonb_array_length(v_rule_codes) = 0
    or exists (
      select 1
      from jsonb_array_elements_text(v_rule_codes) as warning_code(code)
      where warning_code.code <> 'MAX_DAILY_BOOKED_FLIGHT'
    )
  then
    return false;
  end if;

  select coalesce(settings.fatigue_max_flight_hours_per_day, 7)
  into v_maximum_hours
  from public.booking_rules_settings settings
  order by settings.updated_at desc nulls last
  limit 1;
  v_maximum_hours := coalesce(v_maximum_hours, 7);

  v_workload_hours := private.supervisor_scheduled_workload_hours(
    p_supervisor_id,
    p_start,
    p_end,
    p_exclude_booking_id
  );

  return v_workload_hours <= v_maximum_hours;
end;
$$;

revoke all on function private.supervisor_duty_available_for_slot(
  uuid, timestamptz, timestamptz, uuid
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

  if not private.supervisor_duty_available_for_slot(
    p_supervisor_id,
    p_start,
    p_end,
    p_exclude_booking_id
  ) then
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

comment on function private.supervisor_scheduled_workload_hours(
  uuid, timestamptz, timestamptz, uuid
) is 'Returns elapsed occupied workload for a supervisor, merging concurrent instructor and supervision intervals so the same clock time is counted once.';

comment on function private.supervisor_duty_available_for_slot(
  uuid, timestamptz, timestamptz, uuid
) is 'Preserves all duty assessment warnings while correcting a sole daily booked-flight warning with non-overlapping supervisor workload.';

comment on function private.manual_supervisor_available_for_slot(
  uuid, uuid, timestamptz, timestamptz, text, text, uuid
) is 'Validates manual supervision using authorisation, scope, qualification, corrected non-overlapping workload, all other duty rules and unique-instructor capacity.';

select private.assert_function_permission_manifest();
