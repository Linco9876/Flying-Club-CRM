/*
  # Add fix notes field to defects table

  1. Changes
    - Adds `fix_notes` column to `defects` table for storing fix descriptions when status is "fixed"
  
  2. Notes
    - This field is optional and typically used when marking a defect as fixed
    - Stores the description of what was done to fix the defect
*/

-- Add fix_notes column to defects table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'defects' AND column_name = 'fix_notes'
  ) THEN
    ALTER TABLE defects ADD COLUMN fix_notes text;
  END IF;
END $$;