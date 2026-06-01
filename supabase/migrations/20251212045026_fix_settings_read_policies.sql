/*
  # Fix Settings Read Policies

  1. Changes
    - Drop existing restrictive policies
    - Add new policies allowing all authenticated users to read settings
    - Keep write policies restricted to admins only
    - Ensure default settings rows exist

  2. Security
    - All authenticated users can read organization, calendar, booking rules, and notification settings
    - Only admins can update these settings
    - Users can read/write their own preferences
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can read organisation settings" ON organisation_settings;
DROP POLICY IF EXISTS "Admins can read calendar settings" ON calendar_settings;
DROP POLICY IF EXISTS "Admins can read booking rules settings" ON booking_rules_settings;
DROP POLICY IF EXISTS "Admins can read notification settings" ON notification_settings;

-- Organisation Settings - Allow all authenticated users to read
CREATE POLICY "Authenticated users can read organisation settings"
  ON organisation_settings FOR SELECT
  TO authenticated
  USING (true);

-- Calendar Settings - Allow all authenticated users to read
CREATE POLICY "Authenticated users can read calendar settings"
  ON calendar_settings FOR SELECT
  TO authenticated
  USING (true);

-- Booking Rules Settings - Allow all authenticated users to read
CREATE POLICY "Authenticated users can read booking rules settings"
  ON booking_rules_settings FOR SELECT
  TO authenticated
  USING (true);

-- Notification Settings - Allow all authenticated users to read
CREATE POLICY "Authenticated users can read notification settings"
  ON notification_settings FOR SELECT
  TO authenticated
  USING (true);

-- Ensure default settings exist (using DO block to handle duplicates)
DO $$
BEGIN
  -- Insert default organisation settings if none exist
  IF NOT EXISTS (SELECT 1 FROM organisation_settings LIMIT 1) THEN
    INSERT INTO organisation_settings (
      club_name,
      address,
      timezone,
      currency,
      contact_email,
      contact_phone,
      website,
      student_portal_url,
      booking_day_start,
      booking_day_end,
      default_slot_length
    ) VALUES (
      'Bendigo Flying Club',
      '123 Aviation Way, Airfield VIC 3000',
      'Australia/Melbourne',
      'AUD',
      'admin@flyingclub.com',
      '+61 3 9876 5432',
      'https://flyingclub.com',
      'https://portal.flyingclub.com',
      '06:00',
      '22:00',
      30
    );
  END IF;

  -- Insert default calendar settings if none exist
  IF NOT EXISTS (SELECT 1 FROM calendar_settings LIMIT 1) THEN
    INSERT INTO calendar_settings (
      default_view,
      show_current_time_indicator,
      snap_duration,
      double_height_slots,
      resource_display_order,
      conflict_rules,
      week_starts_on
    ) VALUES (
      'day',
      true,
      15,
      false,
      'aircraft-first',
      'hard-block',
      'monday'
    );
  END IF;

  -- Insert default booking rules settings if none exist
  IF NOT EXISTS (SELECT 1 FROM booking_rules_settings LIMIT 1) THEN
    INSERT INTO booking_rules_settings (
      min_booking_notice_hours,
      max_booking_advance_days,
      allow_double_booking,
      require_instructor_approval,
      cancellation_notice_hours
    ) VALUES (
      2,
      30,
      false,
      false,
      24
    );
  END IF;

  -- Insert default notification settings if none exist
  IF NOT EXISTS (SELECT 1 FROM notification_settings LIMIT 1) THEN
    INSERT INTO notification_settings (
      booking_confirmation_enabled,
      booking_reminder_24h_enabled,
      booking_reminder_2h_enabled,
      cancellation_notification_enabled,
      maintenance_alert_enabled,
      currency_expiry_alert_days
    ) VALUES (
      true,
      true,
      true,
      true,
      true,
      30
    );
  END IF;
END $$;
