-- Use Duty Clock time when recorded; otherwise estimate duty from bookings.

-- A manual/mobile Duty Clock record is authoritative. When it does not
-- exist for a local day, bookings estimate duty from first -30 to last +30.
create or replace function private.instructor_duty_windows(
  p_instructor_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_now timestamptz default now(),
  p_exclude_booking_id uuid default null
)
returns table (
  duty_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  duty_time_source text
)
language sql
stable
security definer
set search_path = public, private
as $$
  with recorded_daily as (
    select
      (coalesce(d.actual_start, d.planned_start) at time zone 'Australia/Sydney')::date as local_duty_date,
      min(coalesce(d.actual_start, d.planned_start)) as starts_at,
      max(case
        when d.status = 'active' then greatest(
          coalesce(d.actual_start, d.planned_start),
          least(p_now, p_to)
        )
        else coalesce(d.actual_end, d.planned_end)
      end) as ends_at
    from public.duty_periods d
    where d.instructor_id = p_instructor_id
      and d.status in ('active', 'completed')
      and coalesce(d.entry_source, 'manual') in ('manual', 'mobile')
      and coalesce(d.actual_start, d.planned_start) < p_to
      and coalesce(
        d.actual_end,
        d.planned_end,
        case when d.status = 'active' then p_now end
      ) > p_from
    group by 1
  ),
  booking_activity as (
    select b.id, b.start_time, b.end_time
    from public.bookings b
    where b.instructor_id = p_instructor_id
      and b.id is distinct from p_exclude_booking_id
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show')
      and coalesce(b.has_conflict, false) is false
      and b.start_time < p_to
      and b.end_time > p_from

    union

    select b.id, b.start_time, b.end_time
    from public.bookings b
    where b.supervising_instructor_id = p_instructor_id
      and b.id is distinct from p_exclude_booking_id
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show')
      and b.supervision_status in ('assigned', 'acknowledged')
      and b.start_time < p_to
      and b.end_time > p_from
  ),
  booking_daily as (
    select
      (a.start_time at time zone 'Australia/Sydney')::date as local_duty_date,
      min(a.start_time) - interval '30 minutes' as starts_at,
      max(a.end_time) + interval '30 minutes' as ends_at
    from booking_activity a
    group by 1
  )
  select r.local_duty_date, r.starts_at, r.ends_at, 'duty-clock'::text
  from recorded_daily r
  where r.ends_at > r.starts_at

  union all

  select b.local_duty_date, b.starts_at, b.ends_at, 'booking-fallback-30-minutes'::text
  from booking_daily b
  where b.ends_at > b.starts_at
    and not exists (
      select 1 from recorded_daily r
      where r.local_duty_date = b.local_duty_date
    );
$$;

