/*
  # Add split shift support to weekly schedules

  1. Changes
    - Add `afternoon_start_time` column (time without time zone, nullable) to support split shifts
    - Add `afternoon_end_time` column (time without time zone, nullable) to support split shifts
    - When both afternoon times are NULL, there's only one continuous work period
    - When both are set, there are two work periods (e.g., 9-11am, then 12-5pm with lunch break in between)

  2. Notes
    - Existing schedules will have NULL afternoon times, meaning single continuous periods
    - The lunch break is implicit - it's the gap between end_time and afternoon_start_time
    - Both afternoon times must be set together or both NULL
*/

-- Add afternoon time columns to instructor_weekly_schedules
ALTER TABLE instructor_weekly_schedules
ADD COLUMN IF NOT EXISTS afternoon_start_time TIME,
ADD COLUMN IF NOT EXISTS afternoon_end_time TIME;
