-- Prompt for a missing in-duty break when the configured fatigue rule says one was due.
-- Defaults reflect clause 17.1 of the Pilots Award: more than 5 hours on duty
-- without a 30-minute meal break free of duty. They remain configurable because
-- award coverage and operational arrangements must be confirmed by the club.

alter table public.booking_rules_settings
  add column if not exists fatigue_break_required_after_hours numeric not null default 5,
  add column if not exists fatigue_min_break_minutes integer not null default 30;

alter table public.booking_rules_settings
  drop constraint if exists booking_rules_fatigue_break_after_valid,
  add constraint booking_rules_fatigue_break_after_valid
    check (fatigue_break_required_after_hours > 0 and fatigue_break_required_after_hours <= 16),
  drop constraint if exists booking_rules_fatigue_min_break_valid,
  add constraint booking_rules_fatigue_min_break_valid
    check (fatigue_min_break_minutes >= 1 and fatigue_min_break_minutes <= 240);

alter table public.duty_periods
  add column if not exists break_confirmation text,
  add column if not exists break_confirmed_at timestamptz,
  drop constraint if exists duty_periods_break_confirmation_valid,
  add constraint duty_periods_break_confirmation_valid
    check (break_confirmation is null or break_confirmation in ('taken', 'not_taken'));

comment on column public.booking_rules_settings.fatigue_break_required_after_hours is
  'Ask for a missing-break confirmation when duty exceeds this many hours. Default 5 hours reflects Pilots Award clause 17.1.';
comment on column public.booking_rules_settings.fatigue_min_break_minutes is
  'Minimum recorded break duration that satisfies the missing-break check. Default 30 minutes reflects Pilots Award clause 17.1.';
comment on column public.duty_periods.break_confirmation is
  'Instructor response when a completed duty required a missing-break check.';
comment on column public.duty_periods.break_confirmed_at is
  'Time the instructor answered the missing-break check.';

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
  v_rules public.booking_rules_settings%rowtype;
  v_flight_minutes integer := 0;
  v_flight_count bigint := 0;
  v_date date;
  v_locations jsonb := '[]'::jsonb;
  v_recorded_breaks jsonb := '[]'::jsonb;
begin
  if not public.mobile_user_can_clock_duty(v_user_id) then
    return jsonb_build_object('allowed', false);
  end if;

  select name into v_name from public.users where id = v_user_id;
  select * into v_rules from public.booking_rules_settings order by created_at limit 1;
  select * into v_duty from public.duty_periods
   where instructor_id = v_user_id and status = 'active'
   order by actual_start desc limit 1;

  if v_duty.id is not null then
    select * into v_break from public.duty_break_sessions
     where instructor_id = v_user_id and duty_period_id = v_duty.id and ended_at is null
     order by started_at desc limit 1;

    select coalesce(
      jsonb_agg(jsonb_build_object('start', b.break_start, 'end', b.break_end) order by b.break_start),
      '[]'::jsonb
    )
      into v_recorded_breaks
      from public.duty_breaks b
     where b.duty_period_id = v_duty.id;
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
    'recordedBreaks', v_recorded_breaks,
    'fatiguePolicy', jsonb_build_object(
      'enabled', coalesce(v_rules.fatigue_rules_enabled, true),
      'breakRequiredAfterMinutes', round(coalesce(v_rules.fatigue_break_required_after_hours, 5) * 60),
      'minimumBreakMinutes', coalesce(v_rules.fatigue_min_break_minutes, 30)
    ),
    'loggedFlightMinutes', v_flight_minutes,
    'loggedFlightCount', v_flight_count,
    'locations', v_locations,
    'maximumBackdateMinutes', 120,
    'serverTime', now()
  );
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
    v_break.duty_period_id, v_break.started_at, p_ended_at, 'break', true,
    false, 'Free-of-duty break recorded in Duty Clock app', v_user_id
  ) returning id into v_duty_break_id;
  insert into public.duty_clock_events(duty_period_id, instructor_id, event_type, event_time, metadata)
  values (v_break.duty_period_id, v_user_id, 'break_end', p_ended_at, jsonb_build_object('breakSessionId', v_break.id));
  return v_duty_break_id;
end;
$$;

drop function if exists public.mobile_end_duty(timestamptz, integer, text, text);

