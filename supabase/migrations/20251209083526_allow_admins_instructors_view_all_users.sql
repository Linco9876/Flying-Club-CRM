/*
  # Allow admins and instructors to view all users

  1. Changes
    - Add policy to allow admins to view all users
    - Add policy to allow instructors to view all users
    
  2. Security
    - Students can still only see their own data
    - Admins and instructors can see all user records
*/

CREATE POLICY "Admins can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Instructors can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'instructor'
    )
  );
