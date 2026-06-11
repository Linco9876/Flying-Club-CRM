-- Finish restricting trial-flight voucher accounts from normal CRM data.
-- Voucher accounts exist as student/member rows so they can hold a booking, but
-- they should not be able to browse training, billing, logbook, safety/document,
-- or syllabus records through the Data API.

CREATE OR REPLACE FUNCTION public.current_user_has_full_portal_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND COALESCE(portal_access_scope, 'full') <> 'trial_voucher'
      AND COALESCE(is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_staff_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY['admin','instructor','senior_instructor'])
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_has_full_portal_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_staff_role() TO authenticated;

-- Exact legacy broad policies that were missed by earlier hardening migrations.
DROP POLICY IF EXISTS "Authenticated users can read all users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can read students" ON public.students;
DROP POLICY IF EXISTS "Authenticated users can read endorsements" ON public.endorsements;
DROP POLICY IF EXISTS "Authenticated users can read training records" ON public.training_records;
DROP POLICY IF EXISTS "Authenticated users can read sequences" ON public.training_sequence_results;
DROP POLICY IF EXISTS "Authenticated users can read flight logs" ON public.flight_logs;
DROP POLICY IF EXISTS "Authenticated users can read invoices" ON public.invoices;
DROP POLICY IF EXISTS "Authenticated users can read invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Authenticated users can read student syllabi" ON public.student_syllabi;
DROP POLICY IF EXISTS "Authenticated users can read student_syllabi" ON public.student_syllabi;
DROP POLICY IF EXISTS "Authenticated users can insert student_syllabi" ON public.student_syllabi;
DROP POLICY IF EXISTS "Authenticated users can update student_syllabi" ON public.student_syllabi;
DROP POLICY IF EXISTS "Authenticated users can delete student_syllabi" ON public.student_syllabi;
DROP POLICY IF EXISTS "Authenticated users can read defects" ON public.defects;
DROP POLICY IF EXISTS "All authenticated users can read defects" ON public.defects;
DROP POLICY IF EXISTS "All authenticated users can view defects" ON public.defects;
DROP POLICY IF EXISTS "All authenticated users can create defects" ON public.defects;
DROP POLICY IF EXISTS "Authenticated users can report defects" ON public.defects;
DROP POLICY IF EXISTS "Authenticated users can read aircraft document files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read defect attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload defect attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read safety document files" ON storage.objects;

-- Replace own-record policies with voucher-aware equivalents.
DROP POLICY IF EXISTS "Students instructors and staff can read relevant training records" ON public.training_records;
DROP POLICY IF EXISTS "Students instructors and staff can read relevant training recor" ON public.training_records;
CREATE POLICY "Full students instructors and staff can read relevant training records"
  ON public.training_records
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND (student_id = auth.uid() OR instructor_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Students instructors and staff can read relevant sequence results" ON public.training_sequence_results;
DROP POLICY IF EXISTS "Students instructors and staff can read relevant sequence resul" ON public.training_sequence_results;
DROP POLICY IF EXISTS "Users can read relevant sequence results" ON public.training_sequence_results;
CREATE POLICY "Full students instructors and staff can read relevant sequence results"
  ON public.training_sequence_results
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.training_records tr
      WHERE tr.id = training_sequence_results.training_record_id
        AND (
          public.current_user_has_staff_role()
          OR (
            public.current_user_has_full_portal_access()
            AND (tr.student_id = auth.uid() OR tr.instructor_id = auth.uid())
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users and staff can read relevant flight logs" ON public.flight_logs;
DROP POLICY IF EXISTS "Users can read relevant flight logs" ON public.flight_logs;
CREATE POLICY "Full users and staff can read relevant flight logs"
  ON public.flight_logs
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND (student_id = auth.uid() OR instructor_id = auth.uid() OR created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert own flight logs" ON public.flight_logs;
CREATE POLICY "Full users can insert own flight logs"
  ON public.flight_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can read relevant endorsements" ON public.endorsements;
DROP POLICY IF EXISTS "Users can read endorsements" ON public.endorsements;
DROP POLICY IF EXISTS "Users can view own endorsements" ON public.endorsements;
DROP POLICY IF EXISTS "Students can read own endorsements" ON public.endorsements;
CREATE POLICY "Full users and staff can read relevant endorsements"
  ON public.endorsements
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can read relevant invoices" ON public.invoices;
DROP POLICY IF EXISTS "Students can read own invoices" ON public.invoices;
CREATE POLICY "Full users and admins can read relevant invoices"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can read relevant invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Users and staff can read relevant invoice items" ON public.invoice_items;
CREATE POLICY "Full users and admins can read relevant invoice items"
  ON public.invoice_items
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_items.invoice_id
          AND i.student_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Students and staff can read relevant student syllabi" ON public.student_syllabi;
CREATE POLICY "Full students and staff can read relevant student syllabi"
  ON public.student_syllabi
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Students and staff can read student documents" ON public.student_documents;
CREATE POLICY "Full students and staff can read student documents"
  ON public.student_documents
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Students and staff can create student documents" ON public.student_documents;
CREATE POLICY "Full students and staff can create student documents"
  ON public.student_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      public.current_user_has_staff_role()
      OR (
        public.current_user_has_full_portal_access()
        AND student_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Students and staff can update student documents" ON public.student_documents;
CREATE POLICY "Full students and staff can update student documents"
  ON public.student_documents
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  )
  WITH CHECK (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Students and staff can delete student documents" ON public.student_documents;
CREATE POLICY "Full students and staff can delete student documents"
  ON public.student_documents
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Students and staff can read student document files" ON storage.objects;
CREATE POLICY "Full students and staff can read student document files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'student-documents'
    AND (
      public.current_user_has_staff_role()
      OR (
        public.current_user_has_full_portal_access()
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
    )
  );

DROP POLICY IF EXISTS "Students and staff can upload student document files" ON storage.objects;
CREATE POLICY "Full students and staff can upload student document files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'student-documents'
    AND (
      public.current_user_has_staff_role()
      OR (
        public.current_user_has_full_portal_access()
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
    )
  );

DROP POLICY IF EXISTS "Students and staff can delete student document files" ON storage.objects;
CREATE POLICY "Full students and staff can delete student document files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'student-documents'
    AND (
      public.current_user_has_staff_role()
      OR (
        public.current_user_has_full_portal_access()
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
    )
  );

CREATE POLICY "Full portal users can view defects"
  ON public.defects
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_full_portal_access());

CREATE POLICY "Full portal users can create defects"
  ON public.defects
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_has_full_portal_access());

CREATE POLICY "Full portal users can read aircraft document files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'aircraft-documents'
    AND public.current_user_has_full_portal_access()
  );

CREATE POLICY "Full portal users can read defect attachments"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'defect-attachments'
    AND public.current_user_has_full_portal_access()
  );

CREATE POLICY "Full portal users can upload defect attachments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'defect-attachments'
    AND public.current_user_has_full_portal_access()
  );

CREATE POLICY "Full portal users can read safety document files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'safety-documents'
    AND public.current_user_has_full_portal_access()
  );
