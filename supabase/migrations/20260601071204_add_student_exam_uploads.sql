/*
  Add optional file uploads for logged student exam results.

  Exam evidence is stored in a private bucket. Staff can upload exam files for
  any student. Students/pilots can read files attached to their own exam
  records, matching the student_exam_results RLS model.
*/

ALTER TABLE public.student_exam_results
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_type text,
  ADD COLUMN IF NOT EXISTS file_size bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_path text UNIQUE;

INSERT INTO storage.buckets (id, name, public)
VALUES ('student-exam-uploads', 'student-exam-uploads', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Students and staff can read student exam files" ON storage.objects;
CREATE POLICY "Students and staff can read student exam files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'student-exam-uploads'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_roles.user_id = (SELECT auth.uid())
          AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
      )
    )
  );

DROP POLICY IF EXISTS "Staff can upload student exam files" ON storage.objects;
CREATE POLICY "Staff can upload student exam files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'student-exam-uploads'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
        AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

DROP POLICY IF EXISTS "Staff can update student exam files" ON storage.objects;
CREATE POLICY "Staff can update student exam files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'student-exam-uploads'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
        AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  )
  WITH CHECK (
    bucket_id = 'student-exam-uploads'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
        AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

DROP POLICY IF EXISTS "Staff can delete student exam files" ON storage.objects;
CREATE POLICY "Staff can delete student exam files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'student-exam-uploads'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
        AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );
