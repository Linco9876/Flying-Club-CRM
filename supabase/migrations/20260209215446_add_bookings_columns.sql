/*
  # Add columns to bookings table

  ## Changes
  - Added `deleted_at` (timestamptz, nullable) - Soft delete timestamp
  - Added `flight_logged` (boolean, default false) - Whether flight has been logged
*/

-- Add soft delete and flight logged tracking to bookings
ALTER TABLE bookings 
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS flight_logged boolean DEFAULT false;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_bookings_deleted_at ON bookings(deleted_at);
CREATE INDEX IF NOT EXISTS idx_bookings_flight_logged ON bookings(flight_logged);