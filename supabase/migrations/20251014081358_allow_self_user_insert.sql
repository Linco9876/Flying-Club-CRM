/*
  # Allow Self User Insert After Auth Signup

  1. Changes
    - Add policy to allow users to insert their own user record after auth signup
    - This allows the flow: auth.signUp() -> insert into users table with same ID

  2. Security
    - Users can only insert a record with their own auth.uid()
    - Admins and instructors can still create users for others
*/

-- Drop existing insert policy if it exists and recreate with better logic
DROP POLICY IF EXISTS "Admins and instructors can create users" ON users;

-- Allow users to insert their own record (for signup flow)
CREATE POLICY "Users can insert own record"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );
