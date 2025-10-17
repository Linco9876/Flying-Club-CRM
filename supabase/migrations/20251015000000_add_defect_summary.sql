/*
  # Add Conflict Detection and Notifications

  1. New Tables
    - `notifications` - System notifications for users
    - `booking_conflicts` - Track bookings with conflicts

  2. Changes
    - Add `is_available` flag to aircraft table
    - Add `is_available` flag to users table (for instructors)
    - Add `has_conflict` flag to bookings table

  3. Functions
    - `check_booking_conflicts` - Check for aircraft/instructor double-booking
    - `mark_conflicting_bookings` - Mark bookings as conflicted when resources go offline
    - `create_conflict_notification` - Create notifications for conflict events

  4. Security
    - Enable RLS on notifications table
    - Users can only read their own notifications
*/

-- Add availability flags
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT true;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS has_conflict boolean DEFAULT false;

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('conflict', 'cancellation', 'reminder', 'system')),
  title text NOT NULL,
  message text NOT NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to check for booking conflicts
CREATE OR REPLACE FUNCTION check_booking_conflicts(
  p_booking_id uuid,
  p_aircraft_id uuid,
  p_instructor_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS TABLE (
  conflict_type text,
  conflict_with uuid,
  conflicting_booking_id uuid
) AS $$
BEGIN
  -- Check for aircraft conflicts
  RETURN QUERY
  SELECT
    'aircraft'::text as conflict_type,
    p_aircraft_id as conflict_with,
    b.id as conflicting_booking_id
  FROM bookings b
  WHERE b.aircraft_id = p_aircraft_id
    AND b.status = 'confirmed'
    AND (p_booking_id IS NULL OR b.id != p_booking_id)
    AND (
      (b.start_time, b.end_time) OVERLAPS (p_start_time, p_end_time)
    );

  -- Check for instructor conflicts (if instructor is assigned)
  IF p_instructor_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      'instructor'::text as conflict_type,
      p_instructor_id as conflict_with,
      b.id as conflicting_booking_id
    FROM bookings b
    WHERE b.instructor_id = p_instructor_id
      AND b.status = 'confirmed'
      AND (p_booking_id IS NULL OR b.id != p_booking_id)
      AND (
        (b.start_time, b.end_time) OVERLAPS (p_start_time, p_end_time)
      );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to mark bookings with conflicts when resources go offline
CREATE OR REPLACE FUNCTION mark_conflicting_bookings(
  p_resource_type text,
  p_resource_id uuid
)
RETURNS void AS $$
DECLARE
  v_booking RECORD;
BEGIN
  -- Mark relevant bookings as conflicted
  IF p_resource_type = 'aircraft' THEN
    UPDATE bookings
    SET has_conflict = true
    WHERE aircraft_id = p_resource_id
      AND status = 'confirmed'
      AND start_time > now();

    -- Create notifications for affected bookings
    FOR v_booking IN
      SELECT b.id, b.student_id, b.instructor_id, b.start_time, a.registration
      FROM bookings b
      JOIN aircraft a ON a.id = b.aircraft_id
      WHERE b.aircraft_id = p_resource_id
        AND b.status = 'confirmed'
        AND b.start_time > now()
        AND b.has_conflict = true
    LOOP
      -- Notify student
      INSERT INTO notifications (user_id, type, title, message, booking_id)
      VALUES (
        v_booking.student_id,
        'conflict',
        'Booking Conflict',
        'Your booking on ' || to_char(v_booking.start_time, 'DD Mon YYYY at HH24:MI') ||
        ' has a conflict. Aircraft ' || v_booking.registration || ' is no longer available.',
        v_booking.id
      );

      -- Notify instructor if assigned
      IF v_booking.instructor_id IS NOT NULL THEN
        INSERT INTO notifications (user_id, type, title, message, booking_id)
        VALUES (
          v_booking.instructor_id,
          'conflict',
          'Booking Conflict',
          'A booking on ' || to_char(v_booking.start_time, 'DD Mon YYYY at HH24:MI') ||
          ' has a conflict. Aircraft ' || v_booking.registration || ' is no longer available.',
          v_booking.id
        );
      END IF;
    END LOOP;
  ELSIF p_resource_type = 'instructor' THEN
    UPDATE bookings
    SET has_conflict = true
    WHERE instructor_id = p_resource_id
      AND status = 'confirmed'
      AND start_time > now();

    -- Create notifications for affected bookings
    FOR v_booking IN
      SELECT b.id, b.student_id, b.instructor_id, b.start_time, u.name as instructor_name
      FROM bookings b
      JOIN users u ON u.id = b.instructor_id
      WHERE b.instructor_id = p_resource_id
        AND b.status = 'confirmed'
        AND b.start_time > now()
        AND b.has_conflict = true
    LOOP
      -- Notify student
      INSERT INTO notifications (user_id, type, title, message, booking_id)
      VALUES (
        v_booking.student_id,
        'conflict',
        'Booking Conflict',
        'Your booking on ' || to_char(v_booking.start_time, 'DD Mon YYYY at HH24:MI') ||
        ' has a conflict. Instructor ' || v_booking.instructor_name || ' is no longer available.',
        v_booking.id
      );
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger to mark conflicts when aircraft is set to unavailable
CREATE OR REPLACE FUNCTION trigger_aircraft_availability_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_available = false AND OLD.is_available = true THEN
    PERFORM mark_conflicting_bookings('aircraft', NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aircraft_availability_trigger
  AFTER UPDATE OF is_available ON aircraft
  FOR EACH ROW
  EXECUTE FUNCTION trigger_aircraft_availability_change();

-- Trigger to mark conflicts when instructor is set to unavailable
CREATE OR REPLACE FUNCTION trigger_instructor_availability_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_available = false AND OLD.is_available = true AND NEW.role = 'instructor' THEN
    PERFORM mark_conflicting_bookings('instructor', NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER instructor_availability_trigger
  AFTER UPDATE OF is_available ON users
  FOR EACH ROW
  EXECUTE FUNCTION trigger_instructor_availability_change();
