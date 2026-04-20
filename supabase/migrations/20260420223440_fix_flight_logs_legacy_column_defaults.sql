/*
  # Fix legacy NOT NULL columns in flight_logs

  The table has both old columns (tach_start, tach_end) and new columns (start_tach, end_tach).
  The modal inserts using the new column names, leaving the old NOT NULL columns without values.
  Give them a default of 0 so inserts succeed.
*/

ALTER TABLE flight_logs ALTER COLUMN tach_start SET DEFAULT 0;
ALTER TABLE flight_logs ALTER COLUMN tach_end SET DEFAULT 0;
