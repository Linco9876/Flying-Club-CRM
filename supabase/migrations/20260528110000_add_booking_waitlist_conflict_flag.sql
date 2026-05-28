/*
  Add the booking waitlist/conflict flag used by the calendar booking flow.

  Some live databases missed the older conflict-detection migration, while the
  current app now uses has_conflict to place overlapping bookings into the
  calendar waiting-list lane.
*/

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS has_conflict boolean DEFAULT false;

UPDATE public.bookings
SET has_conflict = false
WHERE has_conflict IS NULL;

ALTER TABLE public.bookings
ALTER COLUMN has_conflict SET DEFAULT false;

NOTIFY pgrst, 'reload schema';
