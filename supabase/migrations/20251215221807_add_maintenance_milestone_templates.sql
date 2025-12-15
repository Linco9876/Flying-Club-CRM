/*
  # Add Maintenance Milestone Templates Table

  ## Overview
  Creates a table for storing maintenance milestone templates that can be applied to aircraft.

  ## Changes Made

  1. **New maintenance_milestone_templates table**
     - `id` (uuid, primary key)
     - `name` (text) - Name of the milestone template
     - `type` ('hours', 'calendar', 'both')
     - `interval_hours` (numeric) - Hours between maintenance
     - `interval_months` (integer) - Months between maintenance
     - `description` (text) - Description of the maintenance task
     - `is_default` (boolean) - Whether this is a default template
     - `created_at` (timestamp)
     - `updated_at` (timestamp)

  2. **New maintenance_settings table**
     - Global settings for maintenance module
     - `id` (uuid, primary key)
     - `auto_ground_on_major_defect` (boolean)
     - `require_maintenance_approval` (boolean)
     - `maintenance_reminder_days` (integer)
     - `defect_photo_required` (boolean)
     - `created_at` (timestamp)
     - `updated_at` (timestamp)

  3. **Security**
     - Enable RLS on both tables
     - Add policies for authenticated users
*/

-- Create maintenance_milestone_templates table
CREATE TABLE IF NOT EXISTS maintenance_milestone_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('hours', 'calendar', 'both')),
  interval_hours numeric DEFAULT 0,
  interval_months integer DEFAULT 0,
  description text,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE maintenance_milestone_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view maintenance milestone templates"
  ON maintenance_milestone_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert maintenance milestone templates"
  ON maintenance_milestone_templates FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update maintenance milestone templates"
  ON maintenance_milestone_templates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete maintenance milestone templates"
  ON maintenance_milestone_templates FOR DELETE
  TO authenticated
  USING (true);

-- Create maintenance_settings table
CREATE TABLE IF NOT EXISTS maintenance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_ground_on_major_defect boolean DEFAULT true,
  require_maintenance_approval boolean DEFAULT true,
  maintenance_reminder_days integer DEFAULT 14,
  defect_photo_required boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE maintenance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view maintenance settings"
  ON maintenance_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert maintenance settings"
  ON maintenance_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update maintenance settings"
  ON maintenance_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert default milestone templates
INSERT INTO maintenance_milestone_templates (name, type, interval_hours, interval_months, description, is_default)
VALUES
  ('50 Hour Check', 'hours', 50, 0, 'Basic inspection and oil change', true),
  ('100 Hour Check', 'hours', 100, 0, 'Comprehensive inspection', true),
  ('Annual Inspection', 'calendar', 0, 12, 'Annual airworthiness inspection', true),
  ('Hose Replacement', 'calendar', 0, 24, 'Replace fuel and oil hoses', true)
ON CONFLICT DO NOTHING;

-- Insert default maintenance settings
INSERT INTO maintenance_settings (auto_ground_on_major_defect, require_maintenance_approval, maintenance_reminder_days, defect_photo_required)
VALUES (true, true, 14, false)
ON CONFLICT DO NOTHING;