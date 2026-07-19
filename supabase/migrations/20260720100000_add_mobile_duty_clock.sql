-- Lightweight iOS/Android duty clock support.

alter table public.duty_periods drop constraint if exists duty_periods_entry_source_check;
alter table public.duty_periods add constraint duty_periods_entry_source_check
  check (entry_source in ('manual', 'mobile', 'automatic_booking'));

create table if not exists public.duty_clock_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_metres integer not null default 1200 check (radius_metres between 50 and 10000),
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

create unique index if not exists duty_clock_locations_one_primary_idx
  on public.duty_clock_locations(is_primary) where is_primary and is_active;

insert into public.duty_clock_locations(name, latitude, longitude, radius_metres, is_primary)
values ('Bendigo Airport', -36.7391667, 144.3297222, 1200, true)
on conflict (name) do nothing;

create table if not exists public.duty_break_sessions (
  id uuid primary key default gen_random_uuid(),
  duty_period_id uuid not null references public.duty_periods(id) on delete cascade,
  instructor_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint duty_break_session_times_valid check (ended_at is null or ended_at > started_at)
);

create unique index if not exists duty_break_sessions_one_open_idx
  on public.duty_break_sessions(instructor_id) where ended_at is null;
create index if not exists duty_break_sessions_period_idx
  on public.duty_break_sessions(duty_period_id, started_at desc);

create table if not exists public.duty_clock_events (
  id uuid primary key default gen_random_uuid(),
  duty_period_id uuid not null references public.duty_periods(id) on delete cascade,
  instructor_id uuid not null references public.users(id) on delete cascade,
  event_type text not null check (event_type in ('duty_start', 'break_start', 'break_end', 'duty_end')),
  event_time timestamptz not null,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  accuracy_metres numeric check (accuracy_metres is null or accuracy_metres >= 0),
  duty_clock_location_id uuid references public.duty_clock_locations(id) on delete set null,
  location_label text,
  inside_geofence boolean,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists duty_clock_events_instructor_idx
  on public.duty_clock_events(instructor_id, event_time desc);
create index if not exists duty_clock_events_period_idx
  on public.duty_clock_events(duty_period_id, event_time);

create or replace function public.duty_geo_distance_metres(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_latitude_b - p_latitude_a) / 2), 2)
    + cos(radians(p_latitude_a)) * cos(radians(p_latitude_b))
    * power(sin(radians(p_longitude_b - p_longitude_a) / 2), 2)
  ));
$$;

create or replace function public.mobile_user_can_clock_duty(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1 from public.user_roles ur
     where ur.user_id = p_user_id
       and ur.role in ('admin', 'senior_instructor', 'instructor')
  );
$$;

create or replace function public.mobile_get_duty_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_duty public.duty_periods%rowtype;
  v_break public.duty_break_sessions%rowtype;
  v_flight_minutes integer := 0;
  v_flight_count bigint := 0;
  v_date date;
  v_locations jsonb := '[]'::jsonb;
begin
  if not public.mobile_user_can_clock_duty(v_user_id) then
    return jsonb_build_object('allowed', false);
  end if;

  select name into v_name from public.users where id = v_user_id;
  select * into v_duty from public.duty_periods
   where instructor_id = v_user_id and status = 'active'
   order by actual_start desc limit 1;

  if v_duty.id is not null then
    select * into v_break from public.duty_break_sessions
     where instructor_id = v_user_id and duty_period_id = v_duty.id and ended_at is null
     order by started_at desc limit 1;
  end if;

  v_date := coalesce(v_duty.duty_date, (now() at time zone 'Australia/Sydney')::date);
  select
    coalesce(sum(greatest(0, round(coalesce(nullif(fl.duration, 0), fl.flight_duration, 0) * 60)))::integer, 0),
    count(*)
    into v_flight_minutes, v_flight_count
    from public.flight_logs fl
    left join public.bookings b on b.id = fl.booking_id
   where fl.instructor_id = v_user_id
     and (coalesce(fl.start_time, b.start_time) at time zone 'Australia/Sydney')::date = v_date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'latitude', l.latitude,
    'longitude', l.longitude,
    'radiusMetres', l.radius_metres,
    'isPrimary', l.is_primary
  ) order by l.is_primary desc, l.name), '[]'::jsonb)
    into v_locations
    from public.duty_clock_locations l where l.is_active;

  return jsonb_build_object(
    'allowed', true,
    'profile', jsonb_build_object('id', v_user_id, 'name', coalesce(v_name, 'Instructor')),
    'activeDuty', case when v_duty.id is null then null else jsonb_build_object(
      'id', v_duty.id,
      'actualStart', v_duty.actual_start,
      'location', v_duty.location,
      'entrySource', v_duty.entry_source,
      'dutyDate', v_duty.duty_date,
      'maximumEnd', public.maximum_duty_end(v_duty.actual_start)
    ) end,
    'activeBreak', case when v_break.id is null then null else jsonb_build_object(
      'id', v_break.id,
      'startedAt', v_break.started_at
    ) end,
    'loggedFlightMinutes', v_flight_minutes,
    'loggedFlightCount', v_flight_count,
    'locations', v_locations,
    'maximumBackdateMinutes', 120,
    'serverTime', now()
  );