revoke all on function private.instructor_duty_windows(uuid, timestamptz, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;

-- An open duty period has no actual_end or planned_end. The original booking
-- forecast substituted the proposed booking end for that missing value, even
-- when the booking was days later. That joined separate days into one false
-- duty period and then inflated the 7- and 14-day duty totals by the same span.
--
-- Keep duty and flight distinct:
--   * the proposed day's duty is the span of that day's duty/bookings only;
--   * an open duty on an earlier day contributes elapsed duty through now to
--     cumulative duty, but never stretches to a future booking;
--   * cumulative flight limits continue to use recorded flight_minutes only.
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
  v_now timestamptz := now();
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_forecast_start timestamptz;
  v_forecast_end timestamptz;
  v_previous_end timestamptz;
  v_open_duty_start timestamptz;
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
  v_candidate_is_today boolean := false;
  v_has_recorded_duty boolean := false;
  v_warnings jsonb := '[]'::jsonb;
  v_codes text[] := array[]::text[];
  v_enabled boolean := true;
begin
  if p_instructor_id is null or p_start is null or p_end is null or p_end <= p_start then
    return jsonb_build_object(
      'result', 'cannot_assess',
      'warnings', '[]'::jsonb,
      'message', 'Instructor and valid booking times are required.',
      'engineVersion', 'duty-v3'
    );
  end if;

  select * into v_rules
  from public.booking_rules_settings
  order by updated_at desc nulls last
  limit 1;

  if found then
    v_enabled := coalesce(v_rules.fatigue_rules_enabled, true);
    v_min_rest := coalesce(v_rules.fatigue_min_rest_hours, 12);
    v_late_finish_time := coalesce(v_rules.fatigue_late_finish_time::time, time '22:00');
    v_early_start_time := coalesce(v_rules.fatigue_early_start_time::time, time '07:00');
  else
    v_min_rest := 12;
  end if;

  if not v_enabled then
    return jsonb_build_object(
      'result', 'clear',
      'warnings', '[]'::jsonb,
      'ruleCodes', '[]'::jsonb,
      'engineVersion', 'duty-v3',
      'rulesEnabled', false
    );
  end if;

  v_candidate_date := (p_start at time zone 'Australia/Sydney')::date;
  v_candidate_is_today := v_candidate_date = (v_now at time zone 'Australia/Sydney')::date;
  v_day_start := (v_candidate_date::timestamp at time zone 'Australia/Sydney');
  v_day_end := v_day_start + interval '1 day';

  select exists (
    select 1
    from public.duty_periods d
    where d.instructor_id = p_instructor_id
      and d.status in ('active', 'completed')
      and coalesce(d.entry_source, 'manual') in ('manual', 'mobile')
      and coalesce(d.actual_start, d.planned_start) < v_day_end
      and coalesce(
        d.actual_end,
        d.planned_end,
        case when d.status = 'active' then v_now end
      ) > v_day_start
  )
  into v_has_recorded_duty;

  select min(source_start), max(source_end)
  into v_forecast_start, v_forecast_end
  from (
    select
      case when v_has_recorded_duty then p_start else p_start - interval '30 minutes' end as source_start,
      case when v_has_recorded_duty then p_end else p_end + interval '30 minutes' end as source_end

    union all

    select w.starts_at, w.ends_at
    from private.instructor_duty_windows(
      p_instructor_id,
      v_day_start,
      v_day_end,
      v_now,
      p_exclude_booking_id
    ) w
  ) duty_sources;

  v_duty_hours := greatest(0, extract(epoch from (v_forecast_end - v_forecast_start)) / 3600.0);

  select coalesce(sum(
    extract(epoch from (least(b.end_time, v_day_end) - greatest(b.start_time, v_day_start))) / 3600.0
  ), 0)
  into v_booked_hours
  from public.bookings b
  where b.instructor_id = p_instructor_id
    and b.id is distinct from p_exclude_booking_id
    and b.deleted_at is null
    and b.status not in ('cancelled', 'no-show')
    and coalesce(b.has_conflict, false) is false
    and b.start_time < v_day_end
    and b.end_time > v_day_start;

  v_booked_hours := v_booked_hours + extract(epoch from (p_end - p_start)) / 3600.0;

  if coalesce(v_rules.fatigue_include_supervision, true) then
    select v_booked_hours + coalesce(sum(
      extract(epoch from (least(b.end_time, v_day_end) - greatest(b.start_time, v_day_start))) / 3600.0
    ), 0)
    into v_booked_hours
    from public.bookings b
    where b.supervising_instructor_id = p_instructor_id
      and b.id is distinct from p_exclude_booking_id
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show')
      and b.supervision_status in ('assigned', 'acknowledged')
      and b.start_time < v_day_end
      and b.end_time > v_day_start;
  end if;

  v_effective_limit := least(
    public.casa_appendix_6_fdp_limit_hours(v_forecast_start),
    coalesce(
      nullif(v_rules.fatigue_max_duty_hours_per_day, 0),
      public.casa_appendix_6_fdp_limit_hours(v_forecast_start)
    )
  );

  if v_duty_hours > v_effective_limit then
    v_codes := array_append(v_codes, 'MAX_DAILY_DUTY');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'MAX_DAILY_DUTY',
      'severity', 'warning',
      'message', format(
        'Forecast duty is %s hours, above the %s hour limit for this start time.',
        round(v_duty_hours, 1),
        round(v_effective_limit, 1)
      )
    ));
  end if;

  if v_booked_hours > coalesce(v_rules.fatigue_max_flight_hours_per_day, 7) then
    v_codes := array_append(v_codes, 'MAX_DAILY_BOOKED_FLIGHT');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'MAX_DAILY_BOOKED_FLIGHT',
      'severity', 'warning',
      'message', format(
        'Instructor bookings total %s hours for the day, above the %s hour daily flight/supervision control.',
        round(v_booked_hours, 1),
        coalesce(v_rules.fatigue_max_flight_hours_per_day, 7)
      )
    ));
  end if;

  -- Appendix 6 uses a start-time-based FDP table. It does not impose the
  -- Appendix 1 rule that an FDP must finish by 01:00 on the following day.

  select max(w.ends_at)
  into v_previous_end
  from private.instructor_duty_windows(
    p_instructor_id,
    v_forecast_start - interval '30 days',
    v_day_start,
    v_now,
    null
  ) w
  where w.duty_date < v_candidate_date
    and w.ends_at <= v_forecast_start;

  if v_previous_end is not null then
    v_rest_hours := extract(epoch from (v_forecast_start - v_previous_end)) / 3600.0;
    if v_rest_hours < v_min_rest then
      v_codes := array_append(v_codes, 'MINIMUM_REST');
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'MINIMUM_REST',
        'severity', 'warning',
        'message', format(
          'Only %s hours rest follows the previous recorded duty; the configured minimum is %s hours.',
          round(v_rest_hours, 1),
          round(v_min_rest, 1)
        )
      ));
    end if;
  end if;

  select coalesce(sum(
    extract(epoch from (
      least(w.ends_at, v_day_start)
      - greatest(w.starts_at, p_end - interval '7 days')
    )) / 3600.0
  ), 0)
  into v_rolling_7
  from private.instructor_duty_windows(
    p_instructor_id,
    p_end - interval '7 days',
    v_day_start,
    v_now,
    null
  ) w
  where w.ends_at > p_end - interval '7 days';

  v_rolling_7 := v_rolling_7 + v_duty_hours;

  select coalesce(sum(
    extract(epoch from (
      least(w.ends_at, v_day_start)
      - greatest(w.starts_at, p_end - interval '14 days')
    )) / 3600.0
  ), 0)
  into v_rolling_14
  from private.instructor_duty_windows(
    p_instructor_id,
    p_end - interval '14 days',
    v_day_start,
    v_now,
    null
  ) w
  where w.ends_at > p_end - interval '14 days';

  v_rolling_14 := v_rolling_14 + v_duty_hours;

  select coalesce(sum(d.flight_minutes), 0) / 60.0
  into v_rolling_28_flight
  from public.duty_periods d
  where d.instructor_id = p_instructor_id
    and d.status in ('active', 'completed')
    and d.duty_date between v_candidate_date - 27 and v_candidate_date;

  select coalesce(sum(d.flight_minutes), 0) / 60.0
  into v_rolling_365_flight
  from public.duty_periods d
  where d.instructor_id = p_instructor_id
    and d.status in ('active', 'completed')
    and d.duty_date between v_candidate_date - 364 and v_candidate_date;

  if v_rolling_7 > 60 then
    v_codes := array_append(v_codes, 'ROLLING_7_DUTY');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'ROLLING_7_DUTY',
      'severity', 'warning',
      'message', format(
        'Recorded and forecast duty reaches %s hours in 7 days (60 hour planning limit).',
        round(v_rolling_7, 1)
      )
    ));
  end if;

  if v_rolling_14 > 100 then
    v_codes := array_append(v_codes, 'ROLLING_14_DUTY');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'ROLLING_14_DUTY',
      'severity', 'warning',
      'message', format(
        'Recorded and forecast duty reaches %s hours in 14 days (100 hour planning limit).',
        round(v_rolling_14, 1)
      )
    ));
  end if;

  if v_rolling_28_flight > 100 then
    v_codes := array_append(v_codes, 'ROLLING_28_FLIGHT');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'ROLLING_28_FLIGHT',
      'severity', 'warning',
      'message', format('Recorded flight time is %s hours in 28 days.', round(v_rolling_28_flight, 1))
    ));
  end if;

  if v_rolling_365_flight > 1000 then
    v_codes := array_append(v_codes, 'ROLLING_365_FLIGHT');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'ROLLING_365_FLIGHT',
      'severity', 'warning',
      'message', format('Recorded flight time is %s hours in 365 days.', round(v_rolling_365_flight, 1))
    ));
  end if;

  select count(distinct w.duty_date)
  into v_late_count
  from private.instructor_duty_windows(
    p_instructor_id,
    v_day_start - interval '6 days',
    v_day_start,
    v_now,
    null
  ) w
  where w.duty_date between v_candidate_date - 6 and v_candidate_date - 1
    and (w.ends_at at time zone 'Australia/Sydney')::time >= v_late_finish_time;

  if (v_forecast_end at time zone 'Australia/Sydney')::time >= v_late_finish_time then
    v_late_count := v_late_count + 1;
  end if;

  if v_late_count > coalesce(v_rules.fatigue_max_late_finishes_7_days, 3) then
    v_codes := array_append(v_codes, 'LATE_FINISH_FREQUENCY');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'LATE_FINISH_FREQUENCY',
      'severity', 'warning',
      'message', format('This would be late finish number %s in the rolling 7-day period.', v_late_count)
    ));
  end if;

  if (v_forecast_start at time zone 'Australia/Sydney')::time < v_early_start_time
     and exists (
       select 1
       from private.instructor_duty_windows(
         p_instructor_id,
         v_day_start - interval '1 day',
         v_day_start,
         v_now,
         null
       ) w
       where w.duty_date = v_candidate_date - 1
         and (w.ends_at at time zone 'Australia/Sydney')::time >= v_late_finish_time
     )
  then
    v_codes := array_append(v_codes, 'EARLY_AFTER_LATE');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'EARLY_AFTER_LATE',
      'severity', 'warning',
      'message', 'An early start follows a late finish in the adjacent duty window.'
    ));
  end if;

  with duty_windows as (
    select w.starts_at, w.ends_at
    from private.instructor_duty_windows(
      p_instructor_id,
      p_end - interval '7 days',
      v_day_start,
      v_now,
      null
    ) w

    union all

    select v_forecast_start, v_forecast_end
  ), relevant_windows as (
    select starts_at, ends_at
    from duty_windows
    where ends_at > p_end - interval '7 days'
      and starts_at < p_end
  ), ordered as (
    select starts_at, ends_at, lag(ends_at) over (order by starts_at) as previous_end
    from relevant_windows
  ), gaps as (
    select extract(epoch from (starts_at - previous_end)) / 3600.0 as gap_hours
    from ordered
    where previous_end is not null

    union all

    select extract(epoch from (min(starts_at) - (p_end - interval '7 days'))) / 3600.0
    from relevant_windows

    union all

    select extract(epoch from (p_end - max(ends_at))) / 3600.0
    from relevant_windows
  )
  select coalesce(max(gap_hours), 168) >= 36
  into v_has_36_hour_gap
  from gaps;

  if not v_has_36_hour_gap then
    v_codes := array_append(v_codes, 'NO_36_HOUR_BREAK');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'NO_36_HOUR_BREAK',
      'severity', 'warning',
      'message', 'No 36-hour off-duty gap remains in the rolling 7-day recorded-duty window.'
    ));
  end if;

  select 28 - (count(distinct w.duty_date) + 1)
  into v_off_days
  from private.instructor_duty_windows(
    p_instructor_id,
    v_day_start - interval '27 days',
    v_day_start,
    v_now,
    null
  ) w;

  if v_off_days < 6 then
    v_codes := array_append(v_codes, 'MINIMUM_DAYS_OFF');
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'MINIMUM_DAYS_OFF',
      'severity', 'warning',
      'message', format(
        'Only %s off-duty days remain in the rolling 28-day recorded-duty window.',
        greatest(v_off_days, 0)
      )
    ));
  end if;

  select min(coalesce(d.actual_start, d.planned_start))
  into v_open_duty_start
  from public.duty_periods d
  where d.instructor_id = p_instructor_id
    and d.status = 'active'
    and coalesce(d.entry_source, 'manual') in ('manual', 'mobile')
    and coalesce(d.actual_start, d.planned_start) < v_day_start;

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
    'openPriorDutyStart', v_open_duty_start,
    'openPriorDutyCountedThrough', case when v_open_duty_start is null then null else v_now end,
    'dutyTimeSource', case when v_has_recorded_duty then 'duty-clock' else 'booking-fallback-30-minutes' end,
    'dataSource', 'duty-clock-with-booking-fallback',
    'engineVersion', 'duty-v3'
  );
