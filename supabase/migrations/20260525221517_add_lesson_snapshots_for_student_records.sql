/*
  # Add lesson_snapshots table

  ## Summary
  When a student completes a lesson (via a training record), a snapshot of the
  lesson data is stored here. This means deleting or editing a lesson in the
  course catalog never erases a student's historical completion record — the
  snapshot they were assessed against is preserved permanently.

  ## New Table: lesson_snapshots
  - id: primary key
  - lesson_id: original lesson id (nullable, set to NULL on lesson delete via ON DELETE SET NULL)
  - course_id: original course id (nullable, same behaviour)
  - lesson_code: the CUST-xx or sequence code at time of completion
  - lesson_name: lesson name at time of snapshot
  - objective: lesson objective at time of snapshot
  - flight_exercises: HTML content at time of snapshot
  - theory: HTML content at time of snapshot
  - assessment_criteria: jsonb array at time of snapshot
  - snapshotted_at: when the snapshot was taken

  ## Security
  - RLS enabled
  - Authenticated users can read snapshots
  - Only admins/instructors can insert snapshots
*/

CREATE TABLE IF NOT EXISTS lesson_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid REFERENCES training_lessons(id) ON DELETE SET NULL,
  course_id uuid REFERENCES training_courses(id) ON DELETE SET NULL,
  lesson_code text NOT NULL DEFAULT '',
  lesson_name text NOT NULL DEFAULT '',
  objective text NOT NULL DEFAULT '',
  flight_exercises text NOT NULL DEFAULT '',
  theory text NOT NULL DEFAULT '',
  assessment_criteria jsonb NOT NULL DEFAULT '[]',
  snapshotted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lesson_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lesson_snapshots' AND policyname='Authenticated users can read lesson_snapshots') THEN
    CREATE POLICY "Authenticated users can read lesson_snapshots"
      ON lesson_snapshots FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lesson_snapshots' AND policyname='Admins and instructors can insert lesson_snapshots') THEN
    CREATE POLICY "Admins and instructors can insert lesson_snapshots"
      ON lesson_snapshots FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'instructor')
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lesson_snapshots' AND policyname='Admins and instructors can update lesson_snapshots') THEN
    CREATE POLICY "Admins and instructors can update lesson_snapshots"
      ON lesson_snapshots FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'instructor'))
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'instructor'))
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lesson_snapshots_lesson_id_idx ON lesson_snapshots(lesson_id);
CREATE INDEX IF NOT EXISTS lesson_snapshots_course_id_idx ON lesson_snapshots(course_id);
