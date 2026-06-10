/*
  # Add Settings Tables

  1. New Tables
    - `organisation_settings`
      - `id` (uuid, primary key)
      - `club_name` (text)
      - `address` (text)
      - `timezone` (text)
      - `currency` (text)
      - `contact_email` (text)
      - `contact_phone` (text)
      - `website` (text)
      - `student_portal_url` (text)
      - `booking_day_start` (time)
      - `booking_day_end` (time)
      - `default_slot_length` (integer)
      - `logo_url` (text, optional)
      - `updated_at` (timestamptz)
      - `updated_by` (uuid, references users)
    
    - `calendar_settings`
      - `id` (uuid, primary key)
      - `default_view` (text)
      - `show_current_time_indicator` (boolean)
      - `snap_duration` (integer)
      - `double_height_slots` (boolean)
      - `resource_display_order` (text)
      - `conflict_rules` (text)
      - `week_starts_on` (text)
      - `updated_at` (timestamptz)
      - `updated_by` (uuid, references users)
    
    - `booking_rules_settings`
      - `id` (uuid, primary key)
      - `min_booking_notice_hours` (integer)
      - `max_booking_advance_days` (integer)
      - `allow_double_booking` (boolean)
      - `require_instructor_approval` (boolean)
      - `cancellation_notice_hours` (integer)
      - `updated_at` (timestamptz)
      - `updated_by` (uuid, references users)
    
    - `notification_settings`
      - `id` (uuid, primary key)
      - `booking_confirmation_enabled` (boolean)
      - `booking_reminder_24h_enabled` (boolean)
      - `booking_reminder_2h_enabled` (boolean)
      - `cancellation_notification_enabled` (boolean)
      - `maintenance_alert_enabled` (boolean)
      - `currency_expiry_alert_days` (integer)
      - `updated_at` (timestamptz)
      - `updated_by` (uuid, references users)
    
    - `user_preferences`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, unique)
      - `email_notifications` (boolean)
      - `sms_notifications` (boolean)
      - `booking_reminders` (boolean)
      - `currency_alerts` (boolean)
      - `maintenance_alerts` (boolean)
      - `timezone` (text)
      - `date_format` (text)
      - `time_format` (text)
      - `default_calendar_view` (text)
      - `theme` (text)
      - `show_progress_dashboard` (boolean)
      - `show_upcoming_bookings` (boolean)
      - `show_recent_activity` (boolean)
      - `compact_view` (boolean)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all settings tables
    - Add policies for admins to read/write organisation, calendar, booking rules, and notification settings
    - Add policies for all authenticated users to read organisation settings (for basic info like club name)
    - Add policies for users to read/write their own user preferences
*/

CREATE TABLE IF NOT EXISTS organisation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_name text NOT NULL DEFAULT 'AeroClub Pro',
  address text DEFAULT '',
  timezone text NOT NULL DEFAULT 'Australia/Melbourne',
  currency text NOT NULL DEFAULT 'AUD',
  contact_email text DEFAULT '',
  contact_phone text DEFAULT '',
  website text DEFAULT '',
  student_portal_url text DEFAULT '',
  booking_day_start time NOT NULL DEFAULT '06:00',
  booking_day_end time NOT NULL DEFAULT '22:00',
  default_slot_length integer NOT NULL DEFAULT 30,
  logo_url text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS calendar_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  default_view text NOT NULL DEFAULT 'day',
  show_current_time_indicator boolean NOT NULL DEFAULT true,
  snap_duration integer NOT NULL DEFAULT 15,
  double_height_slots boolean NOT NULL DEFAULT false,
  resource_display_order text NOT NULL DEFAULT 'aircraft-first',
  conflict_rules text NOT NULL DEFAULT 'hard-block',
  week_starts_on text NOT NULL DEFAULT 'monday',
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS booking_rules_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_booking_notice_hours integer NOT NULL DEFAULT 2,
  max_booking_advance_days integer NOT NULL DEFAULT 30,
  allow_double_booking boolean NOT NULL DEFAULT false,
  require_instructor_approval boolean NOT NULL DEFAULT false,
  cancellation_notice_hours integer NOT NULL DEFAULT 24,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_confirmation_enabled boolean NOT NULL DEFAULT true,
  booking_reminder_24h_enabled boolean NOT NULL DEFAULT true,
  booking_reminder_2h_enabled boolean NOT NULL DEFAULT true,
  cancellation_notification_enabled boolean NOT NULL DEFAULT true,
  maintenance_alert_enabled boolean NOT NULL DEFAULT true,
  currency_expiry_alert_days integer NOT NULL DEFAULT 30,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email_notifications boolean NOT NULL DEFAULT true,
  sms_notifications boolean NOT NULL DEFAULT false,
  booking_reminders boolean NOT NULL DEFAULT true,
  currency_alerts boolean NOT NULL DEFAULT true,
  maintenance_alerts boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Australia/Melbourne',
  date_format text NOT NULL DEFAULT 'dd/MM/yyyy',
  time_format text NOT NULL DEFAULT '24h',
  default_calendar_view text NOT NULL DEFAULT 'day',
  theme text NOT NULL DEFAULT 'light',
  show_progress_dashboard boolean NOT NULL DEFAULT true,
  show_upcoming_bookings boolean NOT NULL DEFAULT true,
  show_recent_activity boolean NOT NULL DEFAULT true,
  compact_view boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE organisation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_rules_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Organisation Settings Policies
CREATE POLICY "Admins can read organisation settings"
  ON organisation_settings FOR SELECT
  TO authenticated
  USING (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can update organisation settings"
  ON organisation_settings FOR UPDATE
  TO authenticated
  USING (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can insert organisation settings"
  ON organisation_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "All authenticated users can read basic organisation info"
  ON organisation_settings FOR SELECT
  TO authenticated
  USING (true);

-- Calendar Settings Policies
CREATE POLICY "Admins can read calendar settings"
  ON calendar_settings FOR SELECT
  TO authenticated
  USING (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can update calendar settings"
  ON calendar_settings FOR UPDATE
  TO authenticated
  USING (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can insert calendar settings"
  ON calendar_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- Booking Rules Settings Policies
CREATE POLICY "Admins can read booking rules settings"
  ON booking_rules_settings FOR SELECT
  TO authenticated
  USING (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can update booking rules settings"
  ON booking_rules_settings FOR UPDATE
  TO authenticated
  USING (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can insert booking rules settings"
  ON booking_rules_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- Notification Settings Policies
CREATE POLICY "Admins can read notification settings"
  ON notification_settings FOR SELECT
  TO authenticated
  USING (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can update notification settings"
  ON notification_settings FOR UPDATE
  TO authenticated
  USING (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can insert notification settings"
  ON notification_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT (raw_app_meta_data->>'roles')::jsonb ? 'admin' FROM auth.users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- User Preferences Policies
CREATE POLICY "Users can read own preferences"
  ON user_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON user_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Insert default settings if they don't exist
INSERT INTO organisation_settings (id) 
SELECT gen_random_uuid() 
WHERE NOT EXISTS (SELECT 1 FROM organisation_settings LIMIT 1);

INSERT INTO calendar_settings (id) 
SELECT gen_random_uuid() 
WHERE NOT EXISTS (SELECT 1 FROM calendar_settings LIMIT 1);

INSERT INTO booking_rules_settings (id) 
SELECT gen_random_uuid() 
WHERE NOT EXISTS (SELECT 1 FROM booking_rules_settings LIMIT 1);

INSERT INTO notification_settings (id) 
SELECT gen_random_uuid() 
WHERE NOT EXISTS (SELECT 1 FROM notification_settings LIMIT 1);