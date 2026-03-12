/*
  # Fix instructor_schedule_changes column names

  ## Summary
  The instructor_schedule_changes table was created with different column names than
  what the application expects. This migration adds the missing columns and also
  fixes the instructor_weekly_schedules table to ensure user_id column exists.

  ## Changes
  - instructor_schedule_changes: add user_id (alias for instructor_id data)
  - instructor_schedule_changes: add effective_from (alias for change_date data)
  - instructor_schedule_changes: add day_of_week if missing
  - instructor_schedule_changes: add afternoon_start_time, afternoon_end_time if missing
  - instructor_weekly_schedules: ensure user_id column exists
*/

-- Add user_id to instructor_schedule_changes (copy from instructor_id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_schedule_changes' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.instructor_schedule_changes ADD COLUMN user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;
    UPDATE public.instructor_schedule_changes SET user_id = instructor_id WHERE user_id IS NULL;
  END IF;
END $$;

-- Add effective_from to instructor_schedule_changes (copy from change_date)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_schedule_changes' AND column_name = 'effective_from'
  ) THEN
    ALTER TABLE public.instructor_schedule_changes ADD COLUMN effective_from date;
    UPDATE public.instructor_schedule_changes SET effective_from = change_date WHERE effective_from IS NULL;
  END IF;
END $$;

-- Add day_of_week if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_schedule_changes' AND column_name = 'day_of_week'
  ) THEN
    ALTER TABLE public.instructor_schedule_changes ADD COLUMN day_of_week integer DEFAULT 0;
  END IF;
END $$;

-- Add afternoon time columns if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_schedule_changes' AND column_name = 'afternoon_start_time'
  ) THEN
    ALTER TABLE public.instructor_schedule_changes ADD COLUMN afternoon_start_time time;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_schedule_changes' AND column_name = 'afternoon_end_time'
  ) THEN
    ALTER TABLE public.instructor_schedule_changes ADD COLUMN afternoon_end_time time;
  END IF;
END $$;

-- Add updated_at if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_schedule_changes' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.instructor_schedule_changes ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Fix instructor_weekly_schedules: ensure user_id exists (may be named instructor_id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_weekly_schedules' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.instructor_weekly_schedules ADD COLUMN user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;
    UPDATE public.instructor_weekly_schedules SET user_id = instructor_id WHERE user_id IS NULL;
  END IF;
END $$;

-- Fix instructor_weekly_schedules: add afternoon columns if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_weekly_schedules' AND column_name = 'afternoon_start_time'
  ) THEN
    ALTER TABLE public.instructor_weekly_schedules ADD COLUMN afternoon_start_time time;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_weekly_schedules' AND column_name = 'afternoon_end_time'
  ) THEN
    ALTER TABLE public.instructor_weekly_schedules ADD COLUMN afternoon_end_time time;
  END IF;
END $$;

-- Fix instructor_absences: ensure user_id exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_absences' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.instructor_absences ADD COLUMN user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;
    UPDATE public.instructor_absences SET user_id = instructor_id WHERE user_id IS NULL;
  END IF;
END $$;

-- Fix instructor_absences: add time columns if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_absences' AND column_name = 'start_time'
  ) THEN
    ALTER TABLE public.instructor_absences ADD COLUMN start_time time;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_absences' AND column_name = 'end_time'
  ) THEN
    ALTER TABLE public.instructor_absences ADD COLUMN end_time time;
  END IF;
END $$;
