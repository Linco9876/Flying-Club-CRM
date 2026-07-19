-- Actual duty records, fatigue assessments and automatic senior-instructor supervision.
-- Duty periods are the historical source of truth; bookings are used only to forecast a proposed day.

create table if not exists public.duty_periods (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.users(id) on delete cascade,
  duty_date date not null,
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  location text not null default 'Bendigo',
  status text not null default 'draft' check (status in ('draft', 'active', 'completed')),
  is_external boolean not null default false,
  external_organisation text,
  flight_minutes integer not null default 0 check (flight_minutes >= 0),
  notes text,
  amendment_reason text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint duty_period_times_valid check (
    coalesce(actual_end, planned_end, 'infinity'::timestamptz) > coalesce(actual_start, planned_start, '-infinity'::timestamptz)
  )
);

create table if not exists public.duty_breaks (
  id uuid primary key default gen_random_uuid(),
  duty_period_id uuid not null references public.duty_periods(id) on delete cascade,
  break_start timestamptz not null,
  break_end timestamptz not null,
  break_type text not null default 'break' check (break_type in ('break', 'rest', 'split_duty_rest')),
  free_of_duty boolean not null default false,
  affects_calculation boolean not null default false,
  facility text,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duty_break_times_valid check (break_end > break_start)
);

create table if not exists public.duty_segments (
  id uuid primary key default gen_random_uuid(),
  duty_period_id uuid not null references public.duty_periods(id) on delete cascade,
  segment_type text not null check (segment_type in ('flight_instruction', 'ground_instruction', 'briefing', 'debriefing', 'administration', 'supervision', 'standby', 'positioning', 'other')),
  segment_start timestamptz not null,
  segment_end timestamptz not null,
  booking_id uuid references public.bookings(id) on delete set null,
  flight_log_id uuid references public.flight_logs(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'booking', 'flight_log')),
  counts_as_duty boolean not null default true,
  counts_as_fdp boolean not null default true,
  counts_as_flight boolean not null default false,
  flight_minutes integer not null default 0 check (flight_minutes >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duty_segment_times_valid check (segment_end > segment_start)
);

create table if not exists public.fatigue_declarations (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.users(id) on delete cascade,
  duty_period_id uuid references public.duty_periods(id) on delete set null,
  declared_at timestamptz not null default now(),
  fit_for_duty boolean not null,
  external_duty_declared boolean not null default false,
  sleep_opportunity_confirmed boolean,
  kss_score integer check (kss_score between 1 and 9),
  private_note text,
  created_by uuid references public.users(id)
);

