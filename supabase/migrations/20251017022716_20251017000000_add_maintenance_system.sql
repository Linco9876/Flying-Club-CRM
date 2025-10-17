/*
  # Add Comprehensive Maintenance Defect Reporting System

  1. New Tables
    - `defect_reports` - Aircraft maintenance defect reports
      - `id` (uuid, primary key)
      - `aircraft_id` (uuid, foreign key to aircraft)
      - `reporter_id` (uuid, foreign key to users)
      - `discovery_date` (timestamptz) - When defect was discovered
      - `location` (text) - Location where defect was discovered
      - `brief_summary` (text, max 50 chars) - Short description
      - `detailed_summary` (text, max 500 chars) - Detailed description
      - `severity` (text) - Minor, Major, or Critical
      - `is_unserviceable` (boolean) - If true, aircraft is grounded
      - `engine_hours` (numeric) - Engine hours at discovery
      - `status` (text) - open, in_progress, resolved
      - `resolved_by` (uuid, foreign key to users)
      - `resolved_at` (timestamptz)
      - `resolution_notes` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `defect_attachments` - File attachments for defect reports
      - `id` (uuid, primary key)
      - `defect_report_id` (uuid, foreign key to defect_reports)
      - `file_name` (text)
      - `file_url` (text)
      - `file_size` (integer) - in bytes
      - `file_type` (text)
      - `uploaded_by` (uuid, foreign key to users)
      - `created_at` (timestamptz)

    - `maintenance_audit_log` - Audit trail for maintenance actions
      - `id` (uuid, primary key)
      - `defect_report_id` (uuid, foreign key to defect_reports)
      - `aircraft_id` (uuid, foreign key to aircraft)
      - `action` (text) - Type of action performed
      - `performed_by` (uuid, foreign key to users)
      - `old_values` (jsonb) - Previous values
      - `new_values` (jsonb) - New values
      - `notes` (text)
      - `created_at` (timestamptz)

    - `booking_conflicts` - Track booking conflicts
      - `id` (uuid, primary key)
      - `booking_id` (uuid, foreign key to bookings)
      - `conflict_type` (text) - instructor_unavailable, aircraft_grounded, double_booking
      - `conflict_details` (jsonb)
      - `is_resolved` (boolean)
      - `notified_at` (timestamptz)
      - `resolved_at` (timestamptz)
      - `created_at` (timestamptz)

  2. Aircraft Table Updates
    - Add `is_grounded` (boolean) - Aircraft serviceability status
    - Add `grounded_by` (uuid) - Who grounded the aircraft
    - Add `grounded_at` (timestamptz) - When aircraft was grounded
    - Add `grounding_reason` (text) - Why aircraft was grounded

  3. Security
    - Enable RLS on all new tables
    - All authenticated users can view defect reports
    - All authenticated users can create defect reports
    - Only admins, instructors, and original reporter can update defect reports
    - Only admins and instructors can mark defects as resolved
    - Only admins can modify reporter field
    - Audit logs are read-only for non-admins

  4. Indexes
    - Index on defect_reports(aircraft_id, status)
    - Index on defect_reports(severity, is_unserviceable)
    - Index on booking_conflicts(booking_id, is_resolved)
    - Index on maintenance_audit_log(defect_report_id)
*/

-- Update aircraft table to support grounding
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aircraft' AND column_name = 'is_grounded'
  ) THEN
    ALTER TABLE aircraft ADD COLUMN is_grounded boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aircraft' AND column_name = 'grounded_by'
  ) THEN
    ALTER TABLE aircraft ADD COLUMN grounded_by uuid REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aircraft' AND column_name = 'grounded_at'
  ) THEN
    ALTER TABLE aircraft ADD COLUMN grounded_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aircraft' AND column_name = 'grounding_reason'
  ) THEN
    ALTER TABLE aircraft ADD COLUMN grounding_reason text;
  END IF;
END $$;

