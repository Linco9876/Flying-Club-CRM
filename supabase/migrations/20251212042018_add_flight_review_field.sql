/*
  # Add Flight Review Field

  1. Changes
    - Add `last_flight_review` date column to `students` table
    - This field tracks when the pilot's last biennial flight review (BFR) was completed
    - Flight reviews are typically required every 2 years
  
  2. Notes
    - Field is optional (nullable) as not all students may have completed a review yet
    - Frontend will show warnings when approaching 2 years from the review date
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'students' AND column_name = 'last_flight_review'
  ) THEN
    ALTER TABLE students ADD COLUMN last_flight_review date;
  END IF;
END $$;

COMMENT ON COLUMN students.last_flight_review IS 'Date of last biennial flight review (BFR)';