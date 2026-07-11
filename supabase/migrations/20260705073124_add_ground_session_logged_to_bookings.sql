alter table public.bookings
add column if not exists ground_session_logged boolean not null default false;

do $$
begin
  if to_regclass('public.ground_session_logs') is not null then
    update public.bookings b
    set ground_session_logged = exists (
      select 1
      from public.ground_session_logs gsl
      where gsl.booking_id = b.id
    )
    where b.ground_session_logged is distinct from exists (
      select 1
      from public.ground_session_logs gsl
      where gsl.booking_id = b.id
    );
  end if;
end $$;

create index if not exists idx_bookings_ground_session_logged
on public.bookings(ground_session_logged)
where ground_session_logged = true;

notify pgrst, 'reload schema';
