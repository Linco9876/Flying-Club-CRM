/*
  # Add Additional Student Fields

  1. Changes
    - Add `occupation` field to students table for storing student occupation
    - Add `alternate_phone` field to students table for alternate contact number
    - Rename `licence_expiry` to better reflect it's a membership expiry (conceptually same field)

  2. Notes
    - These fields are optional (nullable) to maintain compatibility with existing records
    - No data migration needed as these are new optional fields
*/

-- Add occupation field to students table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'students' AND column_name = 'occupation'
  ) THEN
    ALTER TABLE students ADD COLUMN occupation text;
  END IF;
END $$;

-- Add alternate_phone field to students table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'students' AND column_name = 'alternate_phone'
  ) THEN
    ALTER TABLE students ADD COLUMN alternate_phone text;
  END IF;
END $$;

-- Add comment to clarify that licence_expiry is for membership expiry
COMMENT ON COLUMN students.licence_expiry IS 'Membership expiry date (e.g., RAAus membership)';
