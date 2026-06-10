/*
  # Add split shift support to schedule changes

  1. Changes
    - Add `afternoon_start_time` column (time without time zone, nullable) to support split shifts
    - Add `afternoon_end_time` column (time without time zone, nullable) to support split shifts
    - This mirrors the changes made to instructor_weekly_schedules

  2. Notes
    - Keeps schedule changes consistent with weekly schedules
    - Allows future schedule changes to include lunch breaks
*/

-- Add afternoon time columns to instructor_schedule_changes
ALTER TABLE instructor_schedule_changes
ADD COLUMN IF NOT EXISTS afternoon_start_time TIME,
ADD COLUMN IF NOT EXISTS afternoon_end_time TIME;
