-- Trial voucher accounts are booking-only accounts. They are stored as
-- student users so the booking row can link to them, but they should not be
-- able to read normal training matrix assessment evidence through the Data API.

DROP POLICY IF EXISTS "Students and staff can read matrix assessments"
  ON public.student_matrix_assessments;

DROP POLICY IF EXISTS "Full students and staff can read matrix assessments"
  ON public.student_matrix_assessments;

CREATE POLICY "Full students and staff can read matrix assessments"
  ON public.student_matrix_assessments
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND (student_id = auth.uid() OR instructor_id = auth.uid())
    )
  );
