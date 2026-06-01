/*
  Backfill submission timestamps for existing training records.

  Older records could be submitted/locked without instructor_sign_timestamp.
  Use created_at as the best available submission-time fallback so profile
  filtering and newest-first sorting work consistently.
*/

UPDATE training_records
SET instructor_sign_timestamp = created_at
WHERE instructor_sign_timestamp IS NULL
  AND status IN ('submitted', 'locked')
  AND created_at IS NOT NULL;
