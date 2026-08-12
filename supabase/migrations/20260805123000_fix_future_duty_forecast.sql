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
  v_warnings jsonb := '[]'::jsonb;
  v_codes text[] := array[]::text[];
  v_enabled boolean := true;
begin
  if p_instructor_id is null or p_start is null or p_end is null or p_end <= p_start then
    return jsonb_build_object(
      'result', 'cannot_assess',
      'warnings', '[]'::jsonb,
      'message', 'Instructor and valid booking times are required.',
      'engineVersion', 'duty-v2'
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
      'engineVersion', 'duty-v2',
      'rulesEnabled', false
    );
  end if;

  v_candidate_date := (p_start at time zone 'Australia/Sydney')::date;
  v_candidate_is_today := v_candidate_date = (v_now at time zone 'Australia/Sydney')::date;
  v_day_start := (v_candidate_date::timestamp at time zone 'Australia/Sydney');
  v_day_end := v_day_start + interval '1 day';

  select min(source_start), max(source_end)
  into v_forecast_start, v_forecast_end
  from (
    select p_start as source_start, p_end as source_end

    union all

    select
      coalesce(d.actual_start, d.planned_start) as source_start,
      case
        when d.status = 'active' then greatest(
          coalesce(d.planned_end, d.actual_start, d.planned_start),
          v_now,
          p_end
        )
        else coalesce(d.actual_end, d.planned_end)
      end as source_end
    from public.duty_periods d
    where d.instructor_id = p_instructor_id
      and (
        (
          d.status = 'completed'
          and coalesce(d.actual_start, d.planned_start) < v_day_end
          and coalesce(d.actual_end, d.planned_end) > v_day_start
        )
        or (
          d.status = 'active'
          and v_candidate_is_today
          and coalesce(d.actual_start, d.planned_start) < v_day_end
        )
      )

    union all

    select b.start_time, b.end_time
    from public.bookings b
    where b.instructor_id = p_instructor_id
      and b.id is distinct from p_exclude_booking_id
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show')
      and coalesce(b.has_conflict, false) is false
      and b.start_time < v_day_end
      and b.end_time > v_day_start

    union all

    select b.start_time, b.end_time
    from public.bookings b
    where b.supervising_instructor_id = p_instructor_id
      and b.id is distinct from p_exclude_booking_id
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show')
      and b.supervision_status in ('assigned', 'acknowledged')
      and b.start_time < v_day_end
      and b.end_time > v_day_start
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

  with duty_history as (
    select
      coalesce(d.actual_start, d.planned_start) as starts_at,
      case
        when d.status = 'active' then greatest(
          coalesce(d.actual_start, d.planned_start),
          least(v_now, v_forecast_start)
        )
        else coalesce(d.actual_end, d.planned_end)
      end as ends_at
    from public.duty_periods d
    where d.instructor_id = p_instructor_id
      and d.status in ('active', 'completed')
  )
  select max(ends_at)
  into v_previous_end
  from duty_history
  where ends_at <= v_forecast_start;

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

  with historical_duty as (
    select
      coalesce(d.actual_start, d.planned_start) as starts_at,
      case
        when d.status = 'active' then greatest(
          coalesce(d.actual_start, d.planned_start),
          least(v_now, v_day_start)
        )
        else coalesce(d.actual_end, d.planned_end)
      end as ends_at
    from public.duty_periods d
    where d.instructor_id = p_instructor_id
      and d.status in ('active', 'completed')
  )
  select coalesce(sum(
    extract(epoch from (
      least(ends_at, v_forecast_start)
      - greatest(starts_at, p_end - interval '7 days')
    )) / 3600.0
  ), 0)
  into v_rolling_7
  from historical_duty
  where ends_at > p_end - interval '7 days'
    and ends_at <= v_forecast_start;

  v_rolling_7 := v_rolling_7 + v_duty_hours;

  with historical_duty as (
    select
      coalesce(d.actual_start, d.planned_start) as starts_at,
      case
        when d.status = 'active' then greatest(
          coalesce(d.actual_start, d.planned_start),
          least(v_now, v_day_start)
        )
        else coalesce(d.actual_end, d.planned_end)
      end as ends_at
    from public.duty_periods d
    where d.instructor_id = p_instructor_id
      and d.status in ('active', 'completed')
  )
  select coalesce(sum(
    extract(epoch from (
      least(ends_at, v_forecast_start)
      - greatest(starts_at, p_end - interval '14 days')
    )) / 3600.0
  ), 0)
  into v_rolling_14
  from historical_duty
  where ends_at > p_end - interval '14 days'
    and ends_at <= v_forecast_start;

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

  select count(distinct d.duty_date)
  into v_late_count
  from public.duty_periods d
  where d.instructor_id = p_instructor_id
    and d.status = 'completed'
    and d.duty_date between v_candidate_date - 6 and v_candidate_date
    and (coalesce(d.actual_end, d.planned_end) at time zone 'Australia/Sydney')::time >= v_late_finish_time;

  if (v_forecast_end at time zone 'Australia/Sydney')::time >= v_late_finish_time
     and not exists (
       select 1
       from public.duty_periods d
       where d.instructor_id = p_instructor_id
         and d.duty_date = v_candidate_date
         and d.status = 'completed'
         and (coalesce(d.actual_end, d.planned_end) at time zone 'Australia/Sydney')::time >= v_late_finish_time
     )
  then
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
       from public.duty_periods d
       where d.instructor_id = p_instructor_id
         and d.status = 'completed'
         and d.duty_date between v_candidate_date - 1 and v_candidate_date
         and (coalesce(d.actual_end, d.planned_end) at time zone 'Australia/Sydney')::time >= v_late_finish_time
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
    select
      coalesce(d.actual_start, d.planned_start) as starts_at,
      case
        when d.status = 'active' then greatest(
          coalesce(d.actual_start, d.planned_start),
          least(v_now, v_day_start)
        )
        else coalesce(d.actual_end, d.planned_end)
      end as ends_at
    from public.duty_periods d
    where d.instructor_id = p_instructor_id
      and d.status in ('active', 'completed')
      and coalesce(d.actual_start, d.planned_start) < v_day_start

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

  select 28 - count(distinct d.duty_date)
  into v_off_days
  from public.duty_periods d
  where d.instructor_id = p_instructor_id
    and d.status in ('active', 'completed')
    and d.duty_date between v_candidate_date - 27 and v_candidate_date;

  if not exists (
    select 1
    from public.duty_periods d
    where d.instructor_id = p_instructor_id
      and d.status in ('active', 'completed')
      and d.duty_date = v_candidate_date
  ) then
    v_off_days := v_off_days - 1;
  end if;

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
    'openPriorDutyCountedThrough', case when v_open_duty_start is null then null else least(v_now, v_day_start) end,
    'dataSource', 'recorded-duty-plus-booking-forecast',
    'engineVersion', 'duty-v2'
  );
end;
$$;

select private.assert_function_permission_manifest();
