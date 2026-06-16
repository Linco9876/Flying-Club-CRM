CREATE OR REPLACE FUNCTION public.release_trial_voucher_when_booking_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.trial_flight_voucher_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.flight_logged, false)
    OR EXISTS (
      SELECT 1
      FROM public.flight_logs fl
      WHERE fl.booking_id = NEW.id
    )
  THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL OR NEW.status = 'cancelled' THEN
    UPDATE public.trial_flight_vouchers
    SET
      status = 'redeemed',
      booked_booking_id = NULL,
      updated_at = now(),
      notes = trim(both ' ' from concat_ws(
        ' ',
        nullif(notes, ''),
        'Linked booking released because booking was cancelled/deleted at ' || now()::text || '.'
      ))
    WHERE id = NEW.trial_flight_voucher_id
      AND booked_booking_id = NEW.id
      AND status = 'booked';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS release_trial_voucher_when_booking_cancelled ON public.bookings;
CREATE TRIGGER release_trial_voucher_when_booking_cancelled
  AFTER UPDATE OF status, deleted_at, flight_logged
  ON public.bookings
  FOR EACH ROW
  WHEN (
    NEW.trial_flight_voucher_id IS NOT NULL
    AND (NEW.deleted_at IS NOT NULL OR NEW.status = 'cancelled')
  )
  EXECUTE FUNCTION public.release_trial_voucher_when_booking_cancelled();

UPDATE public.trial_flight_vouchers tv
SET
  status = 'redeemed',
  booked_booking_id = NULL,
  updated_at = now(),
  notes = trim(both ' ' from concat_ws(
    ' ',
    nullif(tv.notes, ''),
    'Linked booking released by voucher booking cleanup at ' || now()::text || '.'
  ))
FROM public.bookings b
WHERE tv.booked_booking_id = b.id
  AND b.trial_flight_voucher_id = tv.id
  AND tv.status = 'booked'
  AND (b.deleted_at IS NOT NULL OR b.status = 'cancelled')
  AND COALESCE(b.flight_logged, false) = false
  AND NOT EXISTS (
    SELECT 1
    FROM public.flight_logs fl
    WHERE fl.booking_id = b.id
  );

REVOKE ALL ON FUNCTION public.release_trial_voucher_when_booking_cancelled() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_trial_voucher_when_booking_cancelled() FROM anon;
REVOKE ALL ON FUNCTION public.release_trial_voucher_when_booking_cancelled() FROM authenticated;
