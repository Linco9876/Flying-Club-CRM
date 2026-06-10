/*
  # Add logbook columns to flight_logs table

  ## Summary
  Extends the flight_logs table to support a proper pilot logbook with all required fields.
  Also aligns the table with the columns expected by the useFlightLogs hook.

  ## Changes to flight_logs
  - `aircraft_id` (uuid, nullable FK to aircraft) - which aircraft was flown
  - `student_id` (uuid, nullable FK to users) - the student/pilot
  - `instructor_id` (uuid, nullable FK to users) - the instructor if dual flight
  - `start_time` (timestamptz) - flight start datetime
  - `end_time` (timestamptz) - flight end datetime
  - `start_tach` (numeric) - alias-compatible, already exists as tach_start but adding start_tach
  - `end_tach` (numeric) - alias-compatible, already exists as tach_end but adding end_tach
  - `flight_duration` (numeric) - calculated flight hours
  - `dual_time` (numeric) - hours flown with instructor
  - `solo_time` (numeric) - hours flown without instructor
  - `takeoffs` (integer) - number of takeoffs
  - `comments` (text) - pilot/instructor comments for logbook
  - `payment_type` (text) - payment method
  - `observations` (text) - operational observations
  - `oil_added` (numeric)
  - `fuel_added` (numeric)
  - `passengers` (integer)
  - `created_by` (uuid, nullable FK to users)

  ## Notes
  - All new columns are nullable to avoid breaking existing rows
  - tach_start/tach_end existing columns kept for backwards compatibility
  - RLS already enabled on this table
*/

ALTER TABLE flight_logs
  ADD COLUMN IF NOT EXISTS aircraft_id uuid REFERENCES aircraft(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS instructor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_time timestamptz,
  ADD COLUMN IF NOT EXISTS end_time timestamptz,
  ADD COLUMN IF NOT EXISTS start_tach numeric,
  ADD COLUMN IF NOT EXISTS end_tach numeric,
  ADD COLUMN IF NOT EXISTS flight_duration numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dual_time numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS solo_time numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS takeoffs integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments text,
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS observations text,
  ADD COLUMN IF NOT EXISTS oil_added numeric,
  ADD COLUMN IF NOT EXISTS fuel_added numeric,
  ADD COLUMN IF NOT EXISTS passengers integer,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Indexes for logbook queries
CREATE INDEX IF NOT EXISTS idx_flight_logs_student_id ON flight_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_flight_logs_instructor_id ON flight_logs(instructor_id);
CREATE INDEX IF NOT EXISTS idx_flight_logs_aircraft_id ON flight_logs(aircraft_id);
CREATE INDEX IF NOT EXISTS idx_flight_logs_start_time ON flight_logs(start_time);
CREATE INDEX IF NOT EXISTS idx_flight_logs_booking_id ON flight_logs(booking_id);
