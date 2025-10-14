/*
  # Fix User Insert Policies

  1. Changes
    - Add INSERT policy for admins and instructors to create user accounts
    - Add WITH CHECK clause for the students table INSERT policy
    - Add INSERT policy for endorsements table

  2. Security
    - Only admins and instructors can create new user accounts
    - Proper WITH CHECK clauses ensure data integrity during inserts
*/

-- Add INSERT policy for users table to allow admins/instructors to create users
CREATE POLICY "Admins and instructors can create users"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- Add UPDATE policy for admins/instructors to update users
CREATE POLICY "Admins and instructors can update users"
  ON users
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- Add INSERT policy for students table (WITH CHECK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'students' 
    AND policyname = 'Admins and instructors can insert students'
  ) THEN
    CREATE POLICY "Admins and instructors can insert students"
      ON students
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role IN ('admin', 'instructor')
        )
      );
  END IF;
END $$;

-- Add INSERT policy for endorsements table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'endorsements' 
    AND policyname = 'Admins and instructors can insert endorsements'
  ) THEN
    CREATE POLICY "Admins and instructors can insert endorsements"
      ON endorsements
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role IN ('admin', 'instructor')
        )
      );
  END IF;
END $$;

-- Add SELECT policy for endorsements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'endorsements' 
    AND policyname = 'Users can read relevant endorsements'
  ) THEN
    CREATE POLICY "Users can read relevant endorsements"
      ON endorsements
      FOR SELECT
      TO authenticated
      USING (
        student_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role IN ('admin', 'instructor')
        )
      );
  END IF;
END $$;

-- Add UPDATE policy for endorsements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'endorsements' 
    AND policyname = 'Admins and instructors can update endorsements'
  ) THEN
    CREATE POLICY "Admins and instructors can update endorsements"
      ON endorsements
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role IN ('admin', 'instructor')
        )
      );
  END IF;
END $$;

-- Add DELETE policy for endorsements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'endorsements' 
    AND policyname = 'Admins and instructors can delete endorsements'
  ) THEN
    CREATE POLICY "Admins and instructors can delete endorsements"
      ON endorsements
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role IN ('admin', 'instructor')
        )
      );
  END IF;
END $$;
