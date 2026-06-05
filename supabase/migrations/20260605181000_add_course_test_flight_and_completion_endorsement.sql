/*
  Add course-design fields for test flights and completion endorsements.

  - Lessons can be marked as a flight test at course design time.
  - Courses can grant an endorsement automatically when completed 100%.
*/

ALTER TABLE public.training_lessons
  ADD COLUMN IF NOT EXISTS is_flight_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS completion_endorsement_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_endorsement_type text,
  ADD COLUMN IF NOT EXISTS completion_endorsement_expiry_months integer;

UPDATE public.training_lessons
SET is_flight_test = true
WHERE is_flight_test = false
  AND (
    lower(name) LIKE '%flight test%'
    OR lower(sequence_title) LIKE '%flight test%'
    OR sequence_code IN ('RPC-FLT-TEST', 'RPC-TEST')
  );

UPDATE public.training_courses
SET
  completion_endorsement_enabled = true,
  completion_endorsement_type = COALESCE(completion_endorsement_type, 'Pilot Certificate')
WHERE completion_endorsement_enabled = false
  AND lower(title) LIKE '%ab-initio%rpc%';

COMMENT ON COLUMN public.training_lessons.is_flight_test IS 'Marks this lesson as a course-defined flight test/check flight rather than a normal lesson.';
COMMENT ON COLUMN public.training_courses.completion_endorsement_enabled IS 'When true, 100% course completion can automatically grant the configured endorsement.';
COMMENT ON COLUMN public.training_courses.completion_endorsement_type IS 'Endorsement name/type granted when the course is completed.';
COMMENT ON COLUMN public.training_courses.completion_endorsement_expiry_months IS 'Optional expiry period for the granted endorsement. Null means no expiry.';
