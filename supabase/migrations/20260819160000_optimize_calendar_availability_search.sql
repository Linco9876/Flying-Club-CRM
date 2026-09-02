create index if not exists bookings_active_aircraft_time_idx
  on public.bookings (aircraft_id, start_time, end_time)
  where deleted_at is null and status not in ('cancelled', 'no-show');

create index if not exists bookings_active_instructor_time_idx
  on public.bookings (instructor_id, start_time, end_time)
  where deleted_at is null and status not in ('cancelled', 'no-show');

create or replace function public.find_next_available_slots(
  p_after timestamptz default now(),
  p_duration_minutes integer default 120,
  p_search_days integer default 30,
  p_aircraft_ids uuid[] default null,
  p_instructor_ids uuid[] default null,
  p_location_id uuid default null,
  p_limit integer default 8
) returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  aircraft_id uuid,
  aircraft_registration text,
  aircraft_description text,
  instructor_id uuid,
  instructor_name text,
  location_id uuid,
  location_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_location_id uuid;
  v_location_name text;
  v_local_start timestamp;
  v_candidate_start timestamptz;
  v_candidate_end timestamptz;
  v_match record;
  v_match_limit integer := least(greatest(p_limit, 1), 20);
  v_match_count integer := 0;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Authentication required';
  end if;
  if p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'Duration must be between 15 minutes and 8 hours';
  end if;
  if p_search_days < 1 or p_search_days > 90 then
    raise exception 'Search range must be between 1 and 90 days';
  end if;

  select l.id, l.name
    into v_location_id, v_location_name
  from public.duty_clock_locations l
  where l.is_active
    and (p_location_id is null or l.id = p_location_id)
  order by
    case when p_location_id is not null and l.id = p_location_id then 0 else 1 end,
    l.is_primary desc,
    l.name
  limit 1;

  if v_location_id is null then
    return;
  end if;

  -- Search chronologically and stop as soon as the requested number of matches
  -- is found. The previous cross-product built and sorted every slot, aircraft
  -- and instructor combination for the whole range before applying LIMIT.
  for v_local_start in
    select generated
    from generate_series(
      date_trunc('day', p_after at time zone 'Australia/Sydney') + interval '6 hours',
      date_trunc('day', p_after at time zone 'Australia/Sydney')
        + make_interval(days => p_search_days - 1) + interval '20 hours',
      interval '15 minutes'
    ) generated
    where generated::time >= time '06:00'
      and generated::time + make_interval(mins => p_duration_minutes) <= time '20:00'
  loop
    v_candidate_start := v_local_start at time zone 'Australia/Sydney';
    v_candidate_end := (v_local_start + make_interval(mins => p_duration_minutes))
      at time zone 'Australia/Sydney';

    if v_candidate_start < p_after then
      continue;
    end if;

    for v_match in
      with eligible_instructors as materialized (
        select u.id, u.name
        from public.users u
        where coalesce(u.is_active, true)
          and (p_instructor_ids is null or u.id = any(p_instructor_ids))
          and exists (
            select 1
            from public.user_roles ur
            where ur.user_id = u.id
              and ur.role in ('instructor', 'senior_instructor', 'admin')
          )
          and public.instructor_available_at_location_for_slot(
            u.id,
            v_candidate_start,
            v_candidate_end,
            v_location_id
          )
      )
      select
        a.id as aircraft_id,
        a.registration,
        concat_ws(' ', a.make, a.model) as aircraft_description,
        i.id as instructor_id,
        i.name as instructor_name
      from public.aircraft a
      cross join eligible_instructors i
      where a.status = 'serviceable'
        and not coalesce(a.is_archived, false)
        and (p_aircraft_ids is null or a.id = any(p_aircraft_ids))
        and not exists (
          select 1
          from public.bookings b
          where b.deleted_at is null
            and b.status not in ('cancelled', 'no-show')
            and b.start_time < v_candidate_end
            and b.end_time > v_candidate_start
            and (
              b.aircraft_id = a.id
              or b.instructor_id = i.id
            )
        )
      order by a.registration, i.name
      limit v_match_limit - v_match_count
    loop
      slot_start := v_candidate_start;
      slot_end := v_candidate_end;
      aircraft_id := v_match.aircraft_id;
      aircraft_registration := v_match.registration;
      aircraft_description := v_match.aircraft_description;
      instructor_id := v_match.instructor_id;
      instructor_name := v_match.instructor_name;
      location_id := v_location_id;
      location_name := v_location_name;
      return next;

      v_match_count := v_match_count + 1;
      if v_match_count >= v_match_limit then
        return;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], uuid, integer) from public, anon;
grant execute on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], uuid, integer) to authenticated, service_role;

select private.assert_function_permission_manifest();

comment on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], uuid, integer) is
  'Finds the earliest conflict-free aircraft/instructor combinations without materialising the full search-range cross product.';
