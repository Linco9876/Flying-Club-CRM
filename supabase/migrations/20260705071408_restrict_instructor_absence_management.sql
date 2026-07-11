/*
  Restrict temporary instructor absences.

  - Any full portal user may read absences so calendar unavailable blocks remain visible.
  - Admins may add, update, or delete absences for any instructor.
  - Instructors and senior instructors may add, update, or delete only their own absences.
*/

ALTER TABLE public.instructor_absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and instructors can insert instructor_absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Admins and instructors can update instructor_absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Admins and instructors can delete instructor_absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Authenticated users can insert instructor_absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Authenticated users can update instructor_absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Authenticated users can delete instructor_absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Admins can manage all absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Instructors can manage own absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "All authenticated users can view absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Full portal users can read instructor absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Admins can insert any instructor absence" ON public.instructor_absences;
DROP POLICY IF EXISTS "Instructors can insert own instructor absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Admins can update any instructor absence" ON public.instructor_absences;
DROP POLICY IF EXISTS "Instructors can update own instructor absences" ON public.instructor_absences;
DROP POLICY IF EXISTS "Admins can delete any instructor absence" ON public.instructor_absences;
DROP POLICY IF EXISTS "Instructors can delete own instructor absences" ON public.instructor_absences;

CREATE POLICY "Full portal users can read instructor absences"
  ON public.instructor_absences
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_full_portal_access());

CREATE POLICY "Admins can insert any instructor absence"
  ON public.instructor_absences
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_is_admin());

CREATE POLICY "Instructors can insert own instructor absences"
  ON public.instructor_absences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    COALESCE(user_id, instructor_id) = (SELECT auth.uid())
    AND public.current_user_has_staff_role()
  );

CREATE POLICY "Admins can update any instructor absence"
  ON public.instructor_absences
  FOR UPDATE
  TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

CREATE POLICY "Instructors can update own instructor absences"
  ON public.instructor_absences
  FOR UPDATE
  TO authenticated
  USING (
    COALESCE(user_id, instructor_id) = (SELECT auth.uid())
    AND public.current_user_has_staff_role()
  )
  WITH CHECK (
    COALESCE(user_id, instructor_id) = (SELECT auth.uid())
    AND public.current_user_has_staff_role()
  );

CREATE POLICY "Admins can delete any instructor absence"
  ON public.instructor_absences
  FOR DELETE
  TO authenticated
  USING (public.current_user_is_admin());

CREATE POLICY "Instructors can delete own instructor absences"
  ON public.instructor_absences
  FOR DELETE
  TO authenticated
  USING (
    COALESCE(user_id, instructor_id) = (SELECT auth.uid())
    AND public.current_user_has_staff_role()
  );
