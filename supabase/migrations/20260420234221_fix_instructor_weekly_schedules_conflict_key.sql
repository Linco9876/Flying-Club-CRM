/*
  # Fix instructor_weekly_schedules unique constraint for upsert

  The table has instructor_id (NOT NULL) as the original column and user_id (nullable) added later.
  The upsert ON CONFLICT needs a reliable NOT NULL unique constraint.
  This migration adds a unique constraint on (instructor_id, day_of_week) to support the upsert.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'instructor_weekly_schedules'::regclass
    AND conname = 'instructor_weekly_schedules_instructor_id_day_of_week_key'
  ) THEN
    ALTER TABLE instructor_weekly_schedules
      ADD CONSTRAINT instructor_weekly_schedules_instructor_id_day_of_week_key
      UNIQUE (instructor_id, day_of_week);
  END IF;
END $$;
