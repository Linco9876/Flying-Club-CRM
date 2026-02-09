/*
  # Fix Booking Trigger Column Reference

  1. Changes
    - Update `validate_booking_instructor_requirement()` trigger function to use `student_id` instead of `pilot_id`
    - This fixes the error "record 'new' has no field 'pilot_id'" that occurs when creating bookings

  2. Notes
    - The column was renamed from `pilot_id` to `student_id` but the trigger function was not updated
    - This migration updates the trigger function to reference the correct column name
*/

-- Drop and recreate the trigger function with correct column reference
CREATE OR REPLACE FUNCTION validate_booking_instructor_requirement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  user_roles_array text[];
BEGIN
  -- Get the user's roles
  SELECT array_agg(role)
  INTO user_roles_array
  FROM user_roles
  WHERE user_id = NEW.student_id;

  -- If user is only a student (not also pilot/instructor/admin), require instructor
  IF user_roles_array @> ARRAY['student']::text[]
     AND NOT (user_roles_array && ARRAY['pilot', 'instructor', 'admin']::text[]) THEN
    IF NEW.instructor_id IS NULL THEN
      RAISE EXCEPTION 'Students must have an instructor assigned to their booking';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;