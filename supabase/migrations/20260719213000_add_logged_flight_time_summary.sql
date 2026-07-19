-- Return the instructor's logged flight time for one local operating day.
-- Calculating this in Postgres keeps Australia/Sydney day boundaries consistent
-- for every browser and uses the same duration precedence as duty segments.
create or replace function public.get_logged_instructor_flight_summary(
  p_instructor_id uuid,
  p_duty_date date
)
returns table(flight_minutes integer, flight_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_instructor_id and not public.current_user_is_admin() then
    raise exception 'You can only view your own logged flight summary';
  end if;

  return query
  select
    coalesce(sum(greatest(0, round(coalesce(nullif(fl.duration, 0), fl.flight_duration, 0) * 60)))::integer, 0),
    count(*)
  from public.flight_logs fl
  left join public.bookings b on b.id = fl.booking_id
  where fl.instructor_id = p_instructor_id
    and (coalesce(fl.start_time, b.start_time) at time zone 'Australia/Sydney')::date = p_duty_date;
end;
$$;

revoke all on function public.get_logged_instructor_flight_summary(uuid, date) from public;
grant execute on function public.get_logged_instructor_flight_summary(uuid, date) to authenticated;
