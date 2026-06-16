CREATE OR REPLACE FUNCTION public.archive_trial_voucher_account_after_logged_flight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  voucher_user_id uuid;
BEGIN
  IF NEW.booking_id IS NULL OR NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tv.redeemed_by_user_id
  INTO voucher_user_id
  FROM public.trial_flight_vouchers tv
  WHERE tv.booked_booking_id = NEW.booking_id
    AND tv.redeemed_by_user_id = NEW.student_id
  LIMIT 1;

  IF voucher_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.users
  SET
    is_active = false,
    portal_access_scope = 'trial_voucher',
    updated_at = now()
  WHERE id = voucher_user_id
    AND COALESCE(portal_access_scope, 'full') = 'trial_voucher';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS archive_trial_voucher_account_after_logged_flight ON public.flight_logs;
CREATE TRIGGER archive_trial_voucher_account_after_logged_flight
  AFTER INSERT OR UPDATE OF booking_id, student_id
  ON public.flight_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.archive_trial_voucher_account_after_logged_flight();

UPDATE public.users u
SET
  is_active = false,
  portal_access_scope = 'trial_voucher',
  updated_at = now()
FROM public.trial_flight_vouchers tv
WHERE u.id = tv.redeemed_by_user_id
  AND COALESCE(u.portal_access_scope, 'full') = 'trial_voucher'
  AND EXISTS (
    SELECT 1
    FROM public.flight_logs fl
    WHERE fl.booking_id = tv.booked_booking_id
      AND fl.student_id = tv.redeemed_by_user_id
  );

REVOKE ALL ON FUNCTION public.archive_trial_voucher_account_after_logged_flight() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_trial_voucher_account_after_logged_flight() FROM anon;
REVOKE ALL ON FUNCTION public.archive_trial_voucher_account_after_logged_flight() FROM authenticated;