create table if not exists public.fatigue_assessments (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  assessed_start timestamptz not null,
  assessed_end timestamptz not null,
  result text not null check (result in ('clear', 'warning', 'cannot_assess')),
  assessment jsonb not null default '{}'::jsonb,
  engine_version text not null default 'duty-v1',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.duty_rule_overrides (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  instructor_id uuid not null references public.users(id) on delete cascade,
  assessment_id uuid references public.fatigue_assessments(id) on delete set null,
  reason text not null check (length(btrim(reason)) >= 10),
  rule_codes text[] not null default '{}',
  mitigation text,
  overridden_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.instructor_supervision_requirements (
  instructor_id uuid primary key references public.users(id) on delete cascade,
  supervision_required boolean not null default true,
  activity_types text[] not null default array['flight']::text[],
  locations text[] not null default '{}'::text[],
  preflight_minutes integer not null default 30 check (preflight_minutes between 0 and 240),
  postflight_minutes integer not null default 30 check (postflight_minutes between 0 and 240),
  notes text,
  effective_from date not null default current_date,
  effective_to date,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.senior_instructor_authorisations (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null unique references public.users(id) on delete cascade,
  is_active boolean not null default true,
  priority integer not null check (priority > 0),
  locations text[] not null default '{}'::text[],
  activity_types text[] not null default array['flight']::text[],
  maximum_concurrent integer not null default 1 check (maximum_concurrent between 1 and 20),
  remote_supervision_allowed boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  qualification_expires_on date,
  notes text,
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists senior_instructor_authorisations_priority_active_idx
  on public.senior_instructor_authorisations(priority) where is_active;

create table if not exists public.booking_supervision_assignments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  supervising_instructor_id uuid references public.users(id) on delete set null,
  status text not null check (status in ('assigned', 'acknowledged', 'reassigned', 'unassigned', 'cancelled')),
  assignment_reason text,
  assigned_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  replaced_at timestamptz,
  created_by uuid references public.users(id)
);

create unique index if not exists booking_supervision_assignments_active_idx
  on public.booking_supervision_assignments(booking_id)
  where status in ('assigned', 'acknowledged');

create table if not exists public.operations_audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_id uuid references public.users(id),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.bookings
  add column if not exists location text not null default 'Bendigo',
  add column if not exists duty_override_reason text,
  add column if not exists duty_assessment jsonb,
  add column if not exists supervision_required boolean not null default false,
  add column if not exists supervision_status text not null default 'not_required',
  add column if not exists supervising_instructor_id uuid references public.users(id) on delete set null;

alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('confirmed', 'cancelled', 'completed', 'no-show', 'pending_approval', 'pending_supervision'));

alter table public.bookings drop constraint if exists bookings_supervision_status_check;
alter table public.bookings add constraint bookings_supervision_status_check
  check (supervision_status in ('not_required', 'pending', 'assigned', 'acknowledged'));

create index if not exists duty_periods_instructor_time_idx
  on public.duty_periods(instructor_id, duty_date desc, actual_start, actual_end);
create unique index if not exists duty_periods_one_active_per_instructor_idx
  on public.duty_periods(instructor_id) where status = 'active';
create index if not exists duty_breaks_period_idx on public.duty_breaks(duty_period_id, break_start);
create index if not exists duty_segments_period_idx on public.duty_segments(duty_period_id, segment_start);
create index if not exists fatigue_assessments_booking_idx on public.fatigue_assessments(booking_id, created_at desc);
create index if not exists bookings_supervising_instructor_time_idx
  on public.bookings(supervising_instructor_id, start_time, end_time)
  where supervision_status in ('assigned', 'acknowledged') and deleted_at is null;
create index if not exists operations_audit_entity_idx
  on public.operations_audit_events(entity_type, entity_id, created_at desc);

create or replace function public.validate_duty_period_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  if new.status = 'active' and new.actual_start is null then raise exception 'Active duty requires an actual start time'; end if;
  if new.status = 'completed' and (new.actual_start is null or new.actual_end is null) then raise exception 'Completed duty requires actual start and end times'; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and (
    old.actual_start is distinct from new.actual_start or old.actual_end is distinct from new.actual_end
    or old.location is distinct from new.location or old.flight_minutes is distinct from new.flight_minutes
    or old.is_external is distinct from new.is_external or old.notes is distinct from new.notes
  ) and length(btrim(coalesce(new.amendment_reason, ''))) < 10 then
    raise exception 'Changing a completed duty record requires an amendment reason of at least 10 characters';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_duty_period_change_trigger on public.duty_periods;
create trigger validate_duty_period_change_trigger before insert or update on public.duty_periods for each row execute function public.validate_duty_period_change();

create or replace function public.validate_duty_break_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_start timestamptz; v_end timestamptz;
begin
  select coalesce(actual_start, planned_start), coalesce(actual_end, planned_end) into v_start, v_end from public.duty_periods where id = new.duty_period_id;
  if v_start is null or new.break_start < v_start or (v_end is not null and new.break_end > v_end) then raise exception 'Break or rest period must fall within its duty period'; end if;
  if new.affects_calculation and not new.free_of_duty then raise exception 'A break cannot affect the approved calculation unless the person was free of all duty'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_duty_break_change_trigger on public.duty_breaks;
create trigger validate_duty_break_change_trigger before insert or update on public.duty_breaks for each row execute function public.validate_duty_break_change();

create or replace function public.sync_duty_segments(p_duty_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_duty public.duty_periods%rowtype;
begin
  select * into v_duty from public.duty_periods where id = p_duty_period_id;
  if not found or coalesce(v_duty.actual_start, v_duty.planned_start) is null then return; end if;
  delete from public.duty_segments where duty_period_id = p_duty_period_id and source in ('booking', 'flight_log');
  insert into public.duty_segments(duty_period_id, segment_type, segment_start, segment_end, booking_id, flight_log_id, source, counts_as_flight, flight_minutes)
  select v_duty.id,
    case when b.booking_kind = 'ground' then 'ground_instruction' else 'flight_instruction' end,
    coalesce(fl.start_time, b.start_time), coalesce(fl.end_time, b.end_time), b.id, fl.id,
    case when fl.id is null then 'booking' else 'flight_log' end,
    fl.id is not null,
    case when fl.id is null then 0 else greatest(0, round(coalesce(nullif(fl.duration, 0), fl.flight_duration, 0) * 60))::integer end
  from public.bookings b
  left join public.flight_logs fl on fl.booking_id = b.id
  where b.instructor_id = v_duty.instructor_id and b.deleted_at is null and b.status not in ('cancelled', 'no-show')
    and coalesce(fl.start_time, b.start_time) < coalesce(v_duty.actual_end, v_duty.planned_end, now())
    and coalesce(fl.end_time, b.end_time) > coalesce(v_duty.actual_start, v_duty.planned_start);
end;
$$;

create or replace function public.sync_duty_segments_after_period_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_duty_segments(new.id); return new; end; $$;
drop trigger if exists sync_duty_segments_after_period_change_trigger on public.duty_periods;
create trigger sync_duty_segments_after_period_change_trigger after insert or update on public.duty_periods for each row execute function public.sync_duty_segments_after_period_change();

create or replace function public.sync_duty_segments_after_flight_log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_instructor uuid; v_start timestamptz; v_end timestamptz; v_period record;
begin
  if tg_op = 'DELETE' then
    v_instructor := old.instructor_id; v_start := old.start_time; v_end := coalesce(old.end_time, old.start_time);
  else
    v_instructor := new.instructor_id; v_start := new.start_time; v_end := coalesce(new.end_time, new.start_time);
  end if;
  for v_period in select id from public.duty_periods d where d.instructor_id = v_instructor and coalesce(d.actual_start, d.planned_start) < v_end and coalesce(d.actual_end, d.planned_end, now()) > v_start loop
    perform public.sync_duty_segments(v_period.id);
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists sync_duty_segments_after_flight_log_change_trigger on public.flight_logs;
create trigger sync_duty_segments_after_flight_log_change_trigger after insert or update or delete on public.flight_logs for each row execute function public.sync_duty_segments_after_flight_log_change();

create or replace function public.prevent_uncovered_supervised_flight_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.bookings b where b.id = new.booking_id and b.supervision_required
      and (b.supervision_status = 'pending' or b.supervising_instructor_id is null or b.status = 'pending_supervision')
  ) then
    raise exception 'This flight is pending supervision and cannot be confirmed or logged until an authorised senior instructor is available';
  end if;
  return new;
end; $$;
drop trigger if exists prevent_uncovered_supervised_flight_log_trigger on public.flight_logs;
create trigger prevent_uncovered_supervised_flight_log_trigger before insert or update of booking_id on public.flight_logs for each row execute function public.prevent_uncovered_supervised_flight_log();

create or replace function public.casa_appendix_6_fdp_limit_hours(p_start timestamptz)
returns numeric
language sql
stable
set search_path = public
as $$
  select case
    when (p_start at time zone 'Australia/Sydney')::time >= time '05:00'
      and (p_start at time zone 'Australia/Sydney')::time < time '06:00' then 9
    when (p_start at time zone 'Australia/Sydney')::time >= time '06:00'
      and (p_start at time zone 'Australia/Sydney')::time < time '08:00' then 10
    when (p_start at time zone 'Australia/Sydney')::time >= time '08:00'
      and (p_start at time zone 'Australia/Sydney')::time < time '11:00' then 11
    when (p_start at time zone 'Australia/Sydney')::time >= time '11:00'
      and (p_start at time zone 'Australia/Sydney')::time < time '14:00' then 10
    when (p_start at time zone 'Australia/Sydney')::time >= time '14:00'
      and (p_start at time zone 'Australia/Sydney')::time < time '23:00' then 9
    else 8
  end::numeric;
$$;

create or replace function public.assess_instructor_duty_booking(
  p_instructor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rules public.booking_rules_settings%rowtype;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_forecast_start timestamptz;
  v_forecast_end timestamptz;
  v_previous_end timestamptz;
  v_duty_hours numeric := 0;
  v_booked_hours numeric := 0;
  v_effective_limit numeric := 0;
  v_min_rest numeric := 0;
  v_rest_hours numeric;
  v_rolling_7 numeric := 0;
  v_rolling_14 numeric := 0;
  v_rolling_28_flight numeric := 0;
  v_rolling_365_flight numeric := 0;
  v_late_finish_time time := time '22:00';
  v_early_start_time time := time '07:00';
  v_late_count integer := 0;
  v_has_36_hour_gap boolean := false;
  v_off_days integer := 0;
  v_candidate_date date;
  v_warnings jsonb := '[]'::jsonb;
  v_codes text[] := array[]::text[];
  v_enabled boolean := true;
begin
  if p_instructor_id is null or p_start is null or p_end is null or p_end <= p_start then
    return jsonb_build_object('result', 'cannot_assess', 'warnings', '[]'::jsonb, 'message', 'Instructor and valid booking times are required.', 'engineVersion', 'duty-v1');
  end if;

  select * into v_rules from public.booking_rules_settings order by updated_at desc nulls last limit 1;
  if found then
    v_enabled := coalesce(v_rules.fatigue_rules_enabled, true);
    v_min_rest := coalesce(v_rules.fatigue_min_rest_hours, 12);
    v_late_finish_time := coalesce(v_rules.fatigue_late_finish_time::time, time '22:00');
    v_early_start_time := coalesce(v_rules.fatigue_early_start_time::time, time '07:00');
  else
    v_min_rest := 12;
  end if;

  if not v_enabled then
    return jsonb_build_object('result', 'clear', 'warnings', '[]'::jsonb, 'ruleCodes', '[]'::jsonb, 'engineVersion', 'duty-v1', 'rulesEnabled', false);
  end if;

  v_day_start := ((p_start at time zone 'Australia/Sydney')::date::timestamp at time zone 'Australia/Sydney');
  v_day_end := v_day_start + interval '1 day';
  v_candidate_date := (p_start at time zone 'Australia/Sydney')::date;

  select min(start_value), max(end_value)
  into v_forecast_start, v_forecast_end
  from (
    select p_start as start_value, p_end as end_value
    union all
    select coalesce(d.actual_start, d.planned_start), coalesce(d.actual_end, d.planned_end, p_end)
      from public.duty_periods d
     where d.instructor_id = p_instructor_id
       and d.status in ('active', 'completed')
       and coalesce(d.actual_start, d.planned_start) < v_day_end
       and coalesce(d.actual_end, d.planned_end, p_end) > v_day_start
    union all
    select b.start_time, b.end_time
      from public.bookings b
     where b.instructor_id = p_instructor_id
       and b.id is distinct from p_exclude_booking_id
       and b.deleted_at is null
       and b.status not in ('cancelled', 'no-show')
       and coalesce(b.has_conflict, false) is false
       and b.start_time < v_day_end and b.end_time > v_day_start
    union all
    select b.start_time, b.end_time
      from public.bookings b
     where b.supervising_instructor_id = p_instructor_id
       and b.id is distinct from p_exclude_booking_id
       and b.deleted_at is null and b.status not in ('cancelled', 'no-show')
       and b.supervision_status in ('assigned', 'acknowledged')
       and b.start_time < v_day_end and b.end_time > v_day_start
  ) duty_sources;

  v_duty_hours := greatest(0, extract(epoch from (v_forecast_end - v_forecast_start)) / 3600.0);
  select coalesce(sum(extract(epoch from (least(b.end_time, v_day_end) - greatest(b.start_time, v_day_start))) / 3600.0), 0)
    into v_booked_hours from public.bookings b
   where b.instructor_id = p_instructor_id and b.id is distinct from p_exclude_booking_id
     and b.deleted_at is null and b.status not in ('cancelled', 'no-show') and coalesce(b.has_conflict, false) is false
     and b.start_time < v_day_end and b.end_time > v_day_start;
  v_booked_hours := v_booked_hours + extract(epoch from (p_end - p_start)) / 3600.0;
  if coalesce(v_rules.fatigue_include_supervision, true) then
    select v_booked_hours + coalesce(sum(extract(epoch from (least(b.end_time, v_day_end) - greatest(b.start_time, v_day_start))) / 3600.0), 0)
      into v_booked_hours from public.bookings b
     where b.supervising_instructor_id = p_instructor_id and b.id is distinct from p_exclude_booking_id
       and b.deleted_at is null and b.status not in ('cancelled', 'no-show')
       and b.supervision_status in ('assigned', 'acknowledged') and b.start_time < v_day_end and b.end_time > v_day_start;
  end if;
  v_effective_limit := least(
    public.casa_appendix_6_fdp_limit_hours(v_forecast_start),
    coalesce(nullif(v_rules.fatigue_max_duty_hours_per_day, 0), public.casa_appendix_6_fdp_limit_hours(v_forecast_start))
  );

  if v_duty_hours > v_effective_limit then
    v_codes := array_append(v_codes, 'MAX_DAILY_DUTY');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'MAX_DAILY_DUTY', 'severity', 'warning',
      'message', format('Forecast duty is %s hours, above the %s hour limit for this start time.', round(v_duty_hours, 1), round(v_effective_limit, 1))
    ));
  end if;
  if v_booked_hours > coalesce(v_rules.fatigue_max_flight_hours_per_day, 7) then
    v_codes := array_append(v_codes, 'MAX_DAILY_BOOKED_FLIGHT');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'MAX_DAILY_BOOKED_FLIGHT', 'severity', 'warning',
      'message', format('Instructor bookings total %s hours for the day, above the %s hour daily flight/supervision control.', round(v_booked_hours, 1), coalesce(v_rules.fatigue_max_flight_hours_per_day, 7))
    ));
  end if;

  if (v_forecast_end at time zone 'Australia/Sydney') > (((v_forecast_start at time zone 'Australia/Sydney')::date + 1) + time '01:00') then
    v_codes := array_append(v_codes, 'LATEST_FINISH');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'LATEST_FINISH', 'severity', 'warning', 'message', 'Forecast duty finishes after 01:00 local time following duty commencement.'
    ));
  end if;

  select max(coalesce(d.actual_end, d.planned_end)) into v_previous_end
    from public.duty_periods d
   where d.instructor_id = p_instructor_id
     and d.status = 'completed'
     and coalesce(d.actual_end, d.planned_end) <= v_forecast_start;

  if v_previous_end is not null then
    v_rest_hours := extract(epoch from (v_forecast_start - v_previous_end)) / 3600.0;
    if v_rest_hours < v_min_rest then
      v_codes := array_append(v_codes, 'MINIMUM_REST');
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'MINIMUM_REST', 'severity', 'warning',
        'message', format('Only %s hours rest follows the previous recorded duty; the configured minimum is %s hours.', round(v_rest_hours, 1), round(v_min_rest, 1))
      ));
    end if;
  end if;

  select coalesce(sum(extract(epoch from (least(coalesce(d.actual_end, d.planned_end), v_day_start) - greatest(coalesce(d.actual_start, d.planned_start), p_end - interval '7 days'))) / 3600.0), 0)
    into v_rolling_7 from public.duty_periods d
   where d.instructor_id = p_instructor_id and d.status = 'completed'
     and coalesce(d.actual_end, d.planned_end) > p_end - interval '7 days' and coalesce(d.actual_start, d.planned_start) < v_day_start;
  v_rolling_7 := v_rolling_7 + v_duty_hours;

  select coalesce(sum(extract(epoch from (least(coalesce(d.actual_end, d.planned_end), v_day_start) - greatest(coalesce(d.actual_start, d.planned_start), p_end - interval '14 days'))) / 3600.0), 0)
    into v_rolling_14 from public.duty_periods d
   where d.instructor_id = p_instructor_id and d.status = 'completed'
     and coalesce(d.actual_end, d.planned_end) > p_end - interval '14 days' and coalesce(d.actual_start, d.planned_start) < v_day_start;
  v_rolling_14 := v_rolling_14 + v_duty_hours;

  select coalesce(sum(d.flight_minutes), 0) / 60.0 into v_rolling_28_flight
    from public.duty_periods d where d.instructor_id = p_instructor_id and d.status = 'completed' and d.duty_date >= (p_start at time zone 'Australia/Sydney')::date - 27;
  select coalesce(sum(d.flight_minutes), 0) / 60.0 into v_rolling_365_flight
    from public.duty_periods d where d.instructor_id = p_instructor_id and d.status = 'completed' and d.duty_date >= (p_start at time zone 'Australia/Sydney')::date - 364;

  if v_rolling_7 > 60 then
    v_codes := array_append(v_codes, 'ROLLING_7_DUTY');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'ROLLING_7_DUTY', 'severity', 'warning', 'message', format('Recorded and forecast duty reaches %s hours in 7 days (60 hour planning limit).', round(v_rolling_7, 1))));
  end if;
  if v_rolling_14 > 100 then
    v_codes := array_append(v_codes, 'ROLLING_14_DUTY');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'ROLLING_14_DUTY', 'severity', 'warning', 'message', format('Recorded and forecast duty reaches %s hours in 14 days (100 hour planning limit).', round(v_rolling_14, 1))));
  end if;
  if v_rolling_28_flight > 100 then
    v_codes := array_append(v_codes, 'ROLLING_28_FLIGHT');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'ROLLING_28_FLIGHT', 'severity', 'warning', 'message', format('Recorded flight time is %s hours in 28 days.', round(v_rolling_28_flight, 1))));
  end if;
  if v_rolling_365_flight > 1000 then
    v_codes := array_append(v_codes, 'ROLLING_365_FLIGHT');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'ROLLING_365_FLIGHT', 'severity', 'warning', 'message', format('Recorded flight time is %s hours in 365 days.', round(v_rolling_365_flight, 1))));
  end if;

  select count(distinct d.duty_date) into v_late_count
    from public.duty_periods d
   where d.instructor_id = p_instructor_id and d.status = 'completed'
     and d.duty_date between v_candidate_date - 6 and v_candidate_date
     and (coalesce(d.actual_end, d.planned_end) at time zone 'Australia/Sydney')::time >= v_late_finish_time;
  if (v_forecast_end at time zone 'Australia/Sydney')::time >= v_late_finish_time
     and not exists (select 1 from public.duty_periods d where d.instructor_id = p_instructor_id and d.duty_date = v_candidate_date and d.status = 'completed' and (coalesce(d.actual_end, d.planned_end) at time zone 'Australia/Sydney')::time >= v_late_finish_time)
  then v_late_count := v_late_count + 1; end if;
  if v_late_count > coalesce(v_rules.fatigue_max_late_finishes_7_days, 3) then
    v_codes := array_append(v_codes, 'LATE_FINISH_FREQUENCY');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'LATE_FINISH_FREQUENCY', 'severity', 'warning', 'message', format('This would be late finish number %s in the rolling 7-day period.', v_late_count)));
  end if;

  if (v_forecast_start at time zone 'Australia/Sydney')::time < v_early_start_time and exists (
    select 1 from public.duty_periods d where d.instructor_id = p_instructor_id and d.status = 'completed'
      and d.duty_date between v_candidate_date - 1 and v_candidate_date
      and (coalesce(d.actual_end, d.planned_end) at time zone 'Australia/Sydney')::time >= v_late_finish_time
  ) then
    v_codes := array_append(v_codes, 'EARLY_AFTER_LATE');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'EARLY_AFTER_LATE', 'severity', 'warning', 'message', 'An early start follows a late finish in the adjacent duty window.'));
  end if;

  with duty_windows as (
    select coalesce(d.actual_start, d.planned_start) as starts_at, coalesce(d.actual_end, d.planned_end) as ends_at
      from public.duty_periods d where d.instructor_id = p_instructor_id and d.status = 'completed'
       and coalesce(d.actual_end, d.planned_end) > p_start - interval '7 days' and coalesce(d.actual_start, d.planned_start) < p_end
    union all select v_forecast_start, v_forecast_end
  ), ordered as (
    select starts_at, ends_at, lag(ends_at) over (order by starts_at) as previous_end from duty_windows
  ), gaps as (
    select extract(epoch from (starts_at - previous_end)) / 3600.0 as gap_hours from ordered where previous_end is not null
    union all select extract(epoch from (min(starts_at) - (p_end - interval '7 days'))) / 3600.0 from duty_windows
    union all select extract(epoch from (p_end - max(ends_at))) / 3600.0 from duty_windows
  ) select coalesce(max(gap_hours), 168) >= 36 into v_has_36_hour_gap from gaps;
  if not v_has_36_hour_gap then
    v_codes := array_append(v_codes, 'NO_36_HOUR_BREAK');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'NO_36_HOUR_BREAK', 'severity', 'warning', 'message', 'No 36-hour off-duty gap remains in the rolling 7-day recorded-duty window.'));
  end if;

  select 28 - count(distinct d.duty_date) into v_off_days
    from public.duty_periods d where d.instructor_id = p_instructor_id and d.status = 'completed'
      and d.duty_date between v_candidate_date - 27 and v_candidate_date;
  if not exists (select 1 from public.duty_periods d where d.instructor_id = p_instructor_id and d.status = 'completed' and d.duty_date = v_candidate_date) then
    v_off_days := v_off_days - 1;
  end if;
  if v_off_days < 6 then
    v_codes := array_append(v_codes, 'MINIMUM_DAYS_OFF');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'MINIMUM_DAYS_OFF', 'severity', 'warning', 'message', format('Only %s off-duty days remain in the rolling 28-day recorded-duty window.', greatest(v_off_days, 0))));
  end if;

  return jsonb_build_object(
    'result', case when jsonb_array_length(v_warnings) > 0 then 'warning' else 'clear' end,
    'warnings', v_warnings,
    'ruleCodes', to_jsonb(v_codes),
    'forecastStart', v_forecast_start,
    'forecastEnd', v_forecast_end,
    'forecastDutyHours', round(v_duty_hours, 2),
    'forecastBookedHours', round(v_booked_hours, 2),
    'effectiveDailyLimitHours', v_effective_limit,
    'previousRecordedDutyEnd', v_previous_end,
    'rolling7DutyHours', round(v_rolling_7, 2),
    'rolling14DutyHours', round(v_rolling_14, 2),
    'rolling28FlightHours', round(v_rolling_28_flight, 2),
    'rolling365FlightHours', round(v_rolling_365_flight, 2),
    'dataSource', 'recorded-duty-plus-booking-forecast',
    'engineVersion', 'duty-v1'
  );
