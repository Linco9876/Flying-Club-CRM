-- Allow members to request approval notifications only for their own bookings.
-- The function is idempotent because mobile and unreliable connections can retry.

CREATE OR REPLACE FUNCTION public.notify_instructor_booking_request(booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_booking_id uuid := booking_id;
  v_student_name text;
  v_aircraft_reg text;
  v_start_local text;
  v_message text;
  v_recipient uuid;
BEGIN
  SELECT b.*
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = v_booking_id;

  IF NOT FOUND
    OR v_booking.instructor_id IS NULL
    OR v_booking.status <> 'pending_approval'
    OR v_booking.deleted_at IS NOT NULL
  THEN
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL
    AND auth.uid() IS DISTINCT FROM v_booking.student_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['admin', 'instructor', 'senior_instructor'])
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = ANY (ARRAY['admin', 'instructor', 'senior_instructor'])
    )
  THEN
    RAISE EXCEPTION 'You can only request approval notifications for your own booking'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(trim(u.name), ''), 'A member')
  INTO v_student_name
  FROM public.users u
  WHERE u.id = v_booking.student_id;

  SELECT a.registration
  INTO v_aircraft_reg
  FROM public.aircraft a
  WHERE a.id = v_booking.aircraft_id;

  v_start_local := to_char(
    v_booking.start_time AT TIME ZONE 'Australia/Sydney',
    'FMDay DD Mon YYYY HH12:MI AM'
  );
  v_message := COALESCE(v_student_name, 'A member')
    || ' has requested a booking on '
    || COALESCE(v_aircraft_reg, 'an aircraft')
    || ' on '
    || v_start_local
    || '. Please approve, edit, or deny.';

  FOR v_recipient IN
    SELECT DISTINCT recipient_id
    FROM (
      SELECT v_booking.instructor_id AS recipient_id
      UNION ALL
      SELECT u.id
      FROM public.users u
      WHERE COALESCE(u.is_active, true)
        AND (
          u.role = 'admin'
          OR EXISTS (
            SELECT 1
            FROM public.user_roles ur
            WHERE ur.user_id = u.id
              AND ur.role = 'admin'
          )
        )
    ) recipients
    WHERE recipient_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      booking_id,
      metadata,
      is_read
    )
    SELECT
      v_recipient,
      'booking_approval',
      'Booking Request - Approval Required',
      v_message,
      v_booking_id,
      jsonb_build_object(
        'booking_id', v_booking_id::text,
        'student_id', v_booking.student_id::text,
        'instructor_id', v_booking.instructor_id::text
      ),
      false
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = v_recipient
        AND n.type = 'booking_approval'
        AND n.booking_id = v_booking_id
        AND NOT n.is_read
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_instructor_booking_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_instructor_booking_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_instructor_booking_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_instructor_booking_request(uuid) TO service_role;
