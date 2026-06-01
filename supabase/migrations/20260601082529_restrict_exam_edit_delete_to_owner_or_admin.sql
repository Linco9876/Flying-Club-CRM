/*
  Restrict student exam result edits/deletes to the instructor who logged the
  result or an admin.
*/

DROP POLICY IF EXISTS "Staff can update student exam results" ON public.student_exam_results;
CREATE POLICY "Owner instructor or admin can update student exam results"
  ON public.student_exam_results
  FOR UPDATE
  TO authenticated
  USING (
    instructor_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role = 'admin'
    )
  )
  WITH CHECK (
    instructor_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete student exam results" ON public.student_exam_results;
CREATE POLICY "Owner instructor or admin can delete student exam results"
  ON public.student_exam_results
  FOR DELETE
  TO authenticated
  USING (
    instructor_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Staff can update student exam files" ON storage.objects;
CREATE POLICY "Owner instructor or admin can update student exam files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'student-exam-uploads'
    AND (
      EXISTS (
        SELECT 1
        FROM public.student_exam_results
        WHERE student_exam_results.storage_path = storage.objects.name
          AND student_exam_results.instructor_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = (SELECT auth.uid())
          AND role = 'admin'
      )
    )
  )
  WITH CHECK (
    bucket_id = 'student-exam-uploads'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

DROP POLICY IF EXISTS "Staff can delete student exam files" ON storage.objects;
CREATE POLICY "Owner instructor or admin can delete student exam files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'student-exam-uploads'
    AND (
      EXISTS (
        SELECT 1
        FROM public.student_exam_results
        WHERE student_exam_results.storage_path = storage.objects.name
          AND student_exam_results.instructor_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = (SELECT auth.uid())
          AND role = 'admin'
      )
    )
  );