create function public.mobile_end_duty(
  p_actual_end timestamptz,
  p_flight_minutes integer,
  p_notes text default null,
  p_device_platform text default null,
  p_break_taken boolean default null,
  p_break_start timestamptz default null,
  p_break_end timestamptz default null
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
  v_rules public.booking_rules_settings%rowtype;
  v_break_required boolean := false;
  v_has_qualifying_break boolean := false;
  v_min_break_minutes integer := 30;
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

  select * into v_rules from public.booking_rules_settings order by created_at limit 1;
  v_min_break_minutes := coalesce(v_rules.fatigue_min_break_minutes, 30);
  v_break_required := coalesce(v_rules.fatigue_rules_enabled, true)
    and extract(epoch from (p_actual_end - v_duty.actual_start)) / 3600
      > coalesce(v_rules.fatigue_break_required_after_hours, 5);

  select exists (
    select 1
      from public.duty_breaks b
     where b.duty_period_id = v_duty.id
       and b.break_start >= v_duty.actual_start
       and b.break_end <= p_actual_end
       and extract(epoch from (b.break_end - b.break_start)) / 60 >= v_min_break_minutes
  ) into v_has_qualifying_break;

  select * into v_break from public.duty_break_sessions
   where instructor_id = v_user_id and duty_period_id = v_duty.id and ended_at is null
   order by started_at desc limit 1 for update;

  if v_break.id is not null
    and extract(epoch from (p_actual_end - v_break.started_at)) / 60 >= v_min_break_minutes then
    v_has_qualifying_break := true;
  end if;

  if v_break_required and not v_has_qualifying_break and p_break_taken is true then
    if p_break_start is null or p_break_end is null then
      raise exception 'Enter when the break started and finished';
    end if;
    if p_break_start < v_duty.actual_start or p_break_end > p_actual_end or p_break_end <= p_break_start then
      raise exception 'Break times must fall within the duty period';
    end if;
    if extract(epoch from (p_break_end - p_break_start)) / 60 < v_min_break_minutes then
      raise exception 'The recorded break must be at least % minutes', v_min_break_minutes;
    end if;

    insert into public.duty_breaks(
      duty_period_id, break_start, break_end, break_type, free_of_duty,
      affects_calculation, notes, created_by
    ) values (
      v_duty.id, p_break_start, p_break_end, 'break', true,
      false, 'Added during missing-break confirmation at clock-off', v_user_id
    );
    insert into public.duty_clock_events(duty_period_id, instructor_id, event_type, event_time, metadata)
    values
      (v_duty.id, v_user_id, 'break_start', p_break_start, jsonb_build_object('historicalAtClockOff', true)),
      (v_duty.id, v_user_id, 'break_end', p_break_end, jsonb_build_object('historicalAtClockOff', true));
    v_has_qualifying_break := true;
  end if;

  if v_break.id is not null then
    if p_actual_end <= v_break.started_at then
      raise exception 'Duty cannot end before the active break started';
    end if;
    update public.duty_break_sessions set ended_at = p_actual_end where id = v_break.id;
    insert into public.duty_breaks(
      duty_period_id, break_start, break_end, break_type, free_of_duty,
      affects_calculation, notes, created_by
    ) values (
      v_duty.id, v_break.started_at, p_actual_end, 'break', true,
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
         break_confirmation = case
           when v_break_required and p_break_taken is true then 'taken'
           when v_break_required and p_break_taken is false then 'not_taken'
           else break_confirmation
         end,
         break_confirmed_at = case
           when v_break_required and p_break_taken is not null then now()
           else break_confirmed_at
         end,
         completed_at = now(),
         updated_at = now(),
         updated_by = v_user_id
   where id = v_duty.id;

  insert into public.duty_clock_events(duty_period_id, instructor_id, event_type, event_time, notes, metadata)
  values (
    v_duty.id,
    v_user_id,
    'duty_end',
    p_actual_end,
    nullif(btrim(p_notes), ''),
    jsonb_build_object(
      'flightMinutes', p_flight_minutes,
      'devicePlatform', p_device_platform,
      'breakRequired', v_break_required,
      'qualifyingBreakRecorded', v_has_qualifying_break,
      'breakResponse', case
        when p_break_taken is true then 'taken'
        when p_break_taken is false then 'not_taken'
        else 'not_requested_or_legacy_client'
      end
    )
  );
  return v_duty.id;
end;
$$;

revoke all on function public.mobile_get_duty_context() from public, anon;
revoke all on function public.mobile_end_break(timestamptz) from public, anon;
revoke all on function public.mobile_end_duty(timestamptz, integer, text, text, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function public.mobile_get_duty_context() to authenticated;
grant execute on function public.mobile_end_break(timestamptz) to authenticated;
grant execute on function public.mobile_end_duty(timestamptz, integer, text, text, boolean, timestamptz, timestamptz) to authenticated;
