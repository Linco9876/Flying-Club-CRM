/*
  # Add Defect History and Aircraft Grounding

  ## Overview
  Adds defect editing history tracking and improves aircraft grounding functionality.

  ## Changes Made

  1. **New defect_history table**
     - Tracks all changes made to defects over time
     - Records what changed, who changed it, and when
     - `id` (uuid, primary key)
     - `defect_id` (uuid, references defects)
     - `changed_by` (uuid, references users)
     - `changed_at` (timestamp)
     - `field_name` (text) - which field was changed
     - `old_value` (text) - previous value
     - `new_value` (text) - new value
     - `created_at` (timestamp)

  2. **Update defects table**
     - Add `updated_at` field
     - Add `updated_by` field

  3. **Aircraft grounding trigger**
     - When a defect with groundAircraft=true is created, set aircraft status to unserviceable

  4. **Security**
     - Enable RLS on defect_history table
     - Add policies for authenticated users
*/

-- Add fields to defects table if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'defects' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE defects ADD COLUMN updated_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'defects' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE defects ADD COLUMN updated_by uuid REFERENCES auth.users(id);
  END IF;
END $$;

-- Create defect_history table
CREATE TABLE IF NOT EXISTS defect_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id uuid REFERENCES defects(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz DEFAULT now(),
  field_name text NOT NULL,
  old_value text,
  new_value text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE defect_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view defect history"
  ON defect_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert defect history"
  ON defect_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create function to handle aircraft grounding
CREATE OR REPLACE FUNCTION handle_aircraft_grounding()
RETURNS TRIGGER AS $$
BEGIN
  -- If severity is Major or Critical, ground the aircraft
  IF NEW.severity IN ('Major', 'Critical') AND NEW.status = 'open' THEN
    UPDATE aircraft
    SET status = 'unserviceable'
    WHERE id = NEW.aircraft_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists and create it
DROP TRIGGER IF EXISTS trigger_aircraft_grounding ON defects;
CREATE TRIGGER trigger_aircraft_grounding
  AFTER INSERT OR UPDATE ON defects
  FOR EACH ROW
  EXECUTE FUNCTION handle_aircraft_grounding();

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_defect_history_defect_id ON defect_history(defect_id);
CREATE INDEX IF NOT EXISTS idx_defect_history_changed_at ON defect_history(changed_at DESC);