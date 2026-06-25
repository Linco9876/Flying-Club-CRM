-- Allow staff to convert an existing booking into a guest/casual voucher booking.
-- Public voucher self-bookings still require a redeemed voucher holder, but staff-created
-- guest bookings may use an issued/unredeemed voucher and a guest placeholder account.

CREATE OR REPLACE FUNCTION public.prevent_trial_voucher_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher public.trial_flight_vouchers%ROWTYPE;
  v_product public.trial_flight_voucher_products%ROWTYPE;
  v_aircraft public.aircraft%ROWTYPE;
  v_required_endorsement text;
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

  SELECT *
  INTO v_voucher
  FROM public.trial_flight_vouchers
  WHERE id = NEW.trial_flight_voucher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_voucher.redeemed_by_user_id IS NOT NULL
    AND v_voucher.redeemed_by_user_id IS DISTINCT FROM NEW.student_id
  THEN
    RAISE EXCEPTION 'Voucher booking must belong to the voucher holder'
      USING ERRCODE = '23514';
  END IF;

  IF v_voucher.redeemed_by_user_id IS NULL
    AND COALESCE(NEW.is_guest_booking, false) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'Unredeemed vouchers can only be linked to guest bookings'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_product
  FROM public.trial_flight_voucher_products
  WHERE id = v_voucher.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher product was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_product.duration_minutes, 0) <= 0
    OR NEW.end_time <> NEW.start_time + ((v_product.duration_minutes + 30) * interval '1 minute')
  THEN
    RAISE EXCEPTION 'Voucher booking duration must match the voucher flight time plus 30 minutes'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.trial_voucher_instructor_available_for_slot(NEW.instructor_id, NEW.start_time, NEW.end_time) THEN
    RAISE EXCEPTION 'Selected instructor is not available for that voucher booking time'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_aircraft
  FROM public.aircraft
  WHERE id = NEW.aircraft_id;

  IF NOT FOUND OR v_aircraft.status <> 'serviceable' THEN
    RAISE EXCEPTION 'Selected aircraft is not available for this voucher'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(array_length(v_product.aircraft_ids, 1), 0) = 0
    OR NEW.aircraft_id <> ALL(v_product.aircraft_ids)
  THEN
    RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(array_length(v_product.instructor_ids, 1), 0) = 0
    OR NEW.instructor_id <> ALL(v_product.instructor_ids)
  THEN
    RAISE EXCEPTION 'Selected instructor is not eligible for this voucher'
      USING ERRCODE = '23514';
  END IF;

  v_required_endorsement := lower(trim(coalesce(v_aircraft.required_endorsement_type, '')));

  IF v_required_endorsement <> '' AND NOT EXISTS (
    SELECT 1
    FROM public.endorsements e
    WHERE e.student_id = NEW.instructor_id
      AND e.is_active IS NOT FALSE
      AND lower(trim(e.type)) = v_required_endorsement
      AND (e.expiry_date IS NULL OR e.expiry_date >= current_date)
  ) THEN
    RAISE EXCEPTION 'Selected instructor does not hold the required aircraft endorsement'
      USING ERRCODE = '23514';
  END IF;

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

CREATE OR REPLACE FUNCTION public.sync_trial_voucher_booking_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.trial_flight_voucher_id IS NOT NULL
    AND OLD.trial_flight_voucher_id IS DISTINCT FROM NEW.trial_flight_voucher_id
    AND COALESCE(OLD.flight_logged, false) IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.flight_logs fl
      WHERE fl.booking_id = OLD.id
    )
  THEN
    UPDATE public.trial_flight_vouchers
    SET
      status = CASE WHEN status = 'booked' THEN 'redeemed' ELSE status END,
      booked_booking_id = NULL,
      updated_at = now()
    WHERE id = OLD.trial_flight_voucher_id
      AND booked_booking_id = OLD.id;
  END IF;

  IF NEW.trial_flight_voucher_id IS NOT NULL
    AND NEW.deleted_at IS NULL
    AND NEW.status IN ('confirmed', 'pending_approval')
    AND COALESCE(NEW.flight_logged, false) IS NOT TRUE
  THEN
    UPDATE public.trial_flight_vouchers
    SET
      status = 'booked',
      booked_booking_id = NEW.id,
      updated_at = now()
    WHERE id = NEW.trial_flight_voucher_id
      AND status IN ('issued', 'redeemed', 'booked')
      AND (booked_booking_id IS NULL OR booked_booking_id = NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_trial_voucher_booking_link ON public.bookings;
CREATE TRIGGER sync_trial_voucher_booking_link
  AFTER INSERT OR UPDATE OF trial_flight_voucher_id, status, deleted_at, flight_logged
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_trial_voucher_booking_link();

REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM authenticated;

REVOKE ALL ON FUNCTION public.sync_trial_voucher_booking_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_trial_voucher_booking_link() FROM anon;
REVOKE ALL ON FUNCTION public.sync_trial_voucher_booking_link() FROM authenticated;
