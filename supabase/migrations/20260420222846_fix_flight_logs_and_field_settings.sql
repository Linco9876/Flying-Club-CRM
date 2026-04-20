/*
  # Fix flight_logs and flight_log_field_settings

  1. flight_logs
     - Add DEFAULT 0 to `duration` and `total_cost` columns to prevent NOT NULL failures

  2. flight_log_field_settings
     - Add missing columns: field_name, is_enabled, is_mandatory, display_order
     - Remove old JSON blob `settings` column
     - Seed default rows for each optional field
*/

-- Fix duration/total_cost defaults
ALTER TABLE flight_logs ALTER COLUMN duration SET DEFAULT 0;
ALTER TABLE flight_logs ALTER COLUMN total_cost SET DEFAULT 0;

-- Reshape flight_log_field_settings
ALTER TABLE flight_log_field_settings
  ADD COLUMN IF NOT EXISTS field_name text,
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

ALTER TABLE flight_log_field_settings DROP COLUMN IF EXISTS settings;

-- Seed default rows
INSERT INTO flight_log_field_settings (field_name, is_enabled, is_mandatory, display_order)
SELECT * FROM (VALUES
  ('landings',     true,  false, 1),
  ('payment_type', true,  false, 2),
  ('observations', false, false, 3),
  ('oil_added',    false, false, 4),
  ('fuel_added',   false, false, 5),
  ('passengers',   false, false, 6)
) AS v(field_name, is_enabled, is_mandatory, display_order)
WHERE NOT EXISTS (SELECT 1 FROM flight_log_field_settings LIMIT 1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flight_log_field_settings_field_name_key'
  ) THEN
    ALTER TABLE flight_log_field_settings ADD CONSTRAINT flight_log_field_settings_field_name_key UNIQUE (field_name);
  END IF;
END $$;
