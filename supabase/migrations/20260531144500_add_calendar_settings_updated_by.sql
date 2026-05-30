/*
  Add the calendar settings audit column for databases created from the older
  Bolt JSON settings table.
*/

ALTER TABLE calendar_settings
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

NOTIFY pgrst, 'reload schema';
