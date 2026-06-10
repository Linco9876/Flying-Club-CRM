/*
  # Enhance Maintenance Milestones System

  ## Overview
  Enhances the maintenance_milestones table to support comprehensive maintenance tracking
  including completion history, intervals, and deadline calculations.

  ## Changes Made

  1. **Enhanced maintenance_milestones table**
     - Added `type` column: 'hours', 'calendar', or 'both'
     - Added `interval_hours`: Hours between maintenance (for hour-based tracking)
     - Added `interval_months`: Months between maintenance (for calendar-based tracking)
     - Added `last_completed_date`: When maintenance was last performed
     - Added `last_completed_tach`: Tach hours when last performed
     - Added `next_due_hours`: Next due tach hours
     - Added `next_due_date`: Next due calendar date
     - Added `description`: Description of the maintenance task
     - Kept existing columns for backward compatibility

  2. **New maintenance_completions table**
     - Tracks history of all maintenance completions
     - `id` (uuid, primary key)
     - `milestone_id` (uuid, foreign key)
     - `aircraft_id` (uuid, foreign key)
     - `completed_date` (date)
     - `completed_tach` (numeric)
     - `completed_by` (uuid, foreign key to users)
     - `next_due_hours` (numeric)
     - `next_due_date` (date)
     - `notes` (text)
     - `created_at` (timestamp)

  3. **Security**
     - Enable RLS on maintenance_completions table
     - Add policies for authenticated users
*/

-- Add new columns to maintenance_milestones table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestones' AND column_name = 'type'
  ) THEN
    ALTER TABLE maintenance_milestones ADD COLUMN type text DEFAULT 'hours' CHECK (type IN ('hours', 'calendar', 'both'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestones' AND column_name = 'interval_hours'
  ) THEN
    ALTER TABLE maintenance_milestones ADD COLUMN interval_hours numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestones' AND column_name = 'interval_months'
  ) THEN
    ALTER TABLE maintenance_milestones ADD COLUMN interval_months integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestones' AND column_name = 'last_completed_date'
  ) THEN
    ALTER TABLE maintenance_milestones ADD COLUMN last_completed_date date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestones' AND column_name = 'last_completed_tach'
  ) THEN
    ALTER TABLE maintenance_milestones ADD COLUMN last_completed_tach numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestones' AND column_name = 'next_due_hours'
  ) THEN
    ALTER TABLE maintenance_milestones ADD COLUMN next_due_hours numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestones' AND column_name = 'next_due_date'
  ) THEN
    ALTER TABLE maintenance_milestones ADD COLUMN next_due_date date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_milestones' AND column_name = 'description'
  ) THEN
    ALTER TABLE maintenance_milestones ADD COLUMN description text;
  END IF;
END $$;

-- Create maintenance_completions table
CREATE TABLE IF NOT EXISTS maintenance_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES maintenance_milestones(id) ON DELETE CASCADE,
  aircraft_id uuid NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  completed_date date NOT NULL,
  completed_tach numeric,
  completed_by uuid REFERENCES users(id),
  next_due_hours numeric,
  next_due_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE maintenance_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view maintenance completions"
  ON maintenance_completions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert maintenance completions"
  ON maintenance_completions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update maintenance completions"
  ON maintenance_completions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete maintenance completions"
  ON maintenance_completions FOR DELETE
  TO authenticated
  USING (true);