-- Atomically book a trial-flight voucher slot.
-- The Edge Function still calculates candidate availability, but this database
-- function is the final concurrency guard so two recipients cannot claim the
-- same aircraft or instructor time at once.

CREATE OR REPLACE FUNCTION public.book_trial_flight_voucher_slot(
  p_voucher_id uuid,
  p_student_id uuid,
  p_aircraft_id uuid,
  p_instructor_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher public.trial_flight_vouchers%ROWTYPE;
  v_booking_id uuid;
BEGIN
  IF p_start_time IS NULL
    OR p_end_time IS NULL
    OR p_end_time <= p_start_time
    OR p_voucher_id IS NULL
    OR p_student_id IS NULL
    OR p_aircraft_id IS NULL
    OR p_instructor_id IS NULL
  THEN
    RAISE EXCEPTION 'A valid voucher, student, aircraft, instructor, start time and end time are required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialise booking attempts for each affected resource so overlapping slots
  -- cannot be inserted concurrently when the slot is currently empty.
  PERFORM pg_advisory_xact_lock(hashtextextended('trial-voucher-aircraft:' || p_aircraft_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('trial-voucher-instructor:' || p_instructor_id::text, 0));

  SELECT *
  INTO v_voucher
  FROM public.trial_flight_vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_voucher.status <> 'redeemed'
    OR v_voucher.redeemed_by_user_id IS DISTINCT FROM p_student_id
    OR v_voucher.booked_booking_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'This voucher is not available for booking'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.bookings b
  WHERE b.deleted_at IS NULL
    AND b.status IN ('confirmed', 'pending_approval')
    AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
    AND (
      b.aircraft_id = p_aircraft_id
      OR b.instructor_id = p_instructor_id
    )
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'That time is no longer available'
      USING ERRCODE = '23P01';
  END IF;

  INSERT INTO public.bookings (
    student_id,
    aircraft_id,
    instructor_id,
    start_time,
    end_time,
    payment_type,
    status,
    has_conflict,
    notes,
    trial_flight_voucher_id
  )
  VALUES (
    p_student_id,
    p_aircraft_id,
    p_instructor_id,
    p_start_time,
    p_end_time,
    'Gift Voucher',
    'confirmed',
    false,
    p_notes,
    p_voucher_id
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.trial_flight_vouchers
  SET status = 'booked',
      booked_booking_id = v_booking_id,
      updated_at = now()
  WHERE id = p_voucher_id;

  RETURN v_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) TO service_role;
