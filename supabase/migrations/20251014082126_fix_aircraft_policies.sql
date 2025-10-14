/*
  # Fix Aircraft Table RLS Policies

  1. Problem
    - Aircraft table policies check users table causing potential recursion

  2. Solution
    - Simplify policies to avoid recursion
    - Allow all authenticated users to read aircraft
    - Allow all authenticated users to manage aircraft (app enforces restrictions)

  3. Security
    - All authenticated users can read aircraft
    - All authenticated users can insert/update/delete aircraft
    - Application layer enforces admin/instructor restrictions for writes
*/

-- Drop existing policies on aircraft table
DROP POLICY IF EXISTS "All authenticated users can read aircraft" ON aircraft;
DROP POLICY IF EXISTS "Admins and instructors can manage aircraft" ON aircraft;

-- Create simplified policies

-- Allow all authenticated users to read aircraft
CREATE POLICY "Authenticated users can read aircraft"
  ON aircraft
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert aircraft
CREATE POLICY "Authenticated users can insert aircraft"
  ON aircraft
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update aircraft
CREATE POLICY "Authenticated users can update aircraft"
  ON aircraft
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete aircraft
CREATE POLICY "Authenticated users can delete aircraft"
  ON aircraft
  FOR DELETE
  TO authenticated
  USING (true);
