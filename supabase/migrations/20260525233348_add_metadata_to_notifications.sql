/*
  # Add metadata column to notifications

  Adds a jsonb metadata column to notifications so we can store
  contextual navigation data (e.g. student_id for training record
  sign-off notifications).
*/

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT NULL;