end;
$$;

create or replace function public.reconcile_automatic_duty_periods(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_candidate record;
  v_window record;
  v_has_window boolean;
  v_close_end timestamptz;
  v_max_end timestamptz;
  v_started_id uuid;
  v_started_count integer := 0;
  v_closed_count integer := 0;
  v_flight_minutes integer := 0;
begin
  for v_period in
    select d.* from public.duty_periods d
    where d.status = 'active'
      and d.entry_source = 'automatic_booking'
    for update skip locked
  loop
    select w.* into v_window
    from private.instructor_duty_windows(
      v_period.instructor_id,
      (v_period.duty_date::timestamp at time zone 'Australia/Sydney'),
      ((v_period.duty_date + 1)::timestamp at time zone 'Australia/Sydney'),
      p_now,
      null
    ) w
    where w.duty_date = v_period.duty_date
      and w.duty_time_source = 'booking-fallback-30-minutes'
    limit 1;
    v_has_window := found;

    if v_has_window then
      update public.duty_periods
      set actual_start = v_window.starts_at, updated_at = p_now
      where id = v_period.id;

      if v_window.ends_at > p_now then
        continue;
      end if;
      v_close_end := v_window.ends_at;
    else
      v_close_end := least(
        greatest(v_period.actual_start + interval '1 minute', p_now),
        public.maximum_duty_end(v_period.actual_start)
      );
    end if;

    select coalesce(sum(greatest(
      0, round(coalesce(nullif(fl.duration, 0), fl.flight_duration, 0) * 60)
    ))::integer, 0)
    into v_flight_minutes
    from public.flight_logs fl
    left join public.bookings b on b.id = fl.booking_id
    where fl.instructor_id = v_period.instructor_id
      and (coalesce(fl.start_time, b.start_time) at time zone 'Australia/Sydney')::date = v_period.duty_date;

    update public.duty_periods
    set actual_end = v_close_end,
        status = 'completed',
        flight_minutes = v_flight_minutes,
        auto_closed_at_limit = false,
        completed_at = p_now,
        updated_at = p_now,
        notes = concat_ws(
          E'\n',
          nullif(notes, ''),
          case when v_has_window
            then 'Booking fallback ended 30 minutes after the final booking.'
            else 'Booking fallback ended when no qualifying bookings remained.'
          end
        )
    where id = v_period.id;
    v_closed_count := v_closed_count + 1;
  end loop;

  for v_period in
    select d.* from public.duty_periods d
    where d.status = 'active'
      and coalesce(d.entry_source, 'manual') in ('manual', 'mobile')
      and d.actual_start is not null
      and public.maximum_duty_end(d.actual_start) <= p_now
    for update skip locked
  loop
    v_max_end := public.maximum_duty_end(v_period.actual_start);

    select coalesce(sum(greatest(
      0, round(coalesce(nullif(fl.duration, 0), fl.flight_duration, 0) * 60)
    ))::integer, 0)
    into v_flight_minutes
    from public.flight_logs fl
    left join public.bookings b on b.id = fl.booking_id
    where fl.instructor_id = v_period.instructor_id
      and (coalesce(fl.start_time, b.start_time) at time zone 'Australia/Sydney')::date = v_period.duty_date;

    update public.duty_periods
    set actual_end = v_max_end,
        status = 'completed',
        flight_minutes = v_flight_minutes,
        auto_closed_at_limit = true,
        completed_at = p_now,
        updated_at = p_now
    where id = v_period.id;

    insert into public.notifications(user_id, type, title, message, booking_id, metadata)
    values (
      v_period.instructor_id,
      'duty_auto_closed',
      'Duty closed automatically',
      format(
        'Your recorded duty was closed at %s because no clock-out was recorded. Review and amend it if your actual finish time was earlier.',
        to_char(v_max_end at time zone 'Australia/Sydney', 'DD Mon HH24:MI')
      ),
      v_period.auto_started_for_booking_id,
      jsonb_build_object('dutyPeriodId', v_period.id, 'maximumDutyEnd', v_max_end)
    );
    v_closed_count := v_closed_count + 1;
  end loop;

  for v_candidate in
    with booking_activity as (
      select
        b.id as booking_id,
        b.instructor_id,
        b.start_time,
        b.end_time,
        coalesce(b.location, 'Bendigo') as location
      from public.bookings b
      where b.instructor_id is not null
        and b.deleted_at is null
        and b.status not in ('cancelled', 'no-show')
        and coalesce(b.has_conflict, false) is false

      union

      select
        b.id,
        b.supervising_instructor_id,
        b.start_time,
        b.end_time,
        coalesce(b.location, 'Bendigo')
      from public.bookings b
      where b.supervising_instructor_id is not null
        and b.deleted_at is null
        and b.status not in ('cancelled', 'no-show')
        and b.supervision_status in ('assigned', 'acknowledged')
    ),
    booking_days as (
      select
        a.instructor_id,
        (a.start_time at time zone 'Australia/Sydney')::date as duty_date,
        min(a.start_time) - interval '30 minutes' as starts_at,
        max(a.end_time) + interval '30 minutes' as ends_at,
        (array_agg(a.booking_id order by a.start_time, a.booking_id))[1] as first_booking_id,
        (array_agg(a.location order by a.start_time, a.booking_id))[1] as location
      from booking_activity a
      group by a.instructor_id, (a.start_time at time zone 'Australia/Sydney')::date
    )
    select bd.*
    from booking_days bd
    where bd.starts_at <= p_now
      and bd.ends_at > p_now
      and not exists (
        select 1 from public.duty_periods d
        where d.instructor_id = bd.instructor_id
          and d.status = 'active'
      )
      and not exists (
        select 1 from public.duty_periods d
        where d.instructor_id = bd.instructor_id
          and d.duty_date = bd.duty_date
          and d.status in ('active', 'completed')
          and coalesce(d.entry_source, 'manual') in ('manual', 'mobile')
      )
  loop
    begin
      insert into public.duty_periods(
        instructor_id, duty_date, actual_start, location, status,
        entry_source, auto_started_for_booking_id, notes
      )
      values (
        v_candidate.instructor_id,
        v_candidate.duty_date,
        v_candidate.starts_at,
        v_candidate.location,
        'active',
        'automatic_booking',
        v_candidate.first_booking_id,
        'Estimated from bookings because no Duty Clock record was available.'
      )
      returning id into v_started_id;

      insert into public.notifications(user_id, type, title, message, booking_id, metadata)
      values (
        v_candidate.instructor_id,
        'duty_auto_started',
        'Duty estimated from bookings',
        format(
          'No Duty Clock start was recorded. Duty is estimated from %s until 30 minutes after the last booking. Starting the Duty Clock will replace this estimate.',
          to_char(v_candidate.starts_at at time zone 'Australia/Sydney', 'DD Mon HH24:MI')
        ),
        v_candidate.first_booking_id,
        jsonb_build_object(
          'dutyPeriodId', v_started_id,
          'automaticStart', v_candidate.starts_at,
          'automaticEnd', v_candidate.ends_at
        )
      );
      v_started_count := v_started_count + 1;
    exception when unique_violation then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'started', v_started_count,
    'closed', v_closed_count,
    'reconciledAt', p_now,
    'fallbackRule', 'first-booking-minus-30-to-last-booking-plus-30'
  );
