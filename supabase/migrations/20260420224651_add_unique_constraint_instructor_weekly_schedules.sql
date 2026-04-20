/*
  # Add unique constraint to instructor_weekly_schedules

  The upsert operation on instructor_weekly_schedules uses ON CONFLICT (user_id, day_of_week)
  but no such unique constraint exists, causing the operation to fail.
  This migration adds the required unique constraint.
*/

ALTER TABLE instructor_weekly_schedules
  ADD CONSTRAINT instructor_weekly_schedules_user_id_day_of_week_key
  UNIQUE (user_id, day_of_week);
