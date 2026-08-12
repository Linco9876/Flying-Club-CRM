-- The private instructor-compliance bucket remained present in production, but
-- its object policies were absent. This caused renewal evidence uploads to fail
-- before the protected instructor review record could be saved.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'instructor-compliance-forms',
  'instructor-compliance-forms',
  false,
  26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "CFIs can read instructor compliance forms" ON storage.objects;
CREATE POLICY "CFIs can read instructor compliance forms"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'instructor-compliance-forms'
  AND public.current_user_is_cfi()
);

DROP POLICY IF EXISTS "Instructors can read own compliance forms" ON storage.objects;
CREATE POLICY "Instructors can read own compliance forms"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'instructor-compliance-forms'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1
    FROM public.instructor_compliance_records record
    WHERE record.candidate_instructor_id = (SELECT auth.uid())
      AND record.raaus_form_path = storage.objects.name
      AND record.voided_at IS NULL
  )
);

DROP POLICY IF EXISTS "CFIs can upload instructor compliance forms" ON storage.objects;
CREATE POLICY "CFIs can upload instructor compliance forms"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'instructor-compliance-forms'
  AND public.current_user_is_cfi()
  AND EXISTS (
    SELECT 1
    FROM public.user_roles candidate_role
    WHERE candidate_role.user_id::text = (storage.foldername(name))[1]
      AND candidate_role.role IN ('instructor', 'senior_instructor')
  )
);

DROP POLICY IF EXISTS "CFIs can update instructor compliance forms" ON storage.objects;
CREATE POLICY "CFIs can update instructor compliance forms"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'instructor-compliance-forms'
  AND public.current_user_is_cfi()
)
WITH CHECK (
  bucket_id = 'instructor-compliance-forms'
  AND public.current_user_is_cfi()
  AND EXISTS (
    SELECT 1
    FROM public.user_roles candidate_role
    WHERE candidate_role.user_id::text = (storage.foldername(name))[1]
      AND candidate_role.role IN ('instructor', 'senior_instructor')
  )
);

DROP POLICY IF EXISTS "CFIs can delete instructor compliance forms" ON storage.objects;
CREATE POLICY "CFIs can delete instructor compliance forms"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'instructor-compliance-forms'
  AND public.current_user_is_cfi()
);

DO $$
DECLARE
  v_policy_count integer;
BEGIN
  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'CFIs can read instructor compliance forms',
      'Instructors can read own compliance forms',
      'CFIs can upload instructor compliance forms',
      'CFIs can update instructor compliance forms',
      'CFIs can delete instructor compliance forms'
    );

  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION 'Expected five instructor compliance storage policies, found %', v_policy_count;
  END IF;
END;
$$;
