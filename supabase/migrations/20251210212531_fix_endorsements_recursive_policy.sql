/*
  # Fix endorsements table recursive policy

  1. Changes
    - Drop the policy that has recursive subquery to users table
    - Add new policy using get_user_role() helper function
    
  2. Security
    - Students can view their own endorsements
    - Instructors can view endorsements they issued
    - Admins and instructors can view all endorsements
*/

DROP POLICY IF EXISTS "Users can read endorsements" ON endorsements;

CREATE POLICY "Users can read endorsements"
  ON endorsements
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid() 
    OR instructor_id = auth.uid() 
    OR get_user_role() = 'admin'
    OR get_user_role() = 'instructor'
  );
