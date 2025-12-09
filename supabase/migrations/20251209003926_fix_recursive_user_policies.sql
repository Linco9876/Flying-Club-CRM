/*
  # Fix Recursive RLS Policies on Users Table

  1. Problem
    - Current policies for admins/instructors query the users table recursively
    - This causes queries to hang when trying to read user data
    - Example: "Admins can read all users" checks if user is admin by reading from users table

  2. Solution
    - Drop all existing policies on users table
    - Create simple, non-recursive policies
    - Use auth.uid() directly without subqueries to users table
    - Store role in auth metadata or accept that role-based checks happen in application layer

  3. Changes
    - Allow users to read their own data (no recursion)
    - Allow users to update their own data (no recursion)
    - Allow users to insert their own record on signup
    - Remove recursive admin/instructor policies that cause deadlocks
*/

-- Drop all existing policies on users table
DROP POLICY IF EXISTS "Users can read own data" ON users;
DROP POLICY IF EXISTS "Users can update own data" ON users;
DROP POLICY IF EXISTS "Users can insert own record" ON users;
DROP POLICY IF EXISTS "Admins can read all users" ON users;
DROP POLICY IF EXISTS "Admins and instructors can update users" ON users;
DROP POLICY IF EXISTS "Instructors can read students" ON users;

-- Create simple, non-recursive policies
CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own record"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- For now, we'll handle admin/instructor permissions in the application layer
-- This avoids recursive policy checks that cause deadlocks