/*
  # Fix Aircraft RLS Policies

  1. Changes
    - Simplify aircraft RLS policies to allow all authenticated users to insert/update
    - Remove the dependency on users table role check which requires Supabase Auth
    - This allows the application to work with both mock auth and real Supabase auth

  2. Security Notes
    - All authenticated users can manage aircraft
    - In production, you may want to restore role-based restrictions
*/

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admins and instructors can manage aircraft" ON aircraft;
DROP POLICY IF EXISTS "Authenticated users can insert aircraft" ON aircraft;
DROP POLICY IF EXISTS "Authenticated users can update aircraft" ON aircraft;
DROP POLICY IF EXISTS "Authenticated users can delete aircraft" ON aircraft;

-- Create simplified policies that work with any authenticated user
CREATE POLICY "Authenticated users can insert aircraft"
  ON aircraft
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update aircraft"
  ON aircraft
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete aircraft"
  ON aircraft
  FOR DELETE
  TO authenticated
  USING (true);
