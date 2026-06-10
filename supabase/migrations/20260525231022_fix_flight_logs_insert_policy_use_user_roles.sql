/*
  # Fix flight_logs INSERT policy and sync users.role from user_roles

  ## Problems
  1. The INSERT policy on flight_logs checks users.role (a denormalized column) instead of
     the authoritative user_roles table. This causes "RLS violation" for any user whose
     users.role column is out of sync with their actual user_roles entries.
  2. The users.role column can drift out of sync with user_roles.

  ## Changes
  - Drop and recreate the flight_logs INSERT policy to use user_roles table
  - Drop and recreate the flight_logs UPDATE policy (by role check) to use user_roles table
  - Sync users.role for all users whose primary role differs from user_roles
*/

-- Fix INSERT policy: check user_roles table instead of users.role
DROP POLICY IF EXISTS "Admins and instructors can insert flight logs" ON flight_logs;

CREATE POLICY "Admins and instructors can insert flight logs"
  ON flight_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

-- Fix UPDATE policy: check user_roles table instead of users.role
DROP POLICY IF EXISTS "Admins and instructors can update flight logs" ON flight_logs;

CREATE POLICY "Admins and instructors can update flight logs"
  ON flight_logs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

-- Fix DELETE policy: check user_roles table instead of users.role
DROP POLICY IF EXISTS "Admins can delete flight logs" ON flight_logs;

CREATE POLICY "Admins can delete flight logs"
  ON flight_logs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Sync users.role for all users: set it to the highest-priority role from user_roles
UPDATE users
SET role = (
  CASE
    WHEN EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'admin') THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'senior_instructor') THEN 'senior_instructor'
    WHEN EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'instructor') THEN 'instructor'
    WHEN EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'pilot') THEN 'pilot'
    ELSE 'student'
  END
)
WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id);
