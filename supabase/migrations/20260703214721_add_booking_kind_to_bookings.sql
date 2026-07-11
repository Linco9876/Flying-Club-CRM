alter table public.bookings
add column if not exists booking_kind text not null default 'flight';

alter table public.bookings
drop constraint if exists bookings_booking_kind_check;

alter table public.bookings
add constraint bookings_booking_kind_check
check (booking_kind in ('flight', 'ground'));

update public.bookings
set booking_kind = 'flight'
where booking_kind is null or booking_kind not in ('flight', 'ground');

notify pgrst, 'reload schema';
