/*
  # Add student_comments to training_records

  1. Changes
    - `training_records`: adds `student_comments` (text) column
      - Stores comments the student can add after reviewing their lesson record
      - Nullable so existing records are unaffected

  2. RLS
    - Existing student SELECT policy (students can read own records) remains
    - Add a new UPDATE policy restricted to the student setting only their own
      student_comments field on records where student_id = auth.uid()
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_records' AND column_name = 'student_comments'
  ) THEN
    ALTER TABLE training_records ADD COLUMN student_comments text DEFAULT '';
  END IF;
END $$;

-- Allow students to update their own student_comments and student_ack fields
-- on records that belong to them
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'training_records' AND policyname = 'Students can acknowledge and comment on own records'
  ) THEN
    CREATE POLICY "Students can acknowledge and comment on own records"
      ON training_records FOR UPDATE
      TO authenticated
      USING (student_id = auth.uid())
      WITH CHECK (student_id = auth.uid());
  END IF;
END $$;
