/*
  # Fix Bookings Insert Policy

  1. Changes
    - Drop the existing bookings insert policy that may have recursion issues
    - Create a new simplified insert policy for bookings
    - Allow students to create bookings for themselves
    - Allow admins and instructors to create bookings for anyone

  2. Security
    - Students can only create bookings where they are the student
    - Admins and instructors can create bookings for any student
    - All policies check authentication
*/

-- Drop existing insert policy
DROP POLICY IF EXISTS "Students can create own bookings" ON bookings;

-- Create new insert policy for students
CREATE POLICY "Students can insert own bookings"
  ON bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (student_id = auth.uid());

-- Create insert policy for admins and instructors
CREATE POLICY "Admins and instructors can insert any booking"
  ON bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'instructor')
    )
  );
