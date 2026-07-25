create or replace function public.find_next_available_slots(
  p_after timestamptz default now(),
  p_duration_minutes integer default 120,
  p_search_days integer default 30,
  p_aircraft_ids uuid[] default null,
  p_instructor_ids uuid[] default null,
  p_limit integer default 8
) returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  aircraft_id uuid,
  aircraft_registration text,
  aircraft_description text,
  instructor_id uuid,
  instructor_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
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

  return query
  with instructors as (
    select distinct u.id, u.name
    from public.users u
    join public.user_roles ur on ur.user_id = u.id
    where coalesce(u.is_active, true)
      and ur.role in ('instructor', 'senior_instructor', 'admin')
      and (p_instructor_ids is null or u.id = any(p_instructor_ids))
  ),
  aircraft_options as (
    select a.id, a.registration, concat_ws(' ', a.make, a.model) as description
    from public.aircraft a
    where a.status = 'serviceable'
      and not coalesce(a.is_archived, false)
      and (p_aircraft_ids is null or a.id = any(p_aircraft_ids))
  ),
  local_slots as (
    select generated as local_start
    from generate_series(
      date_trunc('day', p_after at time zone 'Australia/Sydney') + interval '6 hours',
      date_trunc('day', p_after at time zone 'Australia/Sydney') + make_interval(days => p_search_days) + interval '20 hours',
      interval '15 minutes'
    ) generated
    where generated::time >= time '06:00'
      and generated::time + make_interval(mins => p_duration_minutes) <= time '20:00'
  ),
  candidates as (
    select
      ls.local_start at time zone 'Australia/Sydney' as candidate_start,
      (ls.local_start + make_interval(mins => p_duration_minutes)) at time zone 'Australia/Sydney' as candidate_end,
      a.id as candidate_aircraft_id,
      a.registration,
      a.description,
      i.id as candidate_instructor_id,
      i.name
    from local_slots ls
    cross join aircraft_options a
    cross join instructors i
  )
  select
    c.candidate_start,
    c.candidate_end,
    c.candidate_aircraft_id,
    c.registration,
    c.description,
    c.candidate_instructor_id,
    c.name
  from candidates c
  where c.candidate_start >= p_after
    and public.trial_voucher_instructor_available_for_slot(
      c.candidate_instructor_id,
      c.candidate_start,
      c.candidate_end
    )
    and not exists (
      select 1
      from public.bookings b
      where b.deleted_at is null
        and b.status not in ('cancelled', 'no-show')
        and b.start_time < c.candidate_end
        and b.end_time > c.candidate_start
        and (
          b.aircraft_id = c.candidate_aircraft_id
          or b.instructor_id = c.candidate_instructor_id
        )
    )
  order by c.candidate_start, c.registration, c.name
  limit least(greatest(p_limit, 1), 20);
end;
$$;

revoke all on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], integer) from public, anon;
grant execute on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], integer) to authenticated, service_role;

comment on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], integer) is
  'Finds conflict-free aircraft/instructor combinations in Australia/Sydney time. Final booking submission still applies membership, duty, supervision and safety rules.';
