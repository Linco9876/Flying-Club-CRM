/*
  # Add missing columns to safety_report_categories

  1. Changes
    - Add `display_order` (integer) column to safety_report_categories
    - Add `default_assignee` (text) column to safety_report_categories

  2. Notes
    - These columns are referenced in the useSafetySettings hook but were missing from the table
    - display_order defaults to 0 for existing rows
    - default_assignee defaults to empty string
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'safety_report_categories' AND column_name = 'display_order'
  ) THEN
    ALTER TABLE safety_report_categories ADD COLUMN display_order integer DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'safety_report_categories' AND column_name = 'default_assignee'
  ) THEN
    ALTER TABLE safety_report_categories ADD COLUMN default_assignee text DEFAULT '';
  END IF;
END $$;
