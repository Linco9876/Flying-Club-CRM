/*
  # Add flight_log_id to training_records

  Links a training record directly to the flight log it was created from,
  enabling the outstanding records workflow.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_records' AND column_name = 'flight_log_id'
  ) THEN
    ALTER TABLE training_records ADD COLUMN flight_log_id uuid REFERENCES flight_logs(id) ON DELETE SET NULL;
  END IF;
END $$;
