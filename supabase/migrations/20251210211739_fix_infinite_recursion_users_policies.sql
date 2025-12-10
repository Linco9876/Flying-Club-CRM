/*
  # Fix infinite recursion in users table policies

  1. Changes
    - Drop the recursive policies that query the users table
    - Add new policies using JWT metadata to check role
    - Use auth.jwt() to access user role from metadata
    
  2. Security
    - Admins and instructors can view all users
    - Students can only view their own data
    - No recursive queries that cause infinite loops
*/

-- Drop the problematic policies
DROP POLICY IF EXISTS "Admins can read all users" ON users;
DROP POLICY IF EXISTS "Instructors can read all users" ON users;

-- Add new policies using JWT metadata
CREATE POLICY "Admins can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->>'role')::text = 'admin'
  );

CREATE POLICY "Instructors can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->>'role')::text = 'instructor'
  );