end;
$$;

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
  select maximum_concurrent into v_maximum
    from public.senior_instructor_authorisations
   where instructor_id = p_supervisor_id and is_active
     and effective_from <= (p_start at time zone 'Australia/Sydney')::date
     and (effective_to is null or effective_to >= (p_end at time zone 'Australia/Sydney')::date)
     and (qualification_expires_on is null or qualification_expires_on >= (p_end at time zone 'Australia/Sydney')::date);
  if not found then return false; end if;

  if not public.trial_voucher_instructor_available_for_slot(p_supervisor_id, p_start, p_end) then return false; end if;

  if exists (
    select 1 from public.bookings b where b.instructor_id = p_supervisor_id
      and b.id is distinct from p_exclude_booking_id and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show') and b.start_time < p_end and b.end_time > p_start
  ) then return false; end if;

  v_duty_assessment := public.assess_instructor_duty_booking(p_supervisor_id, p_start, p_end, p_exclude_booking_id);
  if v_duty_assessment->>'result' = 'warning' then return false; end if;

  select count(*) into v_count from public.bookings b
   where b.supervising_instructor_id = p_supervisor_id
     and b.id is distinct from p_exclude_booking_id
     and b.deleted_at is null and b.status not in ('cancelled', 'no-show')
     and b.supervision_status in ('assigned', 'acknowledged')
     and b.start_time < p_end and b.end_time > p_start;
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
  select a.instructor_id
    from public.senior_instructor_authorisations a
   where a.is_active
     and a.instructor_id <> p_trainee_instructor_id
     and a.effective_from <= (p_start at time zone 'Australia/Sydney')::date
     and (a.effective_to is null or a.effective_to >= (p_end at time zone 'Australia/Sydney')::date)
     and (a.qualification_expires_on is null or a.qualification_expires_on >= (p_end at time zone 'Australia/Sydney')::date)
     and (a.remote_supervision_allowed or cardinality(a.locations) = 0 or p_location = any(a.locations))
     and (cardinality(a.activity_types) = 0 or p_activity_type = any(a.activity_types))
     and public.supervisor_available_for_slot(a.instructor_id, p_start, p_end, p_exclude_booking_id)
   order by a.priority, a.instructor_id
   limit 1;
