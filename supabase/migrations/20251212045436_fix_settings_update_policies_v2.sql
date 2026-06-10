/*
  # Fix Settings Update Policies v2

  1. Changes
    - Drop existing update/insert policies that query the users table
    - Create new policies using has_role('admin') function
    - This avoids circular permission checks and uses JWT metadata directly

  2. Security
    - Only admins can update/insert settings
    - All authenticated users can read settings
    - No circular dependencies with users table
*/

-- Calendar Settings
DROP POLICY IF EXISTS "Admins can update calendar settings" ON calendar_settings;
DROP POLICY IF EXISTS "Admins can insert calendar settings" ON calendar_settings;

CREATE POLICY "Admins can update calendar settings"
  ON calendar_settings FOR UPDATE
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can insert calendar settings"
  ON calendar_settings FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin'));

-- Organisation Settings
DROP POLICY IF EXISTS "Admins can update organisation settings" ON organisation_settings;
DROP POLICY IF EXISTS "Admins can insert organisation settings" ON organisation_settings;

CREATE POLICY "Admins can update organisation settings"
  ON organisation_settings FOR UPDATE
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can insert organisation settings"
  ON organisation_settings FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin'));

-- Booking Rules Settings
DROP POLICY IF EXISTS "Admins can update booking rules settings" ON booking_rules_settings;
DROP POLICY IF EXISTS "Admins can insert booking rules settings" ON booking_rules_settings;

CREATE POLICY "Admins can update booking rules settings"
  ON booking_rules_settings FOR UPDATE
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can insert booking rules settings"
  ON booking_rules_settings FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin'));

-- Notification Settings
DROP POLICY IF EXISTS "Admins can update notification settings" ON notification_settings;
DROP POLICY IF EXISTS "Admins can insert notification settings" ON notification_settings;

CREATE POLICY "Admins can update notification settings"
  ON notification_settings FOR UPDATE
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can insert notification settings"
  ON notification_settings FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin'));
