-- Safety fallback for missed duty clock-ins and clock-outs.
-- Manual duty records remain preferred; these records are explicitly labelled
-- and audited so they can be reviewed and amended later.

alter table public.duty_periods
  add column if not exists entry_source text not null default 'manual',
  add column if not exists auto_started_for_booking_id uuid references public.bookings(id) on delete set null,
  add column if not exists auto_closed_at_limit boolean not null default false;

alter table public.duty_periods drop constraint if exists duty_periods_entry_source_check;
alter table public.duty_periods add constraint duty_periods_entry_source_check
  check (entry_source in ('manual', 'automatic_booking'));

create index if not exists duty_periods_auto_booking_idx
  on public.duty_periods(auto_started_for_booking_id)
  where auto_started_for_booking_id is not null;

create or replace function public.effective_daily_duty_limit_hours(p_start timestamptz)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_configured numeric;
begin
  select fatigue_max_duty_hours_per_day
    into v_configured
    from public.booking_rules_settings
   order by updated_at desc nulls last
   limit 1;

  return least(
    public.casa_appendix_6_fdp_limit_hours(p_start),
    coalesce(nullif(v_configured, 0), public.casa_appendix_6_fdp_limit_hours(p_start))
  );
end;
$$;

create or replace function public.maximum_duty_end(p_start timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select least(
    p_start + make_interval(secs => (public.effective_daily_duty_limit_hours(p_start) * 3600)::double precision),
    ((((p_start at time zone 'Australia/Sydney')::date + 1) + time '01:00') at time zone 'Australia/Sydney')
  );
$$;

create or replace function public.reconcile_automatic_duty_periods(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_booking record;
  v_max_end timestamptz;
  v_started_id uuid;
  v_started_count integer := 0;
  v_closed_count integer := 0;
  v_flight_minutes integer := 0;
begin
  -- Close every forgotten active duty at its applicable maximum. This applies
  -- to both manually and automatically started duties.
  for v_period in
    select d.*
      from public.duty_periods d
     where d.status = 'active'
       and d.actual_start is not null
       and public.maximum_duty_end(d.actual_start) <= p_now
     for update skip locked
  loop
    v_max_end := public.maximum_duty_end(v_period.actual_start);

    select coalesce(sum(greatest(0, round(coalesce(nullif(fl.duration, 0), fl.flight_duration, 0) * 60)))::integer, 0)
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
      format('Your duty was closed at %s because no clock-out was recorded. Review and amend it if your actual finish time was earlier.', to_char(v_max_end at time zone 'Australia/Sydney', 'DD Mon HH24:MI')),
      v_period.auto_started_for_booking_id,
      jsonb_build_object('dutyPeriodId', v_period.id, 'maximumDutyEnd', v_max_end)
    );
    v_closed_count := v_closed_count + 1;
  end loop;

  -- Start duty 30 minutes before the earliest confirmed flight that is now in
  -- its pre-flight window and is not already covered by a duty record.
  for v_booking in
    select distinct on (b.instructor_id)
      b.id, b.instructor_id, b.start_time, b.end_time, coalesce(b.location, 'Bendigo') as location
      from public.bookings b
     where b.instructor_id is not null
       and coalesce(b.booking_kind, 'flight') <> 'ground'
       and b.status = 'confirmed'
       and b.deleted_at is null
       and coalesce(b.has_conflict, false) is false
       and b.start_time - interval '30 minutes' <= p_now
       and b.end_time > p_now
       and not exists (
         select 1
           from public.duty_periods d
          where d.instructor_id = b.instructor_id
            and coalesce(d.actual_start, d.planned_start) <= p_now
            and coalesce(d.actual_end, d.planned_end, 'infinity'::timestamptz) > p_now
            and d.status in ('active', 'completed')
       )
     order by b.instructor_id, b.start_time
  loop
    begin
      insert into public.duty_periods(
        instructor_id,
        duty_date,
        actual_start,
        location,
        status,
        entry_source,
        auto_started_for_booking_id,
        notes
      )
      values (
        v_booking.instructor_id,
        (v_booking.start_time at time zone 'Australia/Sydney')::date,
        v_booking.start_time - interval '30 minutes',
        v_booking.location,
        'active',
        'automatic_booking',
        v_booking.id,
        'Automatically started because no duty clock-in was recorded before the flight.'
      )
      returning id into v_started_id;

      insert into public.notifications(user_id, type, title, message, booking_id, metadata)
      values (
        v_booking.instructor_id,
        'duty_auto_started',
        'Duty started automatically',
        format('Duty was started at %s, 30 minutes before your flight. Clock out when your duty finishes.', to_char((v_booking.start_time - interval '30 minutes') at time zone 'Australia/Sydney', 'DD Mon HH24:MI')),
        v_booking.id,
        jsonb_build_object('dutyPeriodId', v_started_id, 'automaticStart', v_booking.start_time - interval '30 minutes')
      );
      v_started_count := v_started_count + 1;
    exception
      when unique_violation then
        -- Another scheduler run or a manual clock-in won the race.
        null;
    end;
  end loop;

  return jsonb_build_object(
    'started', v_started_count,
    'closed', v_closed_count,
    'reconciledAt', p_now
  );
end;
$$;

revoke all on function public.reconcile_automatic_duty_periods(timestamptz) from public;
revoke all on function public.effective_daily_duty_limit_hours(timestamptz) from public;
revoke all on function public.maximum_duty_end(timestamptz) from public;
grant execute on function public.effective_daily_duty_limit_hours(timestamptz) to authenticated;
grant execute on function public.maximum_duty_end(timestamptz) to authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'reconcile-automatic-instructor-duty'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'reconcile-automatic-instructor-duty',
    '* * * * *',
    'select public.reconcile_automatic_duty_periods();'
  );
end;
$$;
