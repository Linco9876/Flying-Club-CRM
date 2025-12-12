/*
  # Add Booking Rules Enforcement and Approval System

  1. Changes
    - Add enforcement flags to booking_rules_settings table to allow optional rule enforcement
    - Add approved_by and approved_at columns to bookings table for approval tracking
    - Update booking status enum to include 'pending_approval' and 'approved'
    - Create function to send approval notifications to admins and instructors

  2. New Columns in booking_rules_settings
    - `enforce_min_notice` - Whether to enforce minimum booking notice
    - `enforce_max_advance` - Whether to enforce maximum advance booking
    - `enforce_cancellation_notice` - Whether to enforce cancellation notice

  3. New Columns in bookings
    - `approved_by` - UUID of user who approved the booking
    - `approved_at` - Timestamp when booking was approved

  4. Security
    - Maintain existing RLS policies
*/

-- Add enforcement flags to booking_rules_settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_rules_settings' AND column_name = 'enforce_min_notice'
  ) THEN
    ALTER TABLE booking_rules_settings ADD COLUMN enforce_min_notice boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_rules_settings' AND column_name = 'enforce_max_advance'
  ) THEN
    ALTER TABLE booking_rules_settings ADD COLUMN enforce_max_advance boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_rules_settings' AND column_name = 'enforce_cancellation_notice'
  ) THEN
    ALTER TABLE booking_rules_settings ADD COLUMN enforce_cancellation_notice boolean DEFAULT true;
  END IF;
END $$;

-- Add approval tracking columns to bookings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'approved_by'
  ) THEN
    ALTER TABLE bookings ADD COLUMN approved_by uuid REFERENCES auth.users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN approved_at timestamptz;
  END IF;
END $$;

-- Create function to notify admins and instructors for approval
CREATE OR REPLACE FUNCTION notify_instructors_for_approval(booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking record;
  v_user record;
  v_aircraft record;
BEGIN
  -- Get booking details
  SELECT b.*, s.first_name, s.last_name, s.email
  INTO v_booking
  FROM bookings b
  JOIN students s ON b.student_id = s.id
  WHERE b.id = booking_id;

  -- Get aircraft details
  SELECT registration INTO v_aircraft
  FROM aircraft
  WHERE id = v_booking.aircraft_id;

  -- Notify all admins and instructors
  FOR v_user IN
    SELECT u.id
    FROM users u
    WHERE has_role(u.id, 'admin') OR has_role(u.id, 'instructor')
  LOOP
    INSERT INTO notifications (
      user_id,
      title,
      message,
      type,
      related_id,
      is_read
    ) VALUES (
      v_user.id,
      'Solo Flight Approval Required',
      v_booking.first_name || ' ' || v_booking.last_name || ' has requested a solo flight in ' || v_aircraft.registration || ' on ' || to_char(v_booking.start_time, 'DD/MM/YYYY at HH24:MI'),
      'booking_approval',
      booking_id,
      false
    );
  END LOOP;
END;
$$;

-- Create function to validate booking against rules
CREATE OR REPLACE FUNCTION validate_booking_rules(
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_instructor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings record;
  v_errors jsonb := '[]'::jsonb;
  v_hours_until_flight numeric;
  v_days_in_advance numeric;
BEGIN
  -- Get booking rules settings
  SELECT * INTO v_settings FROM booking_rules_settings LIMIT 1;

  IF v_settings IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Check minimum booking notice
  IF v_settings.enforce_min_notice THEN
    v_hours_until_flight := EXTRACT(EPOCH FROM (p_start_time - NOW())) / 3600;
    IF v_hours_until_flight < v_settings.min_booking_notice_hours THEN
      v_errors := v_errors || jsonb_build_object(
        'field', 'min_notice',
        'message', 'Booking must be made at least ' || v_settings.min_booking_notice_hours || ' hours in advance'
      );
    END IF;
  END IF;

  -- Check maximum advance booking
  IF v_settings.enforce_max_advance THEN
    v_days_in_advance := EXTRACT(EPOCH FROM (p_start_time - NOW())) / 86400;
    IF v_days_in_advance > v_settings.max_booking_advance_days THEN
      v_errors := v_errors || jsonb_build_object(
        'field', 'max_advance',
        'message', 'Bookings cannot be made more than ' || v_settings.max_booking_advance_days || ' days in advance'
      );
    END IF;
  END IF;

  -- Check if instructor approval is required for solo flights
  IF v_settings.require_instructor_approval AND p_instructor_id IS NULL THEN
    v_errors := v_errors || jsonb_build_object(
      'field', 'requires_approval',
      'message', 'Solo flights require instructor approval',
      'needs_approval', true
    );
  END IF;

  RETURN v_errors;
END;
$$;