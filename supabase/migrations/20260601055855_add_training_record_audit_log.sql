/*
  Add an embedded audit trail to training records.

  Used when instructors/admins revise a record after student acknowledgement so
  the student can see a concise summary of what changed before approving again.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'training_records'
      AND column_name = 'audit_log'
  ) THEN
    ALTER TABLE training_records
      ADD COLUMN audit_log jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;