end;
$$;

revoke all on function public.reconcile_automatic_duty_periods(timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_automatic_duty_periods(timestamptz)
  to service_role;

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
  v_existing_source text;
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
  select d.id, coalesce(d.entry_source, 'manual')
    into v_period_id, v_existing_source
    from public.duty_periods d
   where d.instructor_id = v_user_id
     and d.status = 'active'
   order by d.actual_start desc nulls last
   limit 1
   for update;

  if v_period_id is not null and v_existing_source <> 'automatic_booking' then
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

  if v_period_id is not null then
    update public.duty_periods
       set duty_date = (p_actual_start at time zone 'Australia/Sydney')::date,
           actual_start = p_actual_start,
           actual_end = null,
           location = coalesce(nullif(btrim(p_location_label), ''), v_location.name, 'Off-site'),
           entry_source = 'mobile',
           auto_started_for_booking_id = null,
           auto_closed_at_limit = false,
           notes = nullif(concat_ws(
             E'\n',
             nullif(btrim(p_geofence_notes), ''),
             'Booking fallback replaced by an instructor Duty Clock start.'
           ), ''),
           updated_by = v_user_id,
           updated_at = now()
     where id = v_period_id;
  else
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
  end if;

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

do $$
declare
  v_period record;
  v_window record;
begin
  for v_period in
    select d.* from public.duty_periods d
    where d.entry_source = 'automatic_booking'
      and not exists (
        select 1 from public.duty_clock_events e
        where e.duty_period_id = d.id
          and e.event_type in ('duty_start', 'duty_end')
      )
  loop
    select w.* into v_window
    from private.instructor_duty_windows(
      v_period.instructor_id,
      (v_period.duty_date::timestamp at time zone 'Australia/Sydney'),
      ((v_period.duty_date + 1)::timestamp at time zone 'Australia/Sydney'),
      now(),
      null
    ) w
    where w.duty_date = v_period.duty_date
      and w.duty_time_source = 'booking-fallback-30-minutes'
    limit 1;

    if found then
      update public.duty_periods
      set actual_start = v_window.starts_at,
          actual_end = case when v_period.status = 'completed' then v_window.ends_at else null end,
          auto_closed_at_limit = false,
          updated_at = now(),
          notes = concat_ws(
            E'\n',
            nullif(v_period.notes, ''),
            'Booking fallback normalised to first booking -30 and last booking +30 minutes.'
          )
      where id = v_period.id;
    end if;
  end loop;
end;
$$;

select public.reconcile_automatic_duty_periods(now());

select private.assert_function_permission_manifest();
