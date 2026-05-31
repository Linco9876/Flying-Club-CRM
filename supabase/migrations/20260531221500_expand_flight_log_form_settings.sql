/*
  # Expand flight log form settings

  Adds the core and optional fields used by the improved Flight Log Form settings
  screen. Existing rows are preserved; missing rows are inserted.
*/

ALTER TABLE flight_log_field_settings
  ADD COLUMN IF NOT EXISTS field_name text,
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flight_log_field_settings_field_name_key'
  ) THEN
    ALTER TABLE flight_log_field_settings
      ADD CONSTRAINT flight_log_field_settings_field_name_key UNIQUE (field_name);
  END IF;
END $$;

INSERT INTO flight_log_field_settings (field_name, is_enabled, is_mandatory, display_order)
VALUES
  ('start_time', true, true, 1),
  ('end_time', true, true, 2),
  ('start_tach', true, true, 3),
  ('end_tach', true, true, 4),
  ('flight_duration', true, true, 5),
  ('flight_type', true, true, 6),
  ('payment_type', true, true, 7),
  ('takeoffs_landings', true, false, 8),
  ('comments', true, false, 9),
  ('observations', false, false, 10),
  ('passengers', false, false, 11),
  ('oil_added', false, false, 12),
  ('fuel_added', false, false, 13)
ON CONFLICT (field_name) DO UPDATE SET
  display_order = EXCLUDED.display_order,
  updated_at = now();

UPDATE flight_log_field_settings
SET is_enabled = true,
    is_mandatory = true,
    updated_at = now()
WHERE field_name IN ('start_time', 'end_time', 'start_tach', 'end_tach', 'flight_duration', 'flight_type');
