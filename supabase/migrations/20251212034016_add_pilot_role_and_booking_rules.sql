/*
  # Add Pilot Role and Update Booking System

  1. Changes
    - Rename student_id to pilot_id in bookings table
    - Add validation: students must have instructor, pilots don't need one
    - Create function to validate booking based on user roles
  
  2. Security
    - Students can only book with an instructor
    - Pilots can book solo
    - Instructors and admins can book for anyone
*/

-- Rename student_id to pilot_id in bookings table
ALTER TABLE bookings RENAME COLUMN student_id TO pilot_id;

-- Create function to validate booking rules
CREATE OR REPLACE FUNCTION validate_booking_instructor_requirement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pilot_roles text[];
BEGIN
  -- Get the pilot's roles
  SELECT array_agg(role)
  INTO pilot_roles
  FROM user_roles
  WHERE user_id = NEW.pilot_id;

  -- If pilot is only a student (not also pilot/instructor/admin), require instructor
  IF pilot_roles @> ARRAY['student']::text[] 
     AND NOT (pilot_roles && ARRAY['pilot', 'instructor', 'admin']::text[]) THEN
    IF NEW.instructor_id IS NULL THEN
      RAISE EXCEPTION 'Students must have an instructor assigned to their booking';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to validate bookings
DROP TRIGGER IF EXISTS validate_booking_trigger ON bookings;
CREATE TRIGGER validate_booking_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION validate_booking_instructor_requirement();

-- Now update the policies with correct column name
DROP POLICY IF EXISTS "Instructors can view all bookings" ON bookings;
DROP POLICY IF EXISTS "Instructors can create bookings" ON bookings;
DROP POLICY IF EXISTS "Instructors can update all bookings" ON bookings;
DROP POLICY IF EXISTS "Instructors can delete bookings" ON bookings;
DROP POLICY IF EXISTS "Users can view own bookings" ON bookings;
DROP POLICY IF EXISTS "Users can create own bookings" ON bookings;
DROP POLICY IF EXISTS "Users can update own bookings" ON bookings;
DROP POLICY IF EXISTS "Users can delete own bookings" ON bookings;
DROP POLICY IF EXISTS "Admins and instructors can view all bookings" ON bookings;
DROP POLICY IF EXISTS "Admins and instructors can create bookings" ON bookings;
DROP POLICY IF EXISTS "Admins and instructors can update all bookings" ON bookings;
DROP POLICY IF EXISTS "Admins and instructors can delete bookings" ON bookings;
DROP POLICY IF EXISTS "Pilots can create bookings" ON bookings;

-- Admins and instructors can manage all bookings
CREATE POLICY "Admins and instructors can view all bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (has_role('admin') OR has_role('instructor'));

CREATE POLICY "Admins and instructors can create bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin') OR has_role('instructor'));

CREATE POLICY "Admins and instructors can update all bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (has_role('admin') OR has_role('instructor'))
  WITH CHECK (has_role('admin') OR has_role('instructor'));

CREATE POLICY "Admins and instructors can delete bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (has_role('admin') OR has_role('instructor'));

-- Pilots and students can manage their own bookings
CREATE POLICY "Users can view own bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (pilot_id = auth.uid() OR instructor_id = auth.uid());

CREATE POLICY "Users can create own bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (pilot_id = auth.uid() OR instructor_id = auth.uid());

CREATE POLICY "Users can update own bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (pilot_id = auth.uid() OR instructor_id = auth.uid())
  WITH CHECK (pilot_id = auth.uid() OR instructor_id = auth.uid());

CREATE POLICY "Users can delete own bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (pilot_id = auth.uid() OR instructor_id = auth.uid());
