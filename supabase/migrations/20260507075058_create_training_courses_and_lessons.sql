/*
  # Create training_courses and training_lessons tables

  ## Summary
  Replaces the disconnected in-memory training module system with proper
  database-backed tables that match the TrainingModule / TrainingLesson
  TypeScript types used throughout the application.

  ## New Tables

  ### training_courses
  Stores course-level metadata (replaces TrainingModule).
  - id, title, description, category, version, status (draft|published)
  - estimated_duration_hours, prerequisites[], objectives[]
  - evaluation_criteria[], tags[], last_updated
  - created_by (auth user reference), created_at

  ### training_lessons
  Stores individual lessons belonging to a course (replaces TrainingLesson).
  - id, course_id (FK → training_courses), sort_order
  - name, objective, flight_exercises (HTML), theory (HTML)
  - sequence_id, sequence_code, sequence_title
  - stage, duration_minutes, min_competency
  - key_exercises[], student_preparation, instructor_notes
  - assessment_criteria (jsonb array)
  - created_at

  ## Security
  - RLS enabled on both tables
  - Authenticated users can read all courses/lessons
  - Only admins and instructors can create/update/delete
*/

CREATE TABLE IF NOT EXISTS training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  category text NOT NULL DEFAULT 'Custom',
  version text NOT NULL DEFAULT '1.0',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  estimated_duration_hours integer NOT NULL DEFAULT 6,
  prerequisites text[] DEFAULT '{}',
  objectives text[] DEFAULT '{}',
  evaluation_criteria text[] DEFAULT '{}',
  tags text[] DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE training_courses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_courses' AND policyname='Authenticated users can read training_courses') THEN
    CREATE POLICY "Authenticated users can read training_courses"
      ON training_courses FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_courses' AND policyname='Admins and instructors can insert training_courses') THEN
    CREATE POLICY "Admins and instructors can insert training_courses"
      ON training_courses FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'instructor')
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_courses' AND policyname='Admins and instructors can update training_courses') THEN
    CREATE POLICY "Admins and instructors can update training_courses"
      ON training_courses FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'instructor')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'instructor')
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_courses' AND policyname='Admins can delete training_courses') THEN
    CREATE POLICY "Admins can delete training_courses"
      ON training_courses FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role = 'admin'
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS training_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  objective text NOT NULL DEFAULT '',
  flight_exercises text DEFAULT '',
  theory text DEFAULT '',
  sequence_id text DEFAULT '',
  sequence_code text DEFAULT '',
  sequence_title text DEFAULT '',
  stage text NOT NULL DEFAULT 'flight' CHECK (stage IN ('ground', 'flight', 'simulator')),
  duration_minutes integer NOT NULL DEFAULT 60,
  min_competency text NOT NULL DEFAULT 'Introduce' CHECK (min_competency IN ('Introduce', 'Practice', 'Assess')),
  key_exercises text[] DEFAULT '{}',
  student_preparation text DEFAULT '',
  instructor_notes text DEFAULT '',
  assessment_criteria jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE training_lessons ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_lessons' AND policyname='Authenticated users can read training_lessons') THEN
    CREATE POLICY "Authenticated users can read training_lessons"
      ON training_lessons FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_lessons' AND policyname='Admins and instructors can insert training_lessons') THEN
    CREATE POLICY "Admins and instructors can insert training_lessons"
      ON training_lessons FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'instructor')
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_lessons' AND policyname='Admins and instructors can update training_lessons') THEN
    CREATE POLICY "Admins and instructors can update training_lessons"
      ON training_lessons FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'instructor')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'instructor')
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_lessons' AND policyname='Admins can delete training_lessons') THEN
    CREATE POLICY "Admins can delete training_lessons"
      ON training_lessons FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role = 'admin'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS training_lessons_course_id_idx ON training_lessons(course_id);
CREATE INDEX IF NOT EXISTS training_lessons_sort_order_idx ON training_lessons(course_id, sort_order);
