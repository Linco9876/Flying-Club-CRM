-- Enforce trial voucher duration and instructor roster availability at the
-- database boundary, matching the public voucher slot builder.

CREATE OR REPLACE FUNCTION public.trial_voucher_instructor_available_for_slot(
  p_instructor_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_start timestamp;
  v_local_end timestamp;
  v_slot_date date;
  v_day_of_week integer;
  v_schedule record;
  v_start_time time;
  v_end_time time;
BEGIN
  IF p_instructor_id IS NULL
    OR p_start_time IS NULL
    OR p_end_time IS NULL
    OR p_end_time <= p_start_time
  THEN
    RETURN false;
  END IF;

  v_local_start := p_start_time AT TIME ZONE 'Australia/Sydney';
  v_local_end := p_end_time AT TIME ZONE 'Australia/Sydney';

  -- Trial voucher blocks should not span two local roster days.
  IF v_local_start::date IS DISTINCT FROM v_local_end::date THEN
    RETURN false;
  END IF;

  v_slot_date := v_local_start::date;
  v_day_of_week := extract(dow from v_slot_date)::integer;
  v_start_time := v_local_start::time;
  v_end_time := v_local_end::time;

  IF EXISTS (
    SELECT 1
    FROM public.instructor_absences a
    WHERE (a.user_id = p_instructor_id OR a.instructor_id = p_instructor_id)
      AND v_slot_date >= a.start_date
      AND v_slot_date <= a.end_date
      AND (
        a.start_time IS NULL
        OR a.end_time IS NULL
        OR (v_start_time < a.end_time AND v_end_time > a.start_time)
      )
  ) THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_schedule
  FROM public.instructor_schedule_changes c
  WHERE (c.user_id = p_instructor_id OR c.instructor_id = p_instructor_id)
    AND c.day_of_week = v_day_of_week
    AND coalesce(c.effective_from, c.change_date) <= v_slot_date
  ORDER BY coalesce(c.effective_from, c.change_date) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT *
    INTO v_schedule
    FROM public.instructor_weekly_schedules s
    WHERE (s.user_id = p_instructor_id OR s.instructor_id = p_instructor_id)
      AND s.day_of_week = v_day_of_week
    LIMIT 1;
  END IF;

  IF NOT FOUND OR v_schedule.is_available IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_schedule.start_time IS NOT NULL
    AND v_schedule.end_time IS NOT NULL
    AND v_start_time >= v_schedule.start_time
    AND v_end_time <= v_schedule.end_time
  THEN
    RETURN true;
  END IF;

  IF coalesce(v_schedule.afternoon_start_time, v_schedule.start_time_2) IS NOT NULL
    AND coalesce(v_schedule.afternoon_end_time, v_schedule.end_time_2) IS NOT NULL
    AND v_start_time >= coalesce(v_schedule.afternoon_start_time, v_schedule.start_time_2)
    AND v_end_time <= coalesce(v_schedule.afternoon_end_time, v_schedule.end_time_2)
  THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

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
  v_product public.trial_flight_voucher_products%ROWTYPE;
  v_aircraft public.aircraft%ROWTYPE;
  v_aircraft_label text;
  v_aircraft_compact_label text;
  v_required_endorsement text;
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

  SELECT *
  INTO v_product
  FROM public.trial_flight_voucher_products
  WHERE id = v_voucher.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher product was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_product.duration_minutes, 0) <= 0
    OR p_end_time <> p_start_time + ((v_product.duration_minutes + 30) * interval '1 minute')
  THEN
    RAISE EXCEPTION 'Voucher booking duration must match the voucher flight time plus 30 minutes'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.trial_voucher_instructor_available_for_slot(p_instructor_id, p_start_time, p_end_time) THEN
    RAISE EXCEPTION 'Selected instructor is not available for that voucher booking time'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_aircraft
  FROM public.aircraft
  WHERE id = p_aircraft_id;

  IF NOT FOUND OR v_aircraft.status <> 'serviceable' THEN
    RAISE EXCEPTION 'Selected aircraft is not available for this voucher'
      USING ERRCODE = '23514';
  END IF;

  v_aircraft_label := lower(
    coalesce(v_aircraft.registration, '') || ' ' ||
    coalesce(v_aircraft.make, '') || ' ' ||
    coalesce(v_aircraft.model, '')
  );
  v_aircraft_compact_label := regexp_replace(v_aircraft_label, '[^a-z0-9]', '', 'g');

  IF coalesce(array_length(v_product.aircraft_ids, 1), 0) > 0 THEN
    IF p_aircraft_id <> ALL(v_product.aircraft_ids) THEN
      RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_product.aircraft_mode = 'tecnam' THEN
    IF position('tecnam' in v_aircraft_label) = 0 THEN
      RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_product.aircraft_mode = 'archer' THEN
    IF position('archer' in v_aircraft_label) = 0
      AND position('pa28' in v_aircraft_compact_label) = 0
      AND position('piperpa28' in v_aircraft_compact_label) = 0
    THEN
      RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(array_length(v_product.instructor_ids, 1), 0) = 0
    OR p_instructor_id <> ALL(v_product.instructor_ids)
  THEN
    RAISE EXCEPTION 'Selected instructor is not eligible for this voucher'
      USING ERRCODE = '23514';
  END IF;

  v_required_endorsement := lower(trim(coalesce(v_aircraft.required_endorsement_type, '')));

  IF v_required_endorsement <> '' AND NOT EXISTS (
    SELECT 1
    FROM public.endorsements e
    WHERE e.student_id = p_instructor_id
      AND e.is_active IS NOT FALSE
      AND lower(trim(e.type)) = v_required_endorsement
      AND (e.expiry_date IS NULL OR e.expiry_date >= current_date)
  ) THEN
    RAISE EXCEPTION 'Selected instructor does not hold the required aircraft endorsement'
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
  v_aircraft_label text;
  v_aircraft_compact_label text;
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

  IF v_voucher.redeemed_by_user_id IS DISTINCT FROM NEW.student_id THEN
    RAISE EXCEPTION 'Voucher booking must belong to the voucher holder'
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

  v_aircraft_label := lower(
    coalesce(v_aircraft.registration, '') || ' ' ||
    coalesce(v_aircraft.make, '') || ' ' ||
    coalesce(v_aircraft.model, '')
  );
  v_aircraft_compact_label := regexp_replace(v_aircraft_label, '[^a-z0-9]', '', 'g');

  IF coalesce(array_length(v_product.aircraft_ids, 1), 0) > 0 THEN
    IF NEW.aircraft_id <> ALL(v_product.aircraft_ids) THEN
      RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_product.aircraft_mode = 'tecnam' THEN
    IF position('tecnam' in v_aircraft_label) = 0 THEN
      RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_product.aircraft_mode = 'archer' THEN
    IF position('archer' in v_aircraft_label) = 0
      AND position('pa28' in v_aircraft_compact_label) = 0
      AND position('piperpa28' in v_aircraft_compact_label) = 0
    THEN
      RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
        USING ERRCODE = '23514';
    END IF;
  ELSE
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

REVOKE ALL ON FUNCTION public.trial_voucher_instructor_available_for_slot(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trial_voucher_instructor_available_for_slot(uuid, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.trial_voucher_instructor_available_for_slot(uuid, timestamptz, timestamptz) FROM authenticated;

REVOKE ALL ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM authenticated;
