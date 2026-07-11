ALTER TABLE public.bookings
  ALTER COLUMN aircraft_id DROP NOT NULL;

COMMENT ON COLUMN public.bookings.aircraft_id IS
  'Aircraft booked for flight bookings. Nullable for instructor-only ground session bookings.';
