/*
  # Fix Endorsements Table RLS Policies

  1. Solution
    - Simplify endorsements policies to avoid recursion
    - Allow authenticated users appropriate access

  2. Security
    - All authenticated users can read endorsements
    - Users can manage their own endorsements
*/

-- Drop existing policies on endorsements table
DROP POLICY IF EXISTS "Admins and instructors can insert endorsements" ON endorsements;
DROP POLICY IF EXISTS "Users can read relevant endorsements" ON endorsements;
DROP POLICY IF EXISTS "Admins and instructors can update endorsements" ON endorsements;
DROP POLICY IF EXISTS "Admins and instructors can delete endorsements" ON endorsements;

-- Create simplified policies

-- Allow all authenticated users to read endorsements
CREATE POLICY "Authenticated users can read endorsements"
  ON endorsements
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow users to insert endorsements for themselves
CREATE POLICY "Users can insert endorsements"
  ON endorsements
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = student_id);

-- Allow users to update their own endorsements
CREATE POLICY "Users can update own endorsements"
  ON endorsements
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);

-- Allow users to delete their own endorsements
CREATE POLICY "Users can delete own endorsements"
  ON endorsements
  FOR DELETE
  TO authenticated
  USING (auth.uid() = student_id);
