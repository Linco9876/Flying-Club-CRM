/*
  # Create Flight Types and Billing System

  1. New Tables
    - `flight_types`
      - `id` (uuid, primary key)
      - `name` (text, unique) - Name of the flight type
      - `allowed_roles` (text array) - Roles that can use this flight type
      - `display_order` (integer) - Display order
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `payment_methods`
      - `id` (uuid, primary key)
      - `name` (text, unique) - Name of payment method
      - `display_order` (integer) - Display order
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `aircraft_rates`
      - `id` (uuid, primary key)
      - `aircraft_id` (uuid, references aircraft)
      - `flight_type_id` (uuid, references flight_types)
      - `charge_type` (text) - 'tach', 'flat', 'per_pax', 'free', 'not_used'
      - `solo_rate` (decimal) - Cost for solo flying
      - `dual_rate` (decimal) - Cost for dual flying
      - `flat_surcharge` (decimal) - Additional flat surcharge (can be negative)
      - `weekend_surcharge` (decimal) - Weekend/public holiday surcharge
      - `default_payment_method_id` (uuid, references payment_methods)
      - `included_taxes` (decimal) - Taxes included in price
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on all tables
    - Admins can manage flight types and payment methods
    - All authenticated users can view flight types and payment methods
    - Admins and instructors can manage aircraft rates
    - All authenticated users can view aircraft rates
*/

-- Create flight_types table
CREATE TABLE IF NOT EXISTS flight_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  allowed_roles TEXT[] DEFAULT ARRAY['student', 'pilot', 'instructor', 'admin'],
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create payment_methods table
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create aircraft_rates table
CREATE TABLE IF NOT EXISTS aircraft_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id UUID NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  flight_type_id UUID NOT NULL REFERENCES flight_types(id) ON DELETE CASCADE,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('tach', 'flat', 'per_pax', 'free', 'not_used')),
  solo_rate DECIMAL(10, 2) DEFAULT 0.00,
  dual_rate DECIMAL(10, 2) DEFAULT 0.00,
  flat_surcharge DECIMAL(10, 2) DEFAULT 0.00,
  weekend_surcharge DECIMAL(10, 2) DEFAULT 0.00,
  default_payment_method_id UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
  included_taxes DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(aircraft_id, flight_type_id)
);

-- Enable RLS
ALTER TABLE flight_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE aircraft_rates ENABLE ROW LEVEL SECURITY;

-- Policies for flight_types
CREATE POLICY "Anyone can view flight types"
  ON flight_types
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert flight types"
  ON flight_types
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can update flight types"
  ON flight_types
  FOR UPDATE
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can delete flight types"
  ON flight_types
  FOR DELETE
  TO authenticated
  USING (has_role('admin'));

-- Policies for payment_methods
CREATE POLICY "Anyone can view payment methods"
  ON payment_methods
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert payment methods"
  ON payment_methods
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can update payment methods"
  ON payment_methods
  FOR UPDATE
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can delete payment methods"
  ON payment_methods
  FOR DELETE
  TO authenticated
  USING (has_role('admin'));

-- Policies for aircraft_rates
CREATE POLICY "Anyone can view aircraft rates"
  ON aircraft_rates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and instructors can insert aircraft rates"
  ON aircraft_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin') OR has_role('instructor'));

CREATE POLICY "Admins and instructors can update aircraft rates"
  ON aircraft_rates
  FOR UPDATE
  TO authenticated
  USING (has_role('admin') OR has_role('instructor'))
  WITH CHECK (has_role('admin') OR has_role('instructor'));

CREATE POLICY "Admins can delete aircraft rates"
  ON aircraft_rates
  FOR DELETE
  TO authenticated
  USING (has_role('admin'));

-- Insert default flight types
INSERT INTO flight_types (name, allowed_roles, display_order) VALUES
  ('Training', ARRAY['student', 'pilot', 'instructor', 'admin'], 1),
  ('Private Hire', ARRAY['pilot', 'instructor', 'admin'], 2),
  ('Charter', ARRAY['pilot', 'instructor', 'admin'], 3),
  ('Maintenance Test', ARRAY['instructor', 'admin'], 4),
  ('Check Ride', ARRAY['student', 'pilot', 'instructor', 'admin'], 5)
ON CONFLICT (name) DO NOTHING;

-- Insert default payment methods
INSERT INTO payment_methods (name, display_order) VALUES
  ('Cash', 1),
  ('Credit Card', 2),
  ('Debit Card', 3),
  ('Bank Transfer', 4),
  ('Account Credit', 5),
  ('Invoice', 6)
ON CONFLICT (name) DO NOTHING;
