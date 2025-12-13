/*
  # Rename pilot_id to student_id in bookings table

  1. Changes
    - Rename the `pilot_id` column to `student_id` in the `bookings` table
    - This aligns the database schema with the application code which uses `studentId`
  
  2. Notes
    - All existing data is preserved
    - Foreign key constraints are maintained
    - Indexes are automatically updated
*/

ALTER TABLE bookings 
RENAME COLUMN pilot_id TO student_id;
