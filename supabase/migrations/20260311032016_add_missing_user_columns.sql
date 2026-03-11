/*
  # Add missing columns to users table

  ## Summary
  Adds the is_senior_instructor column to users table which is referenced
  by the application but was missing from the schema.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_senior_instructor'
  ) THEN
    ALTER TABLE users ADD COLUMN is_senior_instructor boolean DEFAULT false;
  END IF;
END $$;