end;
$$;

create or replace function public.mobile_start_duty(
  p_actual_start timestamptz,
  p_location_label text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_metres numeric default null,
  p_duty_clock_location_id uuid default null,
  p_geofence_notes text default null,
  p_fit_for_duty boolean default true,
  p_external_duty_declared boolean default false,
  p_sleep_opportunity_confirmed boolean default true,
  p_kss_score integer default null,
  p_private_note text default null,
  p_device_platform text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_location public.duty_clock_locations%rowtype;
  v_distance double precision;
  v_inside boolean := false;
  v_period_id uuid;
begin
  if not public.mobile_user_can_clock_duty(v_user_id) then
    raise exception 'This app is available to instructors and administrators only';
  end if;
  if p_actual_start < now() - interval '120 minutes' or p_actual_start > now() + interval '5 minutes' then
    raise exception 'Duty start must be within the last 2 hours';
  end if;
  if not p_fit_for_duty then
    raise exception 'You cannot start duty while marked not fit for duty';
  end if;
  if not p_external_duty_declared then
    raise exception 'Confirm that relevant external duty has been declared or that there is none';
  end if;
  if p_kss_score is not null and (p_kss_score < 1 or p_kss_score > 9) then
    raise exception 'KSS score must be between 1 and 9';
  end if;
  if (not p_sleep_opportunity_confirmed or coalesce(p_kss_score, 1) >= 7)
     and length(btrim(coalesce(p_private_note, ''))) < 10 then
    raise exception 'Add a short fatigue note when sleep opportunity was inadequate or KSS is 7 or higher';
  end if;
  if exists (select 1 from public.duty_periods where instructor_id = v_user_id and status = 'active') then
    raise exception 'You already have an active duty period';
  end if;
  if exists (
    select 1 from public.duty_periods d
     where d.instructor_id = v_user_id
       and d.status = 'completed'
       and coalesce(d.actual_start, d.planned_start) <= p_actual_start
       and coalesce(d.actual_end, d.planned_end) > p_actual_start
  ) then
    raise exception 'The selected start time overlaps an existing duty period';
  end if;

  if p_latitude is not null and p_longitude is not null then
    if p_duty_clock_location_id is not null then
      select * into v_location from public.duty_clock_locations
       where id = p_duty_clock_location_id and is_active;
    else
      select * into v_location from public.duty_clock_locations l
       where l.is_active
       order by public.duty_geo_distance_metres(p_latitude, p_longitude, l.latitude, l.longitude)
       limit 1;
    end if;
    if v_location.id is not null then
      v_distance := public.duty_geo_distance_metres(p_latitude, p_longitude, v_location.latitude, v_location.longitude);
      v_inside := v_distance <= v_location.radius_metres + least(coalesce(p_accuracy_metres, 0), 100);
    end if;
  end if;

  if not v_inside and length(btrim(coalesce(p_geofence_notes, ''))) < 10 then
    raise exception 'Add a short note because the clock-in is outside the club location or GPS was unavailable';
  end if;

  insert into public.duty_periods(
    instructor_id, duty_date, actual_start, location, status, entry_source, notes, created_by, updated_by
  ) values (
    v_user_id,
    (p_actual_start at time zone 'Australia/Sydney')::date,
    p_actual_start,
    coalesce(nullif(btrim(p_location_label), ''), v_location.name, 'Off-site'),
    'active',
    'mobile',
    nullif(btrim(p_geofence_notes), ''),
    v_user_id,
    v_user_id
  ) returning id into v_period_id;

  insert into public.fatigue_declarations(
    instructor_id, duty_period_id, fit_for_duty, external_duty_declared,
    sleep_opportunity_confirmed, kss_score, private_note, created_by
  ) values (
    v_user_id, v_period_id, p_fit_for_duty, p_external_duty_declared,
    p_sleep_opportunity_confirmed, p_kss_score, nullif(btrim(p_private_note), ''), v_user_id
  );

  insert into public.duty_clock_events(
    duty_period_id, instructor_id, event_type, event_time, latitude, longitude,
    accuracy_metres, duty_clock_location_id, location_label, inside_geofence, notes, metadata
  ) values (
    v_period_id, v_user_id, 'duty_start', p_actual_start, p_latitude, p_longitude,
    p_accuracy_metres, v_location.id, coalesce(nullif(btrim(p_location_label), ''), v_location.name, 'Off-site'),
    v_inside, nullif(btrim(p_geofence_notes), ''),
    jsonb_build_object('distanceMetres', v_distance, 'devicePlatform', p_device_platform)
  );

  return v_period_id;
end;
$$;

create or replace function public.mobile_start_break(p_started_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_duty public.duty_periods%rowtype;
  v_break_id uuid;
begin
  select * into v_duty from public.duty_periods
   where instructor_id = v_user_id and status = 'active'
   order by actual_start desc limit 1 for update;
  if v_duty.id is null then raise exception 'Start duty before starting a break'; end if;
  if p_started_at < v_duty.actual_start or p_started_at > now() + interval '5 minutes' then
    raise exception 'Break start time is outside the active duty period';
  end if;
  if exists (select 1 from public.duty_break_sessions where instructor_id = v_user_id and ended_at is null) then
    raise exception 'A break is already active';
  end if;

  insert into public.duty_break_sessions(duty_period_id, instructor_id, started_at)
  values (v_duty.id, v_user_id, p_started_at) returning id into v_break_id;
  insert into public.duty_clock_events(duty_period_id, instructor_id, event_type, event_time, metadata)
  values (v_duty.id, v_user_id, 'break_start', p_started_at, jsonb_build_object('breakSessionId', v_break_id));
  return v_break_id;
end;
$$;

create or replace function public.mobile_end_break(p_ended_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_break public.duty_break_sessions%rowtype;
  v_duty_break_id uuid;
begin
  select * into v_break from public.duty_break_sessions
   where instructor_id = v_user_id and ended_at is null
   order by started_at desc limit 1 for update;
  if v_break.id is null then raise exception 'There is no active break'; end if;
  if p_ended_at <= v_break.started_at or p_ended_at > now() + interval '5 minutes' then
    raise exception 'Break end must be after the break started';
  end if;

  update public.duty_break_sessions set ended_at = p_ended_at where id = v_break.id;
  insert into public.duty_breaks(
    duty_period_id, break_start, break_end, break_type, free_of_duty,
    affects_calculation, notes, created_by
  ) values (
    v_break.duty_period_id, v_break.started_at, p_ended_at, 'break', false,
    false, 'Recorded in Duty Clock app', v_user_id
  ) returning id into v_duty_break_id;
  insert into public.duty_clock_events(duty_period_id, instructor_id, event_type, event_time, metadata)
  values (v_break.duty_period_id, v_user_id, 'break_end', p_ended_at, jsonb_build_object('breakSessionId', v_break.id));
  return v_duty_break_id;
end;
$$;

create or replace function public.mobile_end_duty(
  p_actual_end timestamptz,
  p_flight_minutes integer,
  p_notes text default null,
  p_device_platform text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_duty public.duty_periods%rowtype;
  v_break public.duty_break_sessions%rowtype;
begin
  select * into v_duty from public.duty_periods
   where instructor_id = v_user_id and status = 'active'
   order by actual_start desc limit 1 for update;
  if v_duty.id is null then raise exception 'There is no active duty period'; end if;
  if p_actual_end <= v_duty.actual_start or p_actual_end > now() + interval '5 minutes' then
    raise exception 'Duty end must be after the duty start and cannot be in the future';
  end if;
  if p_flight_minutes < 0 or p_flight_minutes > 1440 then
    raise exception 'Flight time must be between 0 and 24 hours';
  end if;
  if exists (select 1 from public.duty_breaks where duty_period_id = v_duty.id and break_end > p_actual_end) then
    raise exception 'Duty cannot end before a recorded break has finished';
  end if;

  select * into v_break from public.duty_break_sessions
   where instructor_id = v_user_id and duty_period_id = v_duty.id and ended_at is null
   order by started_at desc limit 1 for update;
  if v_break.id is not null then
    if p_actual_end <= v_break.started_at then
      raise exception 'Duty cannot end before the active break started';
    end if;
    update public.duty_break_sessions set ended_at = p_actual_end where id = v_break.id;
    insert into public.duty_breaks(
      duty_period_id, break_start, break_end, break_type, free_of_duty,
      affects_calculation, notes, created_by
    ) values (
      v_duty.id, v_break.started_at, p_actual_end, 'break', false,
      false, 'Automatically ended when duty was clocked off', v_user_id
    );
    insert into public.duty_clock_events(duty_period_id, instructor_id, event_type, event_time, metadata)
    values (v_duty.id, v_user_id, 'break_end', p_actual_end, jsonb_build_object('breakSessionId', v_break.id, 'endedWithDuty', true));
  end if;

  update public.duty_periods
     set actual_end = p_actual_end,
         status = 'completed',
         flight_minutes = p_flight_minutes,
         notes = concat_ws(E'\n', nullif(notes, ''), nullif(btrim(p_notes), '')),
         completed_at = now(),
         updated_at = now(),
         updated_by = v_user_id
   where id = v_duty.id;

  insert into public.duty_clock_events(duty_period_id, instructor_id, event_type, event_time, notes, metadata)
  values (v_duty.id, v_user_id, 'duty_end', p_actual_end, nullif(btrim(p_notes), ''), jsonb_build_object('flightMinutes', p_flight_minutes, 'devicePlatform', p_device_platform));
  return v_duty.id;
end;
$$;

alter table public.duty_clock_locations enable row level security;
alter table public.duty_break_sessions enable row level security;
alter table public.duty_clock_events enable row level security;

create policy "Duty users read clock locations" on public.duty_clock_locations
  for select to authenticated using (public.mobile_user_can_clock_duty());
create policy "Admins manage clock locations" on public.duty_clock_locations
  for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Duty users read own break sessions" on public.duty_break_sessions
  for select to authenticated using (instructor_id = auth.uid() or public.current_user_is_admin());
create policy "Duty users read own clock events" on public.duty_clock_events
  for select to authenticated using (instructor_id = auth.uid() or public.current_user_is_admin());

grant select on public.duty_clock_locations, public.duty_break_sessions, public.duty_clock_events to authenticated;
revoke all on function public.mobile_get_duty_context() from public;
revoke all on function public.mobile_start_duty(timestamptz, text, double precision, double precision, numeric, uuid, text, boolean, boolean, boolean, integer, text, text) from public;
revoke all on function public.mobile_start_break(timestamptz) from public;
revoke all on function public.mobile_end_break(timestamptz) from public;
revoke all on function public.mobile_end_duty(timestamptz, integer, text, text) from public;
grant execute on function public.mobile_get_duty_context() to authenticated;
grant execute on function public.mobile_start_duty(timestamptz, text, double precision, double precision, numeric, uuid, text, boolean, boolean, boolean, integer, text, text) to authenticated;
grant execute on function public.mobile_start_break(timestamptz) to authenticated;
grant execute on function public.mobile_end_break(timestamptz) to authenticated;
grant execute on function public.mobile_end_duty(timestamptz, integer, text, text) to authenticated;
