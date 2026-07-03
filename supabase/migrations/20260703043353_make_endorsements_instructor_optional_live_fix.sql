/*
  Ensure self-service endorsements can be created without an instructor.
*/

ALTER TABLE public.endorsements
  ALTER COLUMN instructor_id DROP NOT NULL;
