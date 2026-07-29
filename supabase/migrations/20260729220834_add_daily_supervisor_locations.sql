-- Give authorised supervisors explicit per-day supervision coverage, separate
-- from the location where their own work and bookings take place.

alter table public.instructor_weekly_schedules
  add column if not exists supervision_location_ids uuid[] not null default '{}'::uuid[];

alter table public.instructor_schedule_changes
  add column if not exists supervision_location_ids uuid[] not null default '{}'::uuid[];

create or replace function public.validate_supervisor_roster_locations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalised uuid[];
begin
  select coalesce(array_agg(selected.location_id order by selected.location_id), '{}'::uuid[])
  into v_normalised
  from (
    select distinct location_id
    from unnest(coalesce(new.supervision_location_ids, '{}'::uuid[])) as chosen(location_id)
    where location_id is not null
  ) selected;

  if exists (
    select 1
    from unnest(v_normalised) as chosen(location_id)
    left join public.duty_clock_locations location on location.id = chosen.location_id
    where location.id is null or not location.is_active
  ) then
    raise exception 'Every supervision location must be an active organisation location';
  end if;

  new.supervision_location_ids := v_normalised;
  return new;
end;
$$;

drop trigger if exists validate_weekly_supervisor_roster_locations
  on public.instructor_weekly_schedules;
create trigger validate_weekly_supervisor_roster_locations
before insert or update of supervision_location_ids
on public.instructor_weekly_schedules
for each row execute function public.validate_supervisor_roster_locations();

drop trigger if exists validate_changed_supervisor_roster_locations
  on public.instructor_schedule_changes;
create trigger validate_changed_supervisor_roster_locations
before insert or update of supervision_location_ids
on public.instructor_schedule_changes
for each row execute function public.validate_supervisor_roster_locations();

do $$
declare
  v_primary_location_id uuid;
begin
  select id
  into v_primary_location_id
  from public.duty_clock_locations
  where is_active
  order by is_primary desc, name
  limit 1;

  update public.instructor_weekly_schedules schedule
  set supervision_location_ids = array[coalesce(schedule.location_id, v_primary_location_id)]
  where schedule.is_available
    and cardinality(schedule.supervision_location_ids) = 0
    and coalesce(schedule.location_id, v_primary_location_id) is not null
    and exists (
      select 1
      from public.senior_instructor_authorisations authorisation
      where authorisation.instructor_id = coalesce(schedule.user_id, schedule.instructor_id)
        and authorisation.is_active
    );

  update public.instructor_schedule_changes schedule
  set supervision_location_ids = array[coalesce(schedule.location_id, v_primary_location_id)]
  where schedule.is_available
    and cardinality(schedule.supervision_location_ids) = 0
    and coalesce(schedule.location_id, v_primary_location_id) is not null
    and exists (
      select 1
      from public.senior_instructor_authorisations authorisation
      where authorisation.instructor_id = coalesce(schedule.user_id, schedule.instructor_id)
        and authorisation.is_active
    );
end
$$;

create or replace function public.supervisor_roster_locations_for_slot(
  p_supervisor_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_local_start timestamp;
  v_slot_date date;
  v_day_of_week integer;
  v_location_ids uuid[];
begin
  if p_supervisor_id is null or p_start_time is null or p_end_time is null then
    return '{}'::uuid[];
  end if;

  v_local_start := p_start_time at time zone 'Australia/Sydney';
  v_slot_date := v_local_start::date;
  v_day_of_week := extract(dow from v_slot_date)::integer;

  select schedule.supervision_location_ids
  into v_location_ids
  from public.instructor_schedule_changes schedule
  where (schedule.user_id = p_supervisor_id or schedule.instructor_id = p_supervisor_id)
    and schedule.day_of_week = v_day_of_week
    and coalesce(schedule.effective_from, schedule.change_date) <= v_slot_date
  order by coalesce(schedule.effective_from, schedule.change_date) desc
  limit 1;

  if not found then
    select schedule.supervision_location_ids
    into v_location_ids
    from public.instructor_weekly_schedules schedule
    where (schedule.user_id = p_supervisor_id or schedule.instructor_id = p_supervisor_id)
      and schedule.day_of_week = v_day_of_week
    limit 1;
  end if;

  return coalesce(v_location_ids, '{}'::uuid[]);
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
  select authorisation.instructor_id
  from public.senior_instructor_authorisations authorisation
  where authorisation.is_active
    and authorisation.instructor_id <> p_trainee_instructor_id
    and authorisation.effective_from <= (p_start at time zone 'Australia/Sydney')::date
    and (authorisation.effective_to is null or authorisation.effective_to >= (p_end at time zone 'Australia/Sydney')::date)
    and (authorisation.qualification_expires_on is null or authorisation.qualification_expires_on >= (p_end at time zone 'Australia/Sydney')::date)
    and (
      authorisation.remote_supervision_allowed
      or cardinality(authorisation.locations) = 0
      or p_location = any(authorisation.locations)
    )
    and (cardinality(authorisation.activity_types) = 0 or p_activity_type = any(authorisation.activity_types))
    and exists (
      select 1
      from public.duty_clock_locations location
      where location.is_active
        and lower(location.name) = lower(p_location)
        and location.id = any(
          public.supervisor_roster_locations_for_slot(
            authorisation.instructor_id,
            p_start,
            p_end
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
  limit 1;
$$;

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
      select 1 from public.instructor_weekly_schedules where old.id = any(supervision_location_ids)
      union all
      select 1 from public.instructor_schedule_changes where location_id = old.id
      union all
      select 1 from public.instructor_schedule_changes where old.id = any(supervision_location_ids)
      union all
      select 1 from public.bookings
      where location_id = old.id
        and deleted_at is null
        and end_time >= now()
        and status not in ('cancelled', 'no-show', 'completed')
    ) then
      raise exception 'Move roster days, supervision coverage and future bookings away from % before making it inactive', old.name;
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

revoke all on function public.validate_supervisor_roster_locations() from public, anon;
revoke all on function public.supervisor_roster_locations_for_slot(uuid, timestamptz, timestamptz) from public, anon;

comment on column public.instructor_weekly_schedules.supervision_location_ids is
  'Organisation locations where this authorised supervisor provides coverage on the recurring roster day.';
comment on column public.instructor_schedule_changes.supervision_location_ids is
  'Organisation locations where this authorised supervisor provides coverage for this future roster version and weekday.';
comment on function public.supervisor_roster_locations_for_slot(uuid, timestamptz, timestamptz) is
  'Returns the supervisor coverage locations from the applicable roster version for the booking slot.';
