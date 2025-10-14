/*
  # Fix Students Table RLS Policies

  1. Problem
    - Student table policies also had recursion issues checking users table

  2. Solution
    - Simplify policies to avoid recursion
    - Allow all authenticated users to read students
    - Restrict writes appropriately

  3. Security
    - All authenticated users can read student data
    - Users can insert/update their own student record
    - Application layer enforces admin/instructor restrictions
*/

-- Drop existing policies on students table
DROP POLICY IF EXISTS "Students can read own data" ON students;
DROP POLICY IF EXISTS "Students can update own data" ON students;
DROP POLICY IF EXISTS "Admins and instructors can read all students" ON students;
DROP POLICY IF EXISTS "Admins and instructors can manage students" ON students;
DROP POLICY IF EXISTS "Admins and instructors can insert students" ON students;
DROP POLICY IF EXISTS "Users can insert own student record" ON students;

-- Create simplified policies

-- Allow all authenticated users to read students
CREATE POLICY "Authenticated users can read students"
  ON students
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow users to insert their own student record
CREATE POLICY "Users can insert own student record"
  ON students
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Allow users to update their own student record
CREATE POLICY "Users can update own student record"
  ON students
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow deletion of own student record
CREATE POLICY "Users can delete own student record"
  ON students
  FOR DELETE
  TO authenticated
  USING (auth.uid() = id);