$$;

create or replace function public.prepare_booking_duty_and_supervision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment jsonb;
  v_requirement public.instructor_supervision_requirements%rowtype;
  v_supervisor uuid;
  v_activity text;
  v_should_assess boolean;
  v_existing_supervisor uuid;
  v_existing_supervision_status text;
begin
  if tg_op = 'INSERT' then
    v_should_assess := true;
  else
    v_existing_supervisor := old.supervising_instructor_id;
    v_existing_supervision_status := old.supervision_status;
    v_should_assess := old.instructor_id is distinct from new.instructor_id
      or old.start_time is distinct from new.start_time or old.end_time is distinct from new.end_time
      or (old.status is distinct from new.status and new.status in ('confirmed', 'pending_approval', 'pending_supervision'));
  end if;

  if new.instructor_id is not null and v_should_assess and new.status not in ('cancelled', 'no-show', 'completed') then
    v_assessment := public.assess_instructor_duty_booking(new.instructor_id, new.start_time, new.end_time, new.id);
    new.duty_assessment := v_assessment;
    if v_assessment->>'result' = 'warning' and length(btrim(coalesce(new.duty_override_reason, ''))) < 10 then
      raise exception using
        errcode = 'P0001',
        message = 'DUTY_OVERRIDE_REQUIRED|' || v_assessment::text,
        hint = 'Review the duty warning and provide an override reason of at least 10 characters.';
    end if;
  end if;

  v_activity := case when coalesce(new.booking_kind, 'flight') = 'ground' then 'ground' else 'flight' end;
  select * into v_requirement from public.instructor_supervision_requirements r
   where r.instructor_id = new.instructor_id and r.supervision_required
     and r.effective_from <= (new.start_time at time zone 'Australia/Sydney')::date
     and (r.effective_to is null or r.effective_to >= (new.end_time at time zone 'Australia/Sydney')::date)
     and (cardinality(r.activity_types) = 0 or v_activity = any(r.activity_types))
     and (cardinality(r.locations) = 0 or new.location = any(r.locations));

  if not found or new.status in ('cancelled', 'no-show', 'completed') then
    new.supervision_required := false;
    new.supervision_status := 'not_required';
    new.supervising_instructor_id := null;
    return new;
  end if;

  new.supervision_required := true;
  v_supervisor := public.find_available_supervisor(
    new.instructor_id,
    new.start_time - make_interval(mins => v_requirement.preflight_minutes),
    new.end_time + make_interval(mins => v_requirement.postflight_minutes),
    new.location,
    v_activity,
    new.id
  );
  new.supervising_instructor_id := v_supervisor;

  if v_supervisor is null then
    new.supervision_status := 'pending';
    if new.status = 'confirmed' then new.status := 'pending_supervision'; end if;
  else
    new.supervision_status := case
      when new.supervision_status = 'acknowledged' and coalesce(v_existing_supervisor, v_supervisor) = v_supervisor then 'acknowledged'
      when v_existing_supervision_status = 'acknowledged' and v_existing_supervisor = v_supervisor then 'acknowledged'
      else 'assigned'
    end;
    if new.status = 'pending_supervision' then new.status := 'confirmed'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.record_booking_duty_and_supervision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment_id uuid;
  v_old_supervisor uuid;
  v_instructor_name text;
  v_supervisor_name text;
  v_supervision_changed boolean;
  v_assessment_changed boolean;
  v_period record;
