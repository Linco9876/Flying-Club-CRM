/*
  # Restrict training_records INSERT to the instructor on the linked flight log

  ## Problem
  Any instructor/admin can insert a training record for any flight log, even if they
  were not the instructor on that flight.

  ## Change
  Replace the generic instructor INSERT policy with one that verifies the inserting user
  is either:
    - The instructor listed on the linked flight log (flight_log_id), OR
    - An admin
*/

DROP POLICY IF EXISTS "Admins and instructors can insert training records" ON training_records;

CREATE POLICY "Flight instructor or admin can insert training records"
  ON training_records FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Admins can always insert
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
    OR
    -- The inserting user must be the instructor on the linked flight log
    (
      flight_log_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM flight_logs
        WHERE flight_logs.id = flight_log_id
        AND flight_logs.instructor_id = auth.uid()
      )
    )
    OR
    -- Allow if no flight_log_id (manually added records) and user is an instructor
    (
      flight_log_id IS NULL
      AND EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('instructor', 'senior_instructor', 'admin')
      )
    )
  );
