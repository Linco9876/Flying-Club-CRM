create or replace function public.prevent_uncovered_supervised_flight_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if new.booking_id is null then
    return new;
  end if;

  select booking.*
    into v_booking
  from public.bookings booking
  where booking.id = new.booking_id;

  if not found then
    return new;
  end if;

  if v_booking.deleted_at is not null
     or v_booking.status in ('cancelled', 'no-show') then
    raise exception 'A cancelled or no-show booking cannot have a flight log';
  end if;

  if coalesce(v_booking.has_conflict, false) then
    raise exception 'A booking on the waiting list cannot have a flight log until its conflict is resolved';
  end if;

  if v_booking.status = 'pending_approval' then
    raise exception 'This booking must be approved before a flight can be logged';
  end if;

  if v_booking.supervision_required
     and (
       v_booking.supervision_status = 'pending'
       or v_booking.supervising_instructor_id is null
       or v_booking.status = 'pending_supervision'
     ) then
    raise exception 'This flight is pending supervision and cannot be logged until an authorised senior instructor is available';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_uncovered_supervised_flight_log() from public, anon, authenticated;

select private.assert_function_permission_manifest();

comment on function public.prevent_uncovered_supervised_flight_log() is
  'Prevents flight logs for waitlisted, cancelled, unapproved, or uncovered supervised bookings.';
