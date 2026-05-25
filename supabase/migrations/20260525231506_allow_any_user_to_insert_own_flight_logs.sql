/*
  # Allow any authenticated user to log their own flights

  ## Change
  Replace the restrictive flight_logs INSERT policy (admin/instructor only) with one
  that allows any authenticated user to insert a log where they are the student,
  while still allowing admins and instructors to insert logs for anyone.
*/

DROP POLICY IF EXISTS "Admins and instructors can insert flight logs" ON flight_logs;

CREATE POLICY "Users can insert own flight logs"
  ON flight_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Anyone can log a flight where they are the student
    student_id = auth.uid()
    OR
    -- Admins and instructors can log flights for anyone
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );
