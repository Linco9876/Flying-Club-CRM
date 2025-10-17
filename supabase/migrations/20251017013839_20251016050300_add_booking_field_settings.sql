/*
  # Add Booking Field Configuration Settings

  1. New Tables
    - `booking_field_settings` - Configuration for booking form field requirements
      - `id` (uuid, primary key)
      - `field_name` (text) - Name of the booking form field
      - `is_required` (boolean) - Whether the field is mandatory
      - `is_visible` (boolean) - Whether the field is visible in the form
      - `applies_to_roles` (text[]) - Which roles this setting applies to
      - `display_order` (integer) - Order of field display in form
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `booking_field_settings` table
    - All authenticated users can read settings
    - Only admins can modify settings

  3. Features
    - Configurable booking form fields
    - Role-based field requirements
    - Flexible field visibility and ordering
*/

-- Create booking field settings table
CREATE TABLE IF NOT EXISTS booking_field_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  field_name text UNIQUE NOT NULL,
  label text NOT NULL,
  is_required boolean DEFAULT false,
  is_visible boolean DEFAULT true,
  applies_to_roles text[] DEFAULT ARRAY['admin', 'instructor', 'student']::text[],
  display_order integer NOT NULL,
  help_text text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE booking_field_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "All authenticated users can read booking field settings"
  ON booking_field_settings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage booking field settings"
  ON booking_field_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Insert default booking field settings
INSERT INTO booking_field_settings (field_name, label, is_required, is_visible, display_order, help_text) VALUES
  ('pilot', 'Pilot', true, true, 1, 'Select the pilot for this booking'),
  ('startDate', 'Start Date', true, true, 2, 'Date when the booking begins'),
  ('startTime', 'Start Time', true, true, 3, 'Time when the booking begins'),
  ('endDate', 'End Date', true, true, 4, 'Date when the booking ends'),
  ('endTime', 'End Time', true, true, 5, 'Time when the booking ends'),
  ('aircraft', 'Aircraft', true, true, 6, 'Select the aircraft for this booking'),
  ('instructor', 'Instructor', false, true, 7, 'Optional: Select an instructor for dual instruction'),
  ('paymentType', 'Payment Type', true, true, 8, 'How this booking will be paid for'),
  ('notes', 'Notes', false, true, 9, 'Additional information about the booking')
ON CONFLICT (field_name) DO NOTHING;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_booking_field_settings_order ON booking_field_settings(display_order);
