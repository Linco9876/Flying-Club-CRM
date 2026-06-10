/*
  # Make endorsements instructor field optional

  1. Changes
    - Make instructor_id nullable in endorsements table
    - This allows endorsements to be tracked without requiring an instructor assignment
  
  2. Notes
    - Existing endorsements with instructor_id will remain unchanged
    - New endorsements can be created without an instructor
*/

ALTER TABLE endorsements
ALTER COLUMN instructor_id DROP NOT NULL;
