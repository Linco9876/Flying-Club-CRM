/*
  # Add Aircraft Rates, Milestones, and Documents

  1. New Tables
    - `aircraft_rates`
      - `id` (uuid, primary key)
      - `aircraft_id` (uuid, foreign key to aircraft)
      - `rate_type` (text) - 'aircraft_prepaid', 'aircraft_payg', 'aircraft_account', 'instructor_prepaid', 'instructor_payg', 'instructor_account'
      - `amount` (numeric)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `maintenance_milestones`
      - `id` (uuid, primary key)
      - `aircraft_id` (uuid, foreign key to aircraft)
      - `title` (text)
      - `due_condition` (text) - 'hours' or 'date'
      - `due_value` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `aircraft_documents`
      - `id` (uuid, primary key)
      - `aircraft_id` (uuid, foreign key to aircraft)
      - `filename` (text)
      - `file_path` (text)
      - `file_type` (text)
      - `file_size` (integer)
      - `uploaded_by` (uuid, foreign key to users)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to read and manage data
*/

-- Aircraft Rates Table
CREATE TABLE IF NOT EXISTS aircraft_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  rate_type text NOT NULL CHECK (rate_type IN ('aircraft_prepaid', 'aircraft_payg', 'aircraft_account', 'instructor_prepaid', 'instructor_payg', 'instructor_account')),
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE aircraft_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view aircraft rates"
  ON aircraft_rates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert aircraft rates"
  ON aircraft_rates FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update aircraft rates"
  ON aircraft_rates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete aircraft rates"
  ON aircraft_rates FOR DELETE
  TO authenticated
  USING (true);

-- Maintenance Milestones Table
CREATE TABLE IF NOT EXISTS maintenance_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_condition text NOT NULL CHECK (due_condition IN ('hours', 'date')),
  due_value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE maintenance_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view maintenance milestones"
  ON maintenance_milestones FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert maintenance milestones"
  ON maintenance_milestones FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update maintenance milestones"
  ON maintenance_milestones FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete maintenance milestones"
  ON maintenance_milestones FOR DELETE
  TO authenticated
  USING (true);

-- Aircraft Documents Table
CREATE TABLE IF NOT EXISTS aircraft_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  filename text NOT NULL,
  file_path text NOT NULL,
  file_type text,
  file_size integer,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE aircraft_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view aircraft documents"
  ON aircraft_documents FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert aircraft documents"
  ON aircraft_documents FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update aircraft documents"
  ON aircraft_documents FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete aircraft documents"
  ON aircraft_documents FOR DELETE
  TO authenticated
  USING (true);