-- Create defect_reports table
CREATE TABLE IF NOT EXISTS defect_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id),
  discovery_date timestamptz NOT NULL DEFAULT now(),
  location text NOT NULL,
  brief_summary text NOT NULL CHECK (char_length(brief_summary) <= 50),
  detailed_summary text NOT NULL CHECK (char_length(detailed_summary) <= 500),
  severity text NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
  is_unserviceable boolean DEFAULT false,
  engine_hours numeric(10, 2),
  status text DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create defect_attachments table
CREATE TABLE IF NOT EXISTS defect_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_report_id uuid NOT NULL REFERENCES defect_reports(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size integer NOT NULL CHECK (file_size <= 10485760),
  file_type text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Create maintenance_audit_log table
CREATE TABLE IF NOT EXISTS maintenance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_report_id uuid REFERENCES defect_reports(id) ON DELETE CASCADE,
  aircraft_id uuid REFERENCES aircraft(id),
  action text NOT NULL,
  performed_by uuid NOT NULL REFERENCES users(id),
  old_values jsonb,
  new_values jsonb,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create booking_conflicts table
CREATE TABLE IF NOT EXISTS booking_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  conflict_type text NOT NULL CHECK (conflict_type IN ('instructor_unavailable', 'aircraft_grounded', 'double_booking', 'aircraft_maintenance')),
  conflict_details jsonb,
  is_resolved boolean DEFAULT false,
  notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE defect_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE defect_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_conflicts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for defect_reports
CREATE POLICY "All authenticated users can view defect reports"
  ON defect_reports
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can create defect reports"
  ON defect_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins, instructors, and original reporter can update defect reports"
  ON defect_reports
  FOR UPDATE
  TO authenticated
  USING (
    reporter_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  )
  WITH CHECK (
    reporter_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- RLS Policies for defect_attachments
CREATE POLICY "All authenticated users can view defect attachments"
  ON defect_attachments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can upload attachments"
  ON defect_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Only admins and instructors can delete attachments"
  ON defect_attachments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- RLS Policies for maintenance_audit_log
CREATE POLICY "All authenticated users can view audit logs"
  ON maintenance_audit_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert audit logs"
  ON maintenance_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for booking_conflicts
CREATE POLICY "All authenticated users can view conflicts"
  ON booking_conflicts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage conflicts"
  ON booking_conflicts
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_defect_reports_aircraft_status ON defect_reports(aircraft_id, status);
CREATE INDEX IF NOT EXISTS idx_defect_reports_severity ON defect_reports(severity, is_unserviceable);
CREATE INDEX IF NOT EXISTS idx_defect_reports_discovery_date ON defect_reports(discovery_date DESC);
CREATE INDEX IF NOT EXISTS idx_booking_conflicts_booking ON booking_conflicts(booking_id, is_resolved);
CREATE INDEX IF NOT EXISTS idx_maintenance_audit_log_defect ON maintenance_audit_log(defect_report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aircraft_grounded ON aircraft(is_grounded) WHERE is_grounded = true;

-- Function to automatically create audit log entry
CREATE OR REPLACE FUNCTION log_maintenance_action()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO maintenance_audit_log (
    defect_report_id,
    aircraft_id,
    action,
    performed_by,
    old_values,
    new_values,
    notes
  ) VALUES (
    NEW.id,
    NEW.aircraft_id,
    TG_OP,
    auth.uid(),
    to_jsonb(OLD),
    to_jsonb(NEW),
    CASE
      WHEN TG_OP = 'INSERT' THEN 'Defect report created'
      WHEN TG_OP = 'UPDATE' AND NEW.status = 'resolved' THEN 'Defect marked as resolved'
      WHEN TG_OP = 'UPDATE' THEN 'Defect report updated'
      ELSE 'Defect report modified'
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to log defect report changes
DROP TRIGGER IF EXISTS trigger_log_defect_changes ON defect_reports;
CREATE TRIGGER trigger_log_defect_changes
  AFTER INSERT OR UPDATE ON defect_reports
  FOR EACH ROW
  EXECUTE FUNCTION log_maintenance_action();

-- Function to ground aircraft when defect is marked unserviceable
CREATE OR REPLACE FUNCTION ground_aircraft_on_defect()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_unserviceable = true AND (OLD IS NULL OR OLD.is_unserviceable = false) THEN
    UPDATE aircraft
    SET 
      is_grounded = true,
      grounded_by = auth.uid(),
      grounded_at = now(),
      grounding_reason = NEW.brief_summary,
      status = 'unserviceable'
    WHERE id = NEW.aircraft_id;

    -- Create conflicts for future bookings with this aircraft
    INSERT INTO booking_conflicts (booking_id, conflict_type, conflict_details)
    SELECT 
      id,
      'aircraft_grounded',
      jsonb_build_object(
        'aircraft_id', NEW.aircraft_id,
        'defect_report_id', NEW.id,
        'grounded_at', now()
      )
    FROM bookings
    WHERE aircraft_id = NEW.aircraft_id
      AND start_time > now()
      AND status NOT IN ('cancelled', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM booking_conflicts
        WHERE booking_id = bookings.id
          AND conflict_type = 'aircraft_grounded'
          AND is_resolved = false
      );
  END IF;

  IF NEW.is_unserviceable = false AND OLD.is_unserviceable = true THEN
    UPDATE aircraft
    SET 
      is_grounded = false,
      grounded_by = NULL,
      grounded_at = NULL,
      grounding_reason = NULL,
      status = 'serviceable'
    WHERE id = NEW.aircraft_id;

    -- Resolve conflicts related to this defect
    UPDATE booking_conflicts
    SET is_resolved = true, resolved_at = now()
    WHERE conflict_type = 'aircraft_grounded'
      AND conflict_details->>'defect_report_id' = NEW.id::text
      AND is_resolved = false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to ground/unground aircraft based on defect status
DROP TRIGGER IF EXISTS trigger_ground_aircraft ON defect_reports;
CREATE TRIGGER trigger_ground_aircraft
  AFTER INSERT OR UPDATE ON defect_reports
  FOR EACH ROW
  EXECUTE FUNCTION ground_aircraft_on_defect();

-- Function to detect booking conflicts
CREATE OR REPLACE FUNCTION check_booking_conflicts()
RETURNS TRIGGER AS $$
DECLARE
  conflict_count integer;
BEGIN
  -- Check for instructor double-booking
  IF NEW.instructor_id IS NOT NULL THEN
    SELECT COUNT(*) INTO conflict_count
    FROM bookings
    WHERE id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND instructor_id = NEW.instructor_id
      AND status NOT IN ('cancelled', 'completed')
      AND (
        (start_time, end_time) OVERLAPS (NEW.start_time, NEW.end_time)
      );

    IF conflict_count > 0 THEN
      RAISE EXCEPTION 'Instructor is already booked during this time';
    END IF;
  END IF;

  -- Check for aircraft double-booking
  SELECT COUNT(*) INTO conflict_count
  FROM bookings
  WHERE id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND aircraft_id = NEW.aircraft_id
    AND status NOT IN ('cancelled', 'completed')
    AND (
      (start_time, end_time) OVERLAPS (NEW.start_time, NEW.end_time)
    );

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Aircraft is already booked during this time';
  END IF;

  -- Check if aircraft is grounded
  IF EXISTS (
    SELECT 1 FROM aircraft
    WHERE id = NEW.aircraft_id AND is_grounded = true
  ) THEN
    RAISE EXCEPTION 'Aircraft is currently grounded and unavailable for booking';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to prevent conflicting bookings
DROP TRIGGER IF EXISTS trigger_check_booking_conflicts ON bookings;
CREATE TRIGGER trigger_check_booking_conflicts
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_booking_conflicts();
