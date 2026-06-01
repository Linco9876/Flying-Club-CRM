/*
  # Add flight reviews and course exams

  - Add course-level exam requirements stored with training_courses.
  - Add flight review outcome fields to training_records.
  - Add student_exam_results for profile-based exam logging.
  - Promote a user to pilot automatically after a passed flight review/test.
*/

ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS exam_requirements jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.training_records
  ADD COLUMN IF NOT EXISTS is_flight_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flight_review_type text,
  ADD COLUMN IF NOT EXISTS flight_review_result text,
  ADD COLUMN IF NOT EXISTS flight_review_notes text,
  ADD COLUMN IF NOT EXISTS pilot_role_granted boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'training_records_flight_review_result_check'
  ) THEN
    ALTER TABLE public.training_records
      ADD CONSTRAINT training_records_flight_review_result_check
      CHECK (
        flight_review_result IS NULL
        OR flight_review_result IN ('pass', 'fail', 'not_assessed')
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.student_exam_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.training_courses(id) ON DELETE SET NULL,
  exam_id text NOT NULL,
  exam_name text NOT NULL,
  score numeric(6,2) NOT NULL DEFAULT 0,
  pass_mark numeric(6,2) NOT NULL DEFAULT 0,
  result text NOT NULL DEFAULT 'fail' CHECK (result IN ('pass', 'fail')),
  exam_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text NOT NULL DEFAULT '',
  instructor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.student_exam_results ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS student_exam_results_student_idx
  ON public.student_exam_results(student_id, exam_date DESC);

CREATE INDEX IF NOT EXISTS student_exam_results_course_idx
  ON public.student_exam_results(course_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'student_exam_results'
      AND policyname = 'Authenticated users can read relevant student exam results'
  ) THEN
    CREATE POLICY "Authenticated users can read relevant student exam results"
      ON public.student_exam_results
      FOR SELECT
      TO authenticated
      USING (
        student_id = auth.uid()
        OR instructor_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
          AND role IN ('admin', 'instructor', 'senior_instructor')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'student_exam_results'
      AND policyname = 'Staff can insert student exam results'
  ) THEN
    CREATE POLICY "Staff can insert student exam results"
      ON public.student_exam_results
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
          AND role IN ('admin', 'instructor', 'senior_instructor')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'student_exam_results'
      AND policyname = 'Staff can update student exam results'
  ) THEN
    CREATE POLICY "Staff can update student exam results"
      ON public.student_exam_results
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
          AND role IN ('admin', 'instructor', 'senior_instructor')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
          AND role IN ('admin', 'instructor', 'senior_instructor')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'student_exam_results'
      AND policyname = 'Admins can delete student exam results'
  ) THEN
    CREATE POLICY "Admins can delete student exam results"
      ON public.student_exam_results
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
          AND role = 'admin'
        )
      );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_exam_results TO authenticated;
GRANT SELECT ON public.student_exam_results TO anon;

CREATE OR REPLACE FUNCTION public.promote_pilot_after_passed_flight_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_flight_review IS TRUE
     AND NEW.flight_review_result = 'pass'
     AND COALESCE(NEW.pilot_role_granted, false) IS FALSE THEN
    UPDATE public.students
    SET last_flight_review = COALESCE(NEW.date, CURRENT_DATE)
    WHERE id = NEW.student_id;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.student_id, 'pilot')
    ON CONFLICT (user_id, role) DO NOTHING;

    UPDATE public.users
    SET role = 'pilot'
    WHERE id = NEW.student_id
      AND role = 'student';

    NEW.pilot_role_granted := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promote_pilot_after_passed_flight_review_trigger
  ON public.training_records;

CREATE TRIGGER promote_pilot_after_passed_flight_review_trigger
  BEFORE INSERT OR UPDATE OF is_flight_review, flight_review_result, student_id, date
  ON public.training_records
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_pilot_after_passed_flight_review();
