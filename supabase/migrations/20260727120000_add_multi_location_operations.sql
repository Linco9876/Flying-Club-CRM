-- Shared organisation locations for bookings, instructor rosters, duty clock and supervision.

alter table public.duty_clock_locations
  add column if not exists address text not null default '';

update public.duty_clock_locations l
set address = o.address
from public.organisation_settings o
where l.is_primary
  and nullif(btrim(l.address), '') is null
  and nullif(btrim(o.address), '') is not null;

drop policy if exists "Full portal users read organisation locations" on public.duty_clock_locations;
create policy "Full portal users read organisation locations"
  on public.duty_clock_locations
  for select to authenticated
  using (public.current_user_has_full_portal_access());

alter table public.instructor_weekly_schedules
  add column if not exists location_id uuid references public.duty_clock_locations(id) on delete restrict;
alter table public.instructor_schedule_changes
  add column if not exists location_id uuid references public.duty_clock_locations(id) on delete restrict;
alter table public.bookings
  add column if not exists location_id uuid references public.duty_clock_locations(id) on delete restrict;

do $$
declare
  v_primary uuid;
begin
  select id into v_primary
  from public.duty_clock_locations
  where is_active
  order by is_primary desc, name
  limit 1;

  update public.instructor_weekly_schedules
  set location_id = v_primary
  where location_id is null;

  update public.instructor_schedule_changes
  set location_id = v_primary
  where location_id is null;

  update public.bookings b
  set location_id = coalesce(
    (
      select l.id
      from public.duty_clock_locations l
      where l.is_active
        and lower(l.name) = lower(b.location)
      limit 1
    ),
    v_primary
  )
  where b.location_id is null;

  update public.bookings b
  set location = l.name
  from public.duty_clock_locations l
  where b.location_id = l.id
    and b.location is distinct from l.name;
end
$$;

insert into public.booking_field_settings (
  field_name,
  label,
  is_required,
  is_visible,
  applies_to_roles,
  display_order,
  help_text
)
values (
  'location',
  'Location',
  true,
  true,
  array['admin', 'senior_instructor', 'instructor', 'student', 'pilot']::text[],
  70,
  'Shown only while more than one business location is active.'
)
on conflict (field_name) do update
set help_text = excluded.help_text;

