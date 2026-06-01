/*
  Add private student document storage and metadata.

  Students/pilots can manage documents on their own student file.
  Instructors, senior instructors and admins can manage documents for any student.
*/

CREATE TABLE IF NOT EXISTS public.student_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  original_filename text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_documents_student_id
  ON public.student_documents(student_id);

CREATE INDEX IF NOT EXISTS idx_student_documents_uploaded_by
  ON public.student_documents(uploaded_by);

ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students and staff can read student documents" ON public.student_documents;
CREATE POLICY "Students and staff can read student documents"
  ON public.student_documents FOR SELECT TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
        AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

DROP POLICY IF EXISTS "Students and staff can create student documents" ON public.student_documents;
CREATE POLICY "Students and staff can create student documents"
  ON public.student_documents FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND (
      student_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_roles.user_id = (SELECT auth.uid())
          AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
      )
    )
  );

DROP POLICY IF EXISTS "Students and staff can update student documents" ON public.student_documents;
CREATE POLICY "Students and staff can update student documents"
  ON public.student_documents FOR UPDATE TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
        AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  )
  WITH CHECK (
    student_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
        AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

DROP POLICY IF EXISTS "Students and staff can delete student documents" ON public.student_documents;
CREATE POLICY "Students and staff can delete student documents"
  ON public.student_documents FOR DELETE TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
        AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

REVOKE ALL ON TABLE public.student_documents FROM anon;
REVOKE ALL ON TABLE public.student_documents FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_documents TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('student-documents', 'student-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Students and staff can read student document files" ON storage.objects;
CREATE POLICY "Students and staff can read student document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'student-documents'
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

DROP POLICY IF EXISTS "Students and staff can upload student document files" ON storage.objects;
CREATE POLICY "Students and staff can upload student document files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'student-documents'
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

DROP POLICY IF EXISTS "Students and staff can delete student document files" ON storage.objects;
CREATE POLICY "Students and staff can delete student document files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'student-documents'
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
