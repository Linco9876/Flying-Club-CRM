/*
  # Add DELETE policy for defects table

  1. Changes
    - Adds DELETE policy for defects table to allow admins and instructors to delete defect reports
  
  2. Security
    - Only users with 'admin' or 'instructor' roles can delete defects
    - Uses the existing has_role() function for consistency
*/

-- Add DELETE policy for defects
CREATE POLICY "Admins and instructors can delete defects"
  ON defects
  FOR DELETE
  TO authenticated
  USING (has_role('admin') OR has_role('instructor') OR has_role('senior_instructor'));