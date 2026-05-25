/*
  # Add course-level assessment criteria and created_by to training_courses

  ## Summary
  1. Adds `created_by` (uuid → auth.users) to training_courses so we can
     enforce admin-or-creator-only edit/delete.
  2. Adds `assessment_criteria` (jsonb) to training_courses to store the
     shared criteria definitions that apply to every lesson in the course.
     Each lesson then stores a `pass_marks` jsonb map (criterionId → passingGrade)
     rather than duplicating the full criterion definition.

  ## Changes
  - training_courses: add created_by, assessment_criteria columns
  - training_lessons: add pass_marks column (criterionId → passingGrade map)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_courses' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE training_courses ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_courses' AND column_name = 'assessment_criteria'
  ) THEN
    ALTER TABLE training_courses ADD COLUMN assessment_criteria jsonb NOT NULL DEFAULT '[]';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_lessons' AND column_name = 'pass_marks'
  ) THEN
    ALTER TABLE training_lessons ADD COLUMN pass_marks jsonb NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- Allow creators to delete their own courses (supplement the admin-only policy)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'training_courses'
    AND policyname = 'Creators can delete own training_courses'
  ) THEN
    CREATE POLICY "Creators can delete own training_courses"
      ON training_courses FOR DELETE TO authenticated
      USING (created_by = auth.uid());
  END IF;
END $$;
