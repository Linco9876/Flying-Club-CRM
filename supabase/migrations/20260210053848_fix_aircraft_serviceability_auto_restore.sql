/*
  # Fix Aircraft Serviceability Auto-Restore

  ## Overview
  Updates aircraft grounding logic to automatically restore aircraft to serviceable status 
  when all Major/Critical defects are resolved.

  ## Changes Made

  1. **Updated handle_aircraft_grounding function**
     - Now checks when defects are fixed or deleted
     - Automatically restores aircraft to 'serviceable' if no open Major/Critical defects remain
     - Handles both UPDATE and DELETE operations on defects

  2. **Added trigger for defect deletions**
     - Separate trigger to handle when defects are deleted
     - Checks if aircraft can be restored after deletion

  ## Logic
  - When a defect with Major/Critical severity is created or updated to 'open': Ground aircraft
  - When a defect is updated from 'open' to any other status (fixed, deferred, etc.): Check if aircraft should be restored
  - When a defect is deleted: Check if aircraft should be restored
  - Aircraft is restored to 'serviceable' only if NO open Major/Critical defects remain
*/

-- Update the aircraft grounding function to handle restoration
CREATE OR REPLACE FUNCTION handle_aircraft_grounding()
RETURNS TRIGGER AS $$
DECLARE
  has_open_critical_defects BOOLEAN;
BEGIN
  -- Handle INSERT or UPDATE
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    -- If severity is Major or Critical and status is open, ground the aircraft
    IF NEW.severity IN ('Major', 'Critical') AND NEW.status = 'open' THEN
      UPDATE aircraft
      SET status = 'unserviceable'
      WHERE id = NEW.aircraft_id;
    
    -- If defect was just fixed/deferred/resolved, check if aircraft can be restored
    ELSIF (TG_OP = 'UPDATE' AND OLD.status = 'open' AND NEW.status != 'open') 
       OR (TG_OP = 'UPDATE' AND NEW.severity NOT IN ('Major', 'Critical')) THEN
      
      -- Check if there are any remaining open Major/Critical defects for this aircraft
      SELECT EXISTS(
        SELECT 1 
        FROM defects 
        WHERE aircraft_id = NEW.aircraft_id 
          AND status = 'open' 
          AND severity IN ('Major', 'Critical')
      ) INTO has_open_critical_defects;
      
      -- If no open critical defects remain, restore aircraft to serviceable
      IF NOT has_open_critical_defects THEN
        UPDATE aircraft
        SET status = 'serviceable'
        WHERE id = NEW.aircraft_id;
      END IF;
    END IF;
    
    RETURN NEW;
  END IF;
  
  -- Should not reach here for this trigger
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to handle defect deletion
CREATE OR REPLACE FUNCTION handle_defect_deletion()
RETURNS TRIGGER AS $$
DECLARE
  has_open_critical_defects BOOLEAN;
BEGIN
  -- Only process if the deleted defect was open and Major/Critical
  IF OLD.status = 'open' AND OLD.severity IN ('Major', 'Critical') THEN
    -- Check if there are any remaining open Major/Critical defects for this aircraft
    SELECT EXISTS(
      SELECT 1 
      FROM defects 
      WHERE aircraft_id = OLD.aircraft_id 
        AND status = 'open' 
        AND severity IN ('Major', 'Critical')
    ) INTO has_open_critical_defects;
    
    -- If no open critical defects remain, restore aircraft to serviceable
    IF NOT has_open_critical_defects THEN
      UPDATE aircraft
      SET status = 'serviceable'
      WHERE id = OLD.aircraft_id;
    END IF;
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the grounding trigger for INSERT/UPDATE
DROP TRIGGER IF EXISTS trigger_aircraft_grounding ON defects;
CREATE TRIGGER trigger_aircraft_grounding
  AFTER INSERT OR UPDATE ON defects
  FOR EACH ROW
  EXECUTE FUNCTION handle_aircraft_grounding();

-- Create trigger for DELETE operations
DROP TRIGGER IF EXISTS trigger_defect_deletion ON defects;
CREATE TRIGGER trigger_defect_deletion
  AFTER DELETE ON defects
  FOR EACH ROW
  EXECUTE FUNCTION handle_defect_deletion();