-- Enforce the same no-overlap rule at the database boundary for live Edge
-- Functions and any future code path that inserts a trial voucher booking.

CREATE OR REPLACE FUNCTION public.prevent_trial_voucher_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.trial_flight_voucher_id IS NULL
    OR NEW.deleted_at IS NOT NULL
    OR NEW.status NOT IN ('confirmed', 'pending_approval')
  THEN
    RETURN NEW;
  END IF;

  IF NEW.start_time IS NULL
    OR NEW.end_time IS NULL
    OR NEW.end_time <= NEW.start_time
    OR NEW.aircraft_id IS NULL
    OR NEW.instructor_id IS NULL
  THEN
    RAISE EXCEPTION 'A valid aircraft, instructor, start time and end time are required for voucher bookings'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('trial-voucher-aircraft:' || NEW.aircraft_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('trial-voucher-instructor:' || NEW.instructor_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id IS DISTINCT FROM NEW.id
      AND b.deleted_at IS NULL
      AND b.status IN ('confirmed', 'pending_approval')
      AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)')
      AND (
        b.aircraft_id = NEW.aircraft_id
        OR b.instructor_id = NEW.instructor_id
      )
  ) THEN
    RAISE EXCEPTION 'That time is no longer available'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_trial_voucher_booking_overlap ON public.bookings;
CREATE TRIGGER prevent_trial_voucher_booking_overlap
  BEFORE INSERT OR UPDATE OF aircraft_id, instructor_id, start_time, end_time, status, deleted_at, trial_flight_voucher_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_trial_voucher_booking_overlap();

REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM authenticated;
