/*
  # Rebuild organisation_settings with proper flat columns

  The original table only had a JSONB `settings` column which doesn't match
  the application's expected schema. This migration:

  1. Drops the old table and recreates it with explicit columns for every field
     the application reads and writes.
  2. Inserts a default row so there is always exactly one record.
  3. Adds logo_url for the business logo (stored in Supabase Storage).
  4. Re-enables RLS with admin-only write, authenticated read.
*/

DROP TABLE IF EXISTS organisation_settings;

CREATE TABLE organisation_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_name       text NOT NULL DEFAULT 'My Flying Club',
  address         text NOT NULL DEFAULT '',
  timezone        text NOT NULL DEFAULT 'Australia/Melbourne',
  currency        text NOT NULL DEFAULT 'AUD',
  contact_email   text NOT NULL DEFAULT '',
  contact_phone   text NOT NULL DEFAULT '',
  website         text NOT NULL DEFAULT '',
  student_portal_url text NOT NULL DEFAULT '',
  booking_day_start  text NOT NULL DEFAULT '06:00',
  booking_day_end    text NOT NULL DEFAULT '22:00',
  default_slot_length integer NOT NULL DEFAULT 30,
  logo_url        text,
  updated_at      timestamptz DEFAULT now(),
  updated_by      uuid REFERENCES auth.users(id)
);

-- Seed the single default row
INSERT INTO organisation_settings (
  club_name, address, timezone, currency,
  contact_email, contact_phone, website, student_portal_url,
  booking_day_start, booking_day_end, default_slot_length
) VALUES (
  'My Flying Club', '', 'Australia/Melbourne', 'AUD',
  '', '', '', '',
  '06:00', '22:00', 30
);

ALTER TABLE organisation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read organisation settings"
  ON organisation_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can update organisation settings"
  ON organisation_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );
