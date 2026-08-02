-- Allow administrators and the original program creator to delete an online
-- program, while retaining the existing staff create/edit permissions.
-- Dependent sections, steps, enrolments, progress and lesson links already use
-- ON DELETE CASCADE foreign keys.

DROP POLICY IF EXISTS "Staff manage learning programs" ON public.learning_programs;

DROP POLICY IF EXISTS "Staff can create learning programs" ON public.learning_programs;
CREATE POLICY "Staff can create learning programs"
  ON public.learning_programs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Staff can update learning programs" ON public.learning_programs;
CREATE POLICY "Staff can update learning programs"
  ON public.learning_programs
  FOR UPDATE
  TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Admins and creators can delete learning programs" ON public.learning_programs;
CREATE POLICY "Admins and creators can delete learning programs"
  ON public.learning_programs
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_is_admin()
    OR created_by = (SELECT auth.uid())
  );
