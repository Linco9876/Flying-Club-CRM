/*
  Add authenticated club safety documents and a private storage bucket.
*/

CREATE TABLE IF NOT EXISTS public.safety_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  category text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.safety_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read safety documents"
  ON public.safety_documents FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Staff can create safety documents"
  ON public.safety_documents FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

CREATE POLICY "Staff can update safety documents"
  ON public.safety_documents FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

CREATE POLICY "Staff can delete safety documents"
  ON public.safety_documents FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

REVOKE ALL ON TABLE public.safety_documents FROM anon;
REVOKE ALL ON TABLE public.safety_documents FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.safety_documents TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('safety-documents', 'safety-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY "Authenticated users can read safety document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'safety-documents');

CREATE POLICY "Staff can upload safety document files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'safety-documents'
    AND (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (SELECT auth.uid())
          AND role IN ('admin', 'instructor', 'senior_instructor')
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = (SELECT auth.uid())
          AND role IN ('admin', 'instructor', 'senior_instructor')
      )
    )
  );

CREATE POLICY "Staff can delete safety document files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'safety-documents'
    AND (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (SELECT auth.uid())
          AND role IN ('admin', 'instructor', 'senior_instructor')
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = (SELECT auth.uid())
          AND role IN ('admin', 'instructor', 'senior_instructor')
      )
    )
  );
