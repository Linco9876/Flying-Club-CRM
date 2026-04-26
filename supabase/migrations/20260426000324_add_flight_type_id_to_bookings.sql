/*
  # Add flight_type_id to bookings

  Stores the flight type chosen when making a booking so it can be
  pre-filled in the Log Flight form.

  1. Changes
    - Add nullable `flight_type_id` (uuid FK → flight_types) to `bookings`
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'flight_type_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN flight_type_id uuid REFERENCES flight_types(id) ON DELETE SET NULL;
  END IF;
END $$;
