/*
  # Allow Self Student Insert

  1. Changes
    - Add policy to allow users to insert their own student record
    - This completes the signup flow

  2. Security
    - Users can only insert a student record with their own auth.uid()
    - Admins and instructors can still create student records for others
*/

-- Allow users to insert their own student record
CREATE POLICY "Users can insert own student record"
  ON students
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );
