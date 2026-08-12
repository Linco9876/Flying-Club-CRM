-- A booking represents one flight event, so it must never be billed or logged twice.
do $$
declare
  duplicate_booking_id uuid;
begin
  select booking_id
    into duplicate_booking_id
  from public.flight_logs
  where booking_id is not null
  group by booking_id
  having count(*) > 1
  limit 1;

  if duplicate_booking_id is not null then
    raise exception 'Cannot enforce one flight log per booking: booking % has duplicate flight logs', duplicate_booking_id;
  end if;
end;
$$;

create unique index if not exists flight_logs_one_per_booking_idx
  on public.flight_logs (booking_id)
  where booking_id is not null;

-- Repair any stale calendar markers before the new client begins relying on them.
update public.bookings booking
set flight_logged = exists (
  select 1
  from public.flight_logs flight_log
  where flight_log.booking_id = booking.id
)
where booking.flight_logged is distinct from exists (
  select 1
  from public.flight_logs flight_log
  where flight_log.booking_id = booking.id
);
