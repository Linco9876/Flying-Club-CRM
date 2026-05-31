/*
  # Add aircraft-focused flight log fields

  Adds optional aircraft operational fields and exposes them through the Flight
  Log Form settings page.
*/

ALTER TABLE flight_logs
  ADD COLUMN IF NOT EXISTS hobbs_start numeric,
  ADD COLUMN IF NOT EXISTS hobbs_end numeric,
  ADD COLUMN IF NOT EXISTS fuel_start numeric,
  ADD COLUMN IF NOT EXISTS fuel_end numeric,
  ADD COLUMN IF NOT EXISTS oil_start numeric,
  ADD COLUMN IF NOT EXISTS oil_end numeric,
  ADD COLUMN IF NOT EXISTS fuel_type text,
  ADD COLUMN IF NOT EXISTS aircraft_condition text,
  ADD COLUMN IF NOT EXISTS maintenance_notes text;

INSERT INTO flight_log_field_settings (field_name, is_enabled, is_mandatory, display_order)
VALUES
  ('hobbs_start', false, false, 12),
  ('hobbs_end', false, false, 13),
  ('fuel_start', false, false, 14),
  ('fuel_end', false, false, 15),
  ('oil_added', false, false, 16),
  ('oil_start', false, false, 17),
  ('oil_end', false, false, 18),
  ('fuel_added', false, false, 19),
  ('fuel_type', false, false, 20),
  ('aircraft_condition', false, false, 21),
  ('maintenance_notes', false, false, 22)
ON CONFLICT (field_name) DO UPDATE SET
  display_order = EXCLUDED.display_order,
  updated_at = now();
