/*
  # Add resource visibility and custom ordering to calendar settings

  1. Changes to `calendar_settings`
     - `hidden_resources` (jsonb, default '[]') — array of resource IDs the user has hidden
     - `resource_order` (jsonb, default '[]') — ordered array of {id, type} objects representing
       the user's desired display order for resources on the calendar

  These are stored per-row (each org has one row) and read/written by the frontend without any
  special security considerations beyond the existing RLS on calendar_settings.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_settings' AND column_name = 'hidden_resources'
  ) THEN
    ALTER TABLE calendar_settings ADD COLUMN hidden_resources jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_settings' AND column_name = 'resource_order'
  ) THEN
    ALTER TABLE calendar_settings ADD COLUMN resource_order jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;
