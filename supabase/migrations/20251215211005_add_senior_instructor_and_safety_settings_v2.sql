/*
  # Add Senior Instructor and Safety Settings

  1. Changes to users table
    - Add `is_senior_instructor` boolean field to track senior instructor status
    - Defaults to false
    - Only relevant for users with instructor role

  2. New Table: safety_compliance_settings
    - Stores safety and compliance configuration
    - Pilot currency thresholds (recency, medical warning, license warning, BFR warning)
    - Two separate instructor check intervals (instructor SOP and senior instructor SOP)
    - Safety report default officer and automation flags
    - Compliance automation flags
    
  3. Security
    - Enable RLS on safety_compliance_settings
    - Only admins can view and edit settings
*/

-- Add senior instructor flag to users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_senior_instructor BOOLEAN DEFAULT false;

-- Create safety compliance settings table
CREATE TABLE IF NOT EXISTS safety_compliance_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Pilot Currency Thresholds
  recency_days INTEGER DEFAULT 90 CHECK (recency_days >= 30 AND recency_days <= 365),
  medical_warning_days INTEGER DEFAULT 60 CHECK (medical_warning_days >= 7 AND medical_warning_days <= 180),
  licence_warning_days INTEGER DEFAULT 60 CHECK (licence_warning_days >= 7 AND licence_warning_days <= 180),
  bfr_warning_days INTEGER DEFAULT 30 CHECK (bfr_warning_days >= 7 AND bfr_warning_days <= 90),
  
  -- Instructor Checks (two separate intervals)
  instructor_sop_check_months INTEGER DEFAULT 12 CHECK (instructor_sop_check_months >= 6 AND instructor_sop_check_months <= 36),
  senior_instructor_sop_check_months INTEGER DEFAULT 24 CHECK (senior_instructor_sop_check_months >= 12 AND senior_instructor_sop_check_months <= 48),
  
  -- Safety Reports
  default_safety_officer TEXT DEFAULT 'safety@flyingclub.com',
  auto_assign_incidents BOOLEAN DEFAULT true,
  require_photos_for_defects BOOLEAN DEFAULT false,
  
  -- Compliance Automation
  auto_ground_on_major_defect BOOLEAN DEFAULT true,
  auto_block_expired_medical BOOLEAN DEFAULT true,
  auto_block_expired_licence BOOLEAN DEFAULT true,
  require_bfr_for_solo BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create safety report categories table
CREATE TABLE IF NOT EXISTS safety_report_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  default_assignee TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE safety_compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_report_categories ENABLE ROW LEVEL SECURITY;

-- Policies for safety_compliance_settings (admins only)
CREATE POLICY "Admins can view safety compliance settings"
  ON safety_compliance_settings
  FOR SELECT
  TO authenticated
  USING (has_role('admin'));

CREATE POLICY "Admins can update safety compliance settings"
  ON safety_compliance_settings
  FOR UPDATE
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can insert safety compliance settings"
  ON safety_compliance_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin'));

-- Policies for safety_report_categories (admins can manage, all can view)
CREATE POLICY "Anyone can view safety report categories"
  ON safety_report_categories
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert safety report categories"
  ON safety_report_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can update safety report categories"
  ON safety_report_categories
  FOR UPDATE
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can delete safety report categories"
  ON safety_report_categories
  FOR DELETE
  TO authenticated
  USING (has_role('admin'));

-- Insert default safety report categories
INSERT INTO safety_report_categories (name, default_assignee, display_order) VALUES
  ('Aircraft Incident', 'Chief Flying Instructor', 1),
  ('Ground Incident', 'Safety Officer', 2),
  ('Weather Related', 'Safety Officer', 3),
  ('Human Factors', 'Chief Flying Instructor', 4),
  ('Maintenance Related', 'Maintenance Officer', 5)
ON CONFLICT DO NOTHING;

-- Insert default settings (only if none exist)
INSERT INTO safety_compliance_settings (id) 
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM safety_compliance_settings);