begin
  if tg_op = 'INSERT' then
    v_old_supervisor := null;
    v_supervision_changed := true;
    v_assessment_changed := true;
  else
    v_old_supervisor := old.supervising_instructor_id;
    v_supervision_changed := old.supervision_required is distinct from new.supervision_required
      or v_old_supervisor is distinct from new.supervising_instructor_id;
    v_assessment_changed := old.duty_assessment is distinct from new.duty_assessment;
  end if;
  if new.duty_assessment is not null and v_assessment_changed then
    insert into public.fatigue_assessments(instructor_id, booking_id, assessed_start, assessed_end, result, assessment, created_by)
    values (new.instructor_id, new.id, new.start_time, new.end_time, coalesce(new.duty_assessment->>'result', 'clear'), new.duty_assessment, auth.uid())
    returning id into v_assessment_id;
    if new.duty_assessment->>'result' = 'warning' and length(btrim(coalesce(new.duty_override_reason, ''))) >= 10 then
      insert into public.duty_rule_overrides(booking_id, instructor_id, assessment_id, reason, rule_codes, overridden_by)
      values (new.id, new.instructor_id, v_assessment_id, new.duty_override_reason,
        array(select jsonb_array_elements_text(coalesce(new.duty_assessment->'ruleCodes', '[]'::jsonb))), auth.uid());
    end if;
  end if;

  if new.supervision_required and v_supervision_changed then
    update public.booking_supervision_assignments set status = 'reassigned', replaced_at = now()
     where booking_id = new.id and status in ('assigned', 'acknowledged');
    if new.supervising_instructor_id is not null then
      insert into public.booking_supervision_assignments(booking_id, supervising_instructor_id, status, assignment_reason, created_by)
      values (new.id, new.supervising_instructor_id, 'assigned', case when v_old_supervisor is null then 'Highest-priority eligible available supervisor' else 'Automatically reassigned after availability changed' end, auth.uid());
    else
      insert into public.booking_supervision_assignments(booking_id, status, assignment_reason, created_by)
      values (new.id, 'unassigned', 'No eligible authorised senior instructor is available', auth.uid());
    end if;

    select name into v_instructor_name from public.users where id = new.instructor_id;
    select name into v_supervisor_name from public.users where id = new.supervising_instructor_id;

    if v_old_supervisor is not null then
      insert into public.notifications(user_id, type, title, message, booking_id, metadata)
      values (v_old_supervisor, 'supervision_changed', 'Supervision assignment changed', format('You are no longer assigned to supervise %s''s booking.', coalesce(v_instructor_name, 'the instructor')), new.id, jsonb_build_object('supervisionStatus', new.supervision_status));
    end if;
    if new.supervising_instructor_id is not null then
      insert into public.notifications(user_id, type, title, message, booking_id, metadata)
      values (new.supervising_instructor_id, 'supervision_assigned', 'Supervision assignment', format('You are assigned to supervise %s from %s to %s.', coalesce(v_instructor_name, 'an instructor'), to_char(new.start_time at time zone 'Australia/Sydney', 'DD Mon HH24:MI'), to_char(new.end_time at time zone 'Australia/Sydney', 'HH24:MI')), new.id, jsonb_build_object('instructorId', new.instructor_id));
      insert into public.notifications(user_id, type, title, message, booking_id, metadata)
      values (new.instructor_id, 'supervision_assigned', 'Supervisor assigned', format('%s is assigned as supervising senior instructor.', coalesce(v_supervisor_name, 'A senior instructor')), new.id, jsonb_build_object('supervisorId', new.supervising_instructor_id));
    else
      insert into public.notifications(user_id, type, title, message, booking_id, metadata)
      select u.id, 'supervision_required', 'Unsupervised booking needs attention', format('%s''s booking at %s has returned to pending because no authorised supervisor is available.', coalesce(v_instructor_name, 'An instructor'), to_char(new.start_time at time zone 'Australia/Sydney', 'DD Mon HH24:MI')), new.id, jsonb_build_object('instructorId', new.instructor_id)
        from public.users u
       where u.id = new.instructor_id
          or exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin')
          or exists (select 1 from public.senior_instructor_authorisations a where a.instructor_id = u.id and a.is_active);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.supervision_required and not new.supervision_required then
      update public.booking_supervision_assignments
         set status = 'cancelled', replaced_at = now()
       where booking_id = new.id and status in ('assigned', 'acknowledged');
    end if;
  end if;

  insert into public.operations_audit_events(entity_type, entity_id, action, actor_id, before_data, after_data)
  values ('booking', new.id, lower(tg_op), auth.uid(), case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  for v_period in select id from public.duty_periods d where d.instructor_id = new.instructor_id and coalesce(d.actual_start, d.planned_start) < new.end_time and coalesce(d.actual_end, d.planned_end, now()) > new.start_time loop
    perform public.sync_duty_segments(v_period.id);
  end loop;
  if tg_op = 'UPDATE' then
    if old.instructor_id is distinct from new.instructor_id or old.start_time is distinct from new.start_time or old.end_time is distinct from new.end_time then
      for v_period in select id from public.duty_periods d where d.instructor_id = old.instructor_id and coalesce(d.actual_start, d.planned_start) < old.end_time and coalesce(d.actual_end, d.planned_end, now()) > old.start_time loop
        perform public.sync_duty_segments(v_period.id);
      end loop;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_booking_duty_and_supervision_trigger on public.bookings;
create trigger prepare_booking_duty_and_supervision_trigger
before insert or update on public.bookings
for each row execute function public.prepare_booking_duty_and_supervision();

drop trigger if exists record_booking_duty_and_supervision_trigger on public.bookings;
create trigger record_booking_duty_and_supervision_trigger
after insert or update on public.bookings
for each row execute function public.record_booking_duty_and_supervision();

create or replace function public.audit_operations_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into public.operations_audit_events(entity_type, entity_id, action, actor_id, before_data, after_data)
  values (tg_table_name, v_id, lower(tg_op), auth.uid(), case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end, case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists audit_duty_periods_trigger on public.duty_periods;
create trigger audit_duty_periods_trigger after insert or update or delete on public.duty_periods for each row execute function public.audit_operations_row();
drop trigger if exists audit_duty_breaks_trigger on public.duty_breaks;
create trigger audit_duty_breaks_trigger after insert or update or delete on public.duty_breaks for each row execute function public.audit_operations_row();
drop trigger if exists audit_duty_segments_trigger on public.duty_segments;
create trigger audit_duty_segments_trigger after insert or update or delete on public.duty_segments for each row execute function public.audit_operations_row();

create or replace function public.refresh_future_supervision_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings set updated_at = now()
   where instructor_id is not null and deleted_at is null and end_time >= now()
     and status not in ('cancelled', 'no-show', 'completed');
  return null;
end;
$$;

drop trigger if exists refresh_supervision_after_absence on public.instructor_absences;
create trigger refresh_supervision_after_absence after insert or update or delete on public.instructor_absences for each statement execute function public.refresh_future_supervision_assignments();
drop trigger if exists refresh_supervision_after_weekly_schedule on public.instructor_weekly_schedules;
create trigger refresh_supervision_after_weekly_schedule after insert or update or delete on public.instructor_weekly_schedules for each statement execute function public.refresh_future_supervision_assignments();
drop trigger if exists refresh_supervision_after_schedule_change on public.instructor_schedule_changes;
create trigger refresh_supervision_after_schedule_change after insert or update or delete on public.instructor_schedule_changes for each statement execute function public.refresh_future_supervision_assignments();
drop trigger if exists refresh_supervision_after_authorisation on public.senior_instructor_authorisations;
create trigger refresh_supervision_after_authorisation after insert or update or delete on public.senior_instructor_authorisations for each statement execute function public.refresh_future_supervision_assignments();
drop trigger if exists refresh_supervision_after_requirement on public.instructor_supervision_requirements;
create trigger refresh_supervision_after_requirement after insert or update or delete on public.instructor_supervision_requirements for each statement execute function public.refresh_future_supervision_assignments();

create or replace function public.acknowledge_booking_supervision(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.booking_supervision_assignments
     set status = 'acknowledged', acknowledged_at = now()
   where booking_id = p_booking_id and supervising_instructor_id = auth.uid() and status = 'assigned';
  if not found then raise exception 'No active supervision assignment is available to acknowledge'; end if;
  update public.bookings set supervision_status = 'acknowledged' where id = p_booking_id and supervising_instructor_id = auth.uid();
end;
$$;

alter table public.duty_periods enable row level security;
alter table public.duty_breaks enable row level security;
alter table public.duty_segments enable row level security;
alter table public.fatigue_declarations enable row level security;
alter table public.fatigue_assessments enable row level security;
alter table public.duty_rule_overrides enable row level security;
alter table public.instructor_supervision_requirements enable row level security;
alter table public.senior_instructor_authorisations enable row level security;
alter table public.booking_supervision_assignments enable row level security;
alter table public.operations_audit_events enable row level security;

create policy "Staff read duty periods" on public.duty_periods for select to authenticated using (public.current_user_has_staff_role());
create policy "Instructors create own duty periods" on public.duty_periods for insert to authenticated with check (instructor_id = auth.uid() or public.current_user_is_admin());
create policy "Instructors update own duty periods" on public.duty_periods for update to authenticated using (instructor_id = auth.uid() or public.current_user_is_admin()) with check (instructor_id = auth.uid() or public.current_user_is_admin());
create policy "Admins delete duty periods" on public.duty_periods for delete to authenticated using (public.current_user_is_admin());

create policy "Staff read duty breaks" on public.duty_breaks for select to authenticated using (public.current_user_has_staff_role());
create policy "Duty owners create breaks" on public.duty_breaks for insert to authenticated with check (exists (select 1 from public.duty_periods d where d.id = duty_period_id and (d.instructor_id = auth.uid() or public.current_user_is_admin())));
create policy "Duty owners update breaks" on public.duty_breaks for update to authenticated using (exists (select 1 from public.duty_periods d where d.id = duty_period_id and (d.instructor_id = auth.uid() or public.current_user_is_admin())));
create policy "Duty owners delete breaks" on public.duty_breaks for delete to authenticated using (exists (select 1 from public.duty_periods d where d.id = duty_period_id and (d.instructor_id = auth.uid() or public.current_user_is_admin())));
create policy "Staff read duty segments" on public.duty_segments for select to authenticated using (public.current_user_has_staff_role());
create policy "Duty owners manage segments" on public.duty_segments for all to authenticated using (exists (select 1 from public.duty_periods d where d.id = duty_period_id and (d.instructor_id = auth.uid() or public.current_user_is_admin()))) with check (exists (select 1 from public.duty_periods d where d.id = duty_period_id and (d.instructor_id = auth.uid() or public.current_user_is_admin())));

create policy "Staff read fatigue declarations" on public.fatigue_declarations for select to authenticated using (instructor_id = auth.uid() or public.current_user_is_admin());
create policy "Instructors create own fatigue declarations" on public.fatigue_declarations for insert to authenticated with check (instructor_id = auth.uid() or public.current_user_is_admin());
create policy "Staff read fatigue assessments" on public.fatigue_assessments for select to authenticated using (public.current_user_has_staff_role());
create policy "Staff read duty overrides" on public.duty_rule_overrides for select to authenticated using (public.current_user_has_staff_role());
create policy "Staff read supervision requirements" on public.instructor_supervision_requirements for select to authenticated using (public.current_user_has_staff_role());
create policy "Admins manage supervision requirements" on public.instructor_supervision_requirements for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Staff read senior authorisations" on public.senior_instructor_authorisations for select to authenticated using (public.current_user_has_staff_role());
create policy "Admins manage senior authorisations" on public.senior_instructor_authorisations for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Staff read supervision assignments" on public.booking_supervision_assignments for select to authenticated using (public.current_user_has_staff_role());
create policy "Admins read operations audit" on public.operations_audit_events for select to authenticated using (public.current_user_is_admin());

grant select, insert, update, delete on public.duty_periods, public.duty_breaks, public.duty_segments to authenticated;
grant select, insert on public.fatigue_declarations to authenticated;
grant select on public.fatigue_assessments, public.duty_rule_overrides, public.booking_supervision_assignments, public.operations_audit_events to authenticated;
grant select, insert, update, delete on public.instructor_supervision_requirements, public.senior_instructor_authorisations to authenticated;
grant execute on function public.assess_instructor_duty_booking(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.acknowledge_booking_supervision(uuid) to authenticated;
revoke all on function public.prepare_booking_duty_and_supervision() from public, anon, authenticated;
revoke all on function public.record_booking_duty_and_supervision() from public, anon, authenticated;
revoke all on function public.audit_operations_row() from public, anon, authenticated;
revoke all on function public.refresh_future_supervision_assignments() from public, anon, authenticated;
revoke all on function public.sync_duty_segments(uuid) from public, anon, authenticated;
revoke all on function public.sync_duty_segments_after_period_change() from public, anon, authenticated;
revoke all on function public.sync_duty_segments_after_flight_log_change() from public, anon, authenticated;
revoke all on function public.prevent_uncovered_supervised_flight_log() from public, anon, authenticated;
revoke all on function public.validate_duty_period_change() from public, anon, authenticated;
revoke all on function public.validate_duty_break_change() from public, anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.duty_periods;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.duty_breaks;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.duty_segments;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.booking_supervision_assignments;
exception when duplicate_object then null;
end $$;
