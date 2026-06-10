/*
  # Add time range support to instructor absences

  1. Changes
    - Add `start_time` column (time without time zone, nullable) to allow partial-day absences
    - Add `end_time` column (time without time zone, nullable) to allow partial-day absences
    - When both start_time and end_time are NULL, the absence applies to the entire day
    - When both are set, the absence applies only to that specific time range on each day

  2. Notes
    - Existing absences will have NULL times, meaning they remain full-day absences
    - The application will interpret NULL times as full-day unavailability (6:00 - 20:00)
    - Non-NULL times will restrict unavailability to the specified hours
*/

-- Add time range columns to instructor_absences
ALTER TABLE instructor_absences
ADD COLUMN IF NOT EXISTS start_time TIME,
ADD COLUMN IF NOT EXISTS end_time TIME;
