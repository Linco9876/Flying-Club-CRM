/*
  # Add Outstanding Training Records System

  ## Summary
  Extends the training system so that when a flight log is created with an instructor,
  an "outstanding record" is generated. The instructor can then dismiss it (no record needed)
  or fill out a full training record linked to a specific course and lesson.

  ## Changes

  ### Modified Tables

  #### `training_records`
  - `course_id` (uuid, nullable) — links record to a training course
  - `lesson_id` (uuid, nullable) — links record to a specific lesson within the course
  - `briefing_comments` (text) — notes from the formal briefing
  - `criteria_grades` (jsonb) — map of { criterionId: grade } for course-level assessment criteria

  #### `flight_logs`
  - `training_record_status` (text) — tracks whether instructor has acted: 'pending' | 'dismissed' | 'recorded'

  ### Security
  - RLS policies allow instructors to update the new columns on their own training records
  - Instructors can update `training_record_status` on flight logs where they are the instructor
*/

-- Add new columns to training_records
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_records' AND column_name = 'course_id'
  ) THEN
    ALTER TABLE training_records ADD COLUMN course_id uuid REFERENCES training_courses(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_records' AND column_name = 'lesson_id'
  ) THEN
    ALTER TABLE training_records ADD COLUMN lesson_id uuid REFERENCES training_lessons(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_records' AND column_name = 'briefing_comments'
  ) THEN
    ALTER TABLE training_records ADD COLUMN briefing_comments text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_records' AND column_name = 'criteria_grades'
  ) THEN
    ALTER TABLE training_records ADD COLUMN criteria_grades jsonb NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- Add training_record_status to flight_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'flight_logs' AND column_name = 'training_record_status'
  ) THEN
    ALTER TABLE flight_logs ADD COLUMN training_record_status text NOT NULL DEFAULT 'pending'
      CHECK (training_record_status IN ('pending', 'dismissed', 'recorded'));
  END IF;
END $$;

-- RLS: allow instructors to update training_record_status on their own flight logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'flight_logs' AND policyname = 'Instructors can update training_record_status on own logs'
  ) THEN
    CREATE POLICY "Instructors can update training_record_status on own logs"
      ON flight_logs FOR UPDATE
      TO authenticated
      USING (instructor_id = auth.uid())
      WITH CHECK (instructor_id = auth.uid());
  END IF;
END $$;
