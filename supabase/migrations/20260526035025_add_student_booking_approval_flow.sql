/*
  # Student Booking Approval Flow

  ## Summary
  Enables students to create bookings that remain in a "pending_approval" state
  until approved by the chosen instructor or an admin.

  ## Changes

  ### 1. bookings table
  - Expands the status CHECK constraint to include 'pending_approval'

  ### 2. notify_instructor_booking_request function
  - New SQL function called after a student creates a booking with an instructor
  - Inserts a notification for the chosen instructor (and all admins) with type
    'booking_approval', linking the booking and carrying metadata (booking_id,
    student_id, instructor_id) so the front-end can render inline approve/reject
    actions without a page navigation.

  ### Security
  - Function is SECURITY DEFINER so it can insert into notifications regardless
    of the calling user's RLS permissions.
  - GRANT to authenticated only.
*/

-- 1. Widen the status constraint to allow pending_approval
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no-show', 'pending_approval'));

-- 2. Function: notify instructor + admins when a student requests a booking
CREATE OR REPLACE FUNCTION notify_instructor_booking_request(booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking         bookings%ROWTYPE;
  v_student_name    text;
  v_aircraft_reg    text;
  v_start_local     text;
  v_recipient       uuid;
BEGIN
  -- Fetch booking row
  SELECT * INTO v_booking FROM bookings WHERE id = booking_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Only proceed when an instructor was chosen
  IF v_booking.instructor_id IS NULL THEN RETURN; END IF;

  -- Resolve display values
  SELECT name        INTO v_student_name  FROM users   WHERE id = v_booking.student_id;
  SELECT registration INTO v_aircraft_reg FROM aircraft WHERE id = v_booking.aircraft_id;
  v_start_local := to_char(v_booking.start_time AT TIME ZONE 'UTC', 'FMDay DD Mon YYYY HH12:MI AM');

  -- Notify the chosen instructor
  INSERT INTO notifications (user_id, type, title, message, booking_id, metadata, is_read)
  VALUES (
    v_booking.instructor_id,
    'booking_approval',
    'Booking Request – Approval Required',
    v_student_name || ' has requested a booking on ' || COALESCE(v_aircraft_reg, 'an aircraft') || ' on ' || v_start_local || '. Please approve, edit, or deny.',
    booking_id,
    jsonb_build_object(
      'booking_id',    booking_id::text,
      'student_id',    v_booking.student_id::text,
      'instructor_id', v_booking.instructor_id::text
    ),
    false
  );

  -- Notify all admins
  FOR v_recipient IN
    SELECT id FROM users WHERE role = 'admin'
  LOOP
    -- Skip if admin is also the instructor (already notified)
    CONTINUE WHEN v_recipient = v_booking.instructor_id;

    INSERT INTO notifications (user_id, type, title, message, booking_id, metadata, is_read)
    VALUES (
      v_recipient,
      'booking_approval',
      'Booking Request – Approval Required',
      v_student_name || ' has requested a booking on ' || COALESCE(v_aircraft_reg, 'an aircraft') || ' on ' || v_start_local || '. Please approve, edit, or deny.',
      booking_id,
      jsonb_build_object(
        'booking_id',    booking_id::text,
        'student_id',    v_booking.student_id::text,
        'instructor_id', v_booking.instructor_id::text
      ),
      false
    );
  END LOOP;
END;
$$;

-- Restrict to authenticated users only
REVOKE ALL ON FUNCTION notify_instructor_booking_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_instructor_booking_request(uuid) TO authenticated;
