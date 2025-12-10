/*
  # Fix infinite recursion and add invitations policies

  1. Changes
    - Remove recursive query from get_user_role function
    - Add proper RLS policies for invitations table
    - Ensure function only reads from JWT to avoid recursion
    
  2. Security
    - Admins and instructors can manage invitations
    - Users can view invitations they sent
*/

-- Fix get_user_role to NOT query users table (prevents recursion)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Only read from JWT, no table queries to prevent recursion
  RETURN COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role'),
    'student'
  );
END;
$$;

-- Add RLS policies for invitations table
CREATE POLICY "Admins can manage invitations"
  ON invitations FOR ALL
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

CREATE POLICY "Instructors can manage invitations"
  ON invitations FOR ALL
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'instructor'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'instructor'
  );

CREATE POLICY "Users can view own sent invitations"
  ON invitations FOR SELECT
  TO authenticated
  USING (invited_by = auth.uid());
