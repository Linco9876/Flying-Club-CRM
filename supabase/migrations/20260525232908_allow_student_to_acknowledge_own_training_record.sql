/*
  # Allow students to acknowledge their own training records

  ## Problem
  Students could not update training_records at all, so the acknowledgement button
  would silently fail (RLS violation) when a student tried to sign off a lesson.

  ## Change
  Add a restricted UPDATE policy allowing a student to set only the acknowledgement
  fields (student_ack, student_ack_name, student_ack_timestamp, status) on records
  where they are the student and the record is in 'submitted' state.
*/

CREATE POLICY "Students can acknowledge own submitted training records"
  ON training_records FOR UPDATE
  TO authenticated
  USING (
    student_id = auth.uid()
    AND status = 'submitted'
  )
  WITH CHECK (
    student_id = auth.uid()
  );
