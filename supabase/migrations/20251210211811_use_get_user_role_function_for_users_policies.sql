/*
  # Use get_user_role() function for users table policies

  1. Changes
    - Drop JWT-based policies that don't work properly
    - Add new policies using the get_user_role() helper function
    - This function bypasses RLS to check roles without recursion
    
  2. Security
    - Admins and instructors can view all users
    - Students can only view their own data
    - No recursive queries or JWT dependency issues
*/

-- Drop the JWT-based policies
DROP POLICY IF EXISTS "Admins can read all users" ON users;
DROP POLICY IF EXISTS "Instructors can read all users" ON users;

-- Add new policies using the helper function
CREATE POLICY "Admins can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin');

CREATE POLICY "Instructors can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (get_user_role() = 'instructor');
