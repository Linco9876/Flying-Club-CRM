-- The booking resolver runs BEFORE INSERT so it can attach the reusable casual
-- contact to NEW. Its audit event uses NEW.id in the same statement, before the
-- parent booking row is physically present. Defer this one FK until the
-- statement transaction completes; all other integrity checks remain intact.
do $$
begin
  if to_regclass('public.casual_contact_events') is not null then
    alter table public.casual_contact_events
      drop constraint if exists casual_contact_events_booking_id_fkey;

    alter table public.casual_contact_events
      add constraint casual_contact_events_booking_id_fkey
      foreign key (booking_id)
      references public.bookings(id)
      on delete set null
      deferrable initially deferred;
  end if;
end;
$$;

comment on constraint casual_contact_events_booking_id_fkey on public.casual_contact_events is
  'Deferred so the BEFORE INSERT casual-contact resolver can audit the booking created by the same statement.';
