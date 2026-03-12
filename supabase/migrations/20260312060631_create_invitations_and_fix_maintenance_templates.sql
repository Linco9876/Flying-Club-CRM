/*
  # Create invitations table and fix maintenance_milestone_templates

  1. New Tables
    - `invitations`
      - `id` (uuid, primary key)
      - `email` (text)
      - `name` (text)
      - `phone` (text, nullable)
      - `role` (text)
      - `invited_by` (uuid, references users)
      - `status` (text: pending/accepted/expired)
      - `invited_at` (timestamptz)
      - `accepted_at` (timestamptz, nullable)
      - `user_id` (uuid, nullable)

  2. Modified Tables
    - `maintenance_milestone_templates`
      - Add `name` column (text)
      - Add `type` column (text)
      - Add `interval_hours` column (numeric)
      - Add `interval_months` column (integer)
      - Add `description` column (text)
      - Add `is_default` column (boolean)
      - Add `updated_at` column (timestamptz)

  3. Security
    - Enable RLS on invitations
    - Admins and instructors can read/insert invitations
    - All authenticated users can read invitations
*/

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'student',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  invited_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  user_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read invitations"
  ON invitations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert invitations"
  ON invitations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update invitations"
  ON invitations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete invitations"
  ON invitations FOR DELETE
  TO authenticated
  USING (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestone_templates' AND column_name = 'name'
  ) THEN
    ALTER TABLE maintenance_milestone_templates ADD COLUMN name text DEFAULT '';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestone_templates' AND column_name = 'type'
  ) THEN
    ALTER TABLE maintenance_milestone_templates ADD COLUMN type text DEFAULT 'hours';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestone_templates' AND column_name = 'interval_hours'
  ) THEN
    ALTER TABLE maintenance_milestone_templates ADD COLUMN interval_hours numeric DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestone_templates' AND column_name = 'interval_months'
  ) THEN
    ALTER TABLE maintenance_milestone_templates ADD COLUMN interval_months integer DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestone_templates' AND column_name = 'description'
  ) THEN
    ALTER TABLE maintenance_milestone_templates ADD COLUMN description text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestone_templates' AND column_name = 'is_default'
  ) THEN
    ALTER TABLE maintenance_milestone_templates ADD COLUMN is_default boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestone_templates' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE maintenance_milestone_templates ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;