create or replace function public.save_organisation_locations(p_locations jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location jsonb;
  v_id uuid;
  v_active_count integer;
  v_primary_count integer;
  v_unique_active_names integer;
begin
  if auth.role() <> 'service_role' and not public.current_user_is_admin() then
    raise exception 'Administrator permission is required';
  end if;
  if jsonb_typeof(p_locations) <> 'array' or jsonb_array_length(p_locations) = 0 then
    raise exception 'Keep at least one business location';
  end if;

  select
    count(*) filter (where coalesce((item->>'isActive')::boolean, false)),
    count(*) filter (
      where coalesce((item->>'isActive')::boolean, false)
        and coalesce((item->>'isPrimary')::boolean, false)
    ),
    count(distinct lower(btrim(item->>'name'))) filter (
      where coalesce((item->>'isActive')::boolean, false)
    )
  into v_active_count, v_primary_count, v_unique_active_names
  from jsonb_array_elements(p_locations) item;

  if v_active_count < 1 then
    raise exception 'Keep at least one business location active';
  end if;
  if v_primary_count <> 1 then
    raise exception 'Choose one active primary business location';
  end if;
  if v_unique_active_names <> v_active_count then
    raise exception 'Each active business location needs a unique name';
  end if;

  update public.duty_clock_locations
  set is_primary = false,
      updated_by = auth.uid(),
      updated_at = now()
  where is_primary;

  for v_location in select value from jsonb_array_elements(p_locations)
  loop
    if nullif(btrim(v_location->>'name'), '') is null then
      raise exception 'Every business location needs a name';
    end if;

    v_id := nullif(v_location->>'id', '')::uuid;
    if v_id is null then
      insert into public.duty_clock_locations (
        name,
        address,
        latitude,
        longitude,
        radius_metres,
        is_primary,
        is_active,
        updated_by,
        updated_at
      ) values (
        btrim(v_location->>'name'),
        coalesce(btrim(v_location->>'address'), ''),
        (v_location->>'latitude')::double precision,
        (v_location->>'longitude')::double precision,
        greatest(50, least(10000, (v_location->>'radiusMetres')::integer)),
        coalesce((v_location->>'isPrimary')::boolean, false)
          and coalesce((v_location->>'isActive')::boolean, false),
        coalesce((v_location->>'isActive')::boolean, true),
        auth.uid(),
        now()
      );
    else
      update public.duty_clock_locations
      set name = btrim(v_location->>'name'),
          address = coalesce(btrim(v_location->>'address'), ''),
          latitude = (v_location->>'latitude')::double precision,
          longitude = (v_location->>'longitude')::double precision,
          radius_metres = greatest(50, least(10000, (v_location->>'radiusMetres')::integer)),
          is_primary = coalesce((v_location->>'isPrimary')::boolean, false)
            and coalesce((v_location->>'isActive')::boolean, false),
          is_active = coalesce((v_location->>'isActive')::boolean, true),
          updated_by = auth.uid(),
          updated_at = now()
      where id = v_id;
      if not found then
        raise exception 'Business location no longer exists';
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.instructor_roster_location_for_slot(
  p_instructor_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_local_start timestamp;
  v_slot_date date;
  v_day_of_week integer;
  v_location_id uuid;
begin
  if p_instructor_id is null or p_start_time is null or p_end_time is null then
    return null;
  end if;

  v_local_start := p_start_time at time zone 'Australia/Sydney';
  v_slot_date := v_local_start::date;
  v_day_of_week := extract(dow from v_slot_date)::integer;

  select c.location_id into v_location_id
  from public.instructor_schedule_changes c
  where (c.user_id = p_instructor_id or c.instructor_id = p_instructor_id)
    and c.day_of_week = v_day_of_week
    and coalesce(c.effective_from, c.change_date) <= v_slot_date
  order by coalesce(c.effective_from, c.change_date) desc
  limit 1;

  if not found then
    select s.location_id into v_location_id
    from public.instructor_weekly_schedules s
    where (s.user_id = p_instructor_id or s.instructor_id = p_instructor_id)
      and s.day_of_week = v_day_of_week
    limit 1;
  end if;

  return v_location_id;
end;
$$;

create or replace function public.instructor_available_at_location_for_slot(
  p_instructor_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_location_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roster_location_id uuid;
begin
  if not public.trial_voucher_instructor_available_for_slot(
    p_instructor_id,
    p_start_time,
    p_end_time
  ) then
    return false;
  end if;

  if p_location_id is null then
    return true;
  end if;

  v_roster_location_id := public.instructor_roster_location_for_slot(
    p_instructor_id,
    p_start_time,
    p_end_time
  );
  return v_roster_location_id is null or v_roster_location_id = p_location_id;
end;
$$;

create or replace function public.set_booking_location_and_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location public.duty_clock_locations%rowtype;
  v_roster_location_id uuid;
  v_roster_location_name text;
begin
  if new.location_id is null and nullif(btrim(coalesce(new.location, '')), '') is not null then
    select * into v_location
    from public.duty_clock_locations l
    where l.is_active and lower(l.name) = lower(btrim(new.location))
    limit 1;
  end if;

  if v_location.id is null and new.location_id is not null then
    select * into v_location
    from public.duty_clock_locations l
    where l.id = new.location_id and l.is_active;
    if not found then
      raise exception 'Selected booking location is no longer active';
    end if;
  end if;

  if v_location.id is null then
    select * into v_location
    from public.duty_clock_locations l
    where l.is_active
    order by l.is_primary desc, l.name
    limit 1;
  end if;

  if v_location.id is not null then
    new.location_id := v_location.id;
    new.location := v_location.name;
  end if;

  if new.instructor_id is not null
    and new.status not in ('cancelled', 'no-show', 'completed')
    and new.location_id is not null
  then
    v_roster_location_id := public.instructor_roster_location_for_slot(
      new.instructor_id,
      new.start_time,
      new.end_time
    );
    if v_roster_location_id is not null and v_roster_location_id <> new.location_id then
      select name into v_roster_location_name
      from public.duty_clock_locations
      where id = v_roster_location_id;
      raise exception 'Instructor is rostered at % for this day, not %',
        coalesce(v_roster_location_name, 'another location'),
        v_location.name;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists a_set_booking_location_and_roster_trigger on public.bookings;
create trigger a_set_booking_location_and_roster_trigger
before insert or update of instructor_id, start_time, end_time, location, location_id, status
on public.bookings
for each row execute function public.set_booking_location_and_roster();

create or replace function public.protect_and_sync_organisation_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active and not new.is_active then
    if exists (
      select 1 from public.instructor_weekly_schedules where location_id = old.id
      union all
      select 1 from public.instructor_schedule_changes where location_id = old.id
      union all
      select 1 from public.bookings
      where location_id = old.id
        and deleted_at is null
        and end_time >= now()
        and status not in ('cancelled', 'no-show', 'completed')
    ) then
      raise exception 'Move roster days and future bookings away from % before making it inactive', old.name;
    end if;
  end if;

  if new.name is distinct from old.name then
    update public.bookings
    set location = new.name
    where location_id = new.id;

    update public.instructor_supervision_requirements
    set locations = array_replace(locations, old.name, new.name),
        updated_at = now()
    where old.name = any(locations);

    update public.senior_instructor_authorisations
    set locations = array_replace(locations, old.name, new.name),
        updated_at = now()
    where old.name = any(locations);
  end if;

  return new;
end;
$$;

drop trigger if exists protect_and_sync_organisation_location_trigger on public.duty_clock_locations;
create trigger protect_and_sync_organisation_location_trigger
after update of name, is_active on public.duty_clock_locations
for each row execute function public.protect_and_sync_organisation_location();

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
  select a.instructor_id
  from public.senior_instructor_authorisations a
  where a.is_active
    and a.instructor_id <> p_trainee_instructor_id
    and a.effective_from <= (p_start at time zone 'Australia/Sydney')::date
    and (a.effective_to is null or a.effective_to >= (p_end at time zone 'Australia/Sydney')::date)
    and (a.qualification_expires_on is null or a.qualification_expires_on >= (p_end at time zone 'Australia/Sydney')::date)
    and (a.remote_supervision_allowed or cardinality(a.locations) = 0 or p_location = any(a.locations))
    and (cardinality(a.activity_types) = 0 or p_activity_type = any(a.activity_types))
    and (
      a.remote_supervision_allowed
      or public.instructor_roster_location_for_slot(a.instructor_id, p_start, p_end) is null
      or exists (
        select 1
        from public.duty_clock_locations l
        where l.id = public.instructor_roster_location_for_slot(a.instructor_id, p_start, p_end)
          and lower(l.name) = lower(p_location)
      )
    )
    and public.supervisor_available_for_slot(a.instructor_id, p_start, p_end, p_exclude_booking_id)
  order by a.priority, a.instructor_id
  limit 1;
$$;

drop function if exists public.find_next_available_slots(
  timestamptz,
  integer,
  integer,
  uuid[],
  uuid[],
  integer
);

create function public.find_next_available_slots(
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
  with selected_location as (
    select l.id, l.name
    from public.duty_clock_locations l
    where l.is_active
      and (p_location_id is null or l.id = p_location_id)
    order by
      case when p_location_id is not null and l.id = p_location_id then 0 else 1 end,
      l.is_primary desc,
      l.name
    limit 1
  ),
  instructors as (
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
      i.name,
      l.id as candidate_location_id,
      l.name as candidate_location_name
    from local_slots ls
    cross join aircraft_options a
    cross join instructors i
    cross join selected_location l
  )
  select
    c.candidate_start,
    c.candidate_end,
    c.candidate_aircraft_id,
    c.registration,
    c.description,
    c.candidate_instructor_id,
    c.name,
    c.candidate_location_id,
    c.candidate_location_name
  from candidates c
  where c.candidate_start >= p_after
    and public.instructor_available_at_location_for_slot(
      c.candidate_instructor_id,
      c.candidate_start,
      c.candidate_end,
      c.candidate_location_id
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

revoke all on function public.instructor_roster_location_for_slot(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.instructor_available_at_location_for_slot(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.set_booking_location_and_roster() from public, anon;
revoke all on function public.protect_and_sync_organisation_location() from public, anon;
revoke all on function public.save_organisation_locations(jsonb) from public, anon;
grant execute on function public.save_organisation_locations(jsonb) to authenticated, service_role;
revoke all on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], uuid, integer) from public, anon;
grant execute on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], uuid, integer) to authenticated, service_role;

comment on column public.instructor_weekly_schedules.location_id is
  'Business location where the instructor works on this recurring roster day.';
comment on column public.instructor_schedule_changes.location_id is
  'Business location for this future roster version and weekday.';
comment on column public.bookings.location_id is
  'Stable business location identifier; bookings.location remains populated for backwards compatibility.';
comment on function public.find_next_available_slots(timestamptz, integer, integer, uuid[], uuid[], uuid, integer) is
  'Finds conflict-free aircraft/instructor combinations at the requested business location and respects the instructor roster location.';
