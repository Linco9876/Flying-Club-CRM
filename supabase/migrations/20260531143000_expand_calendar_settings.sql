/*
  # Expand calendar settings

  Adds practical display defaults used directly by the calendar.
*/

ALTER TABLE calendar_settings
  ADD COLUMN IF NOT EXISTS default_view text NOT NULL DEFAULT 'day',
  ADD COLUMN IF NOT EXISTS show_current_time_indicator boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS snap_duration integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS double_height_slots boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resource_display_order text NOT NULL DEFAULT 'aircraft-first',
  ADD COLUMN IF NOT EXISTS conflict_rules text NOT NULL DEFAULT 'waitlist',
  ADD COLUMN IF NOT EXISTS week_starts_on text NOT NULL DEFAULT 'monday',
  ADD COLUMN IF NOT EXISTS show_weekends boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS highlight_unlogged_bookings boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

INSERT INTO calendar_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM calendar_settings);

UPDATE calendar_settings
SET conflict_rules = 'waitlist'
WHERE conflict_rules <> 'waitlist';
