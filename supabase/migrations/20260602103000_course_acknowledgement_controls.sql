/*
  Add course-level student acknowledgement controls.

  Organisation settings can force acknowledgement for every course, otherwise
  each training course decides whether submitted records require student sign-off.
*/

ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS requires_student_acknowledgement boolean NOT NULL DEFAULT true;

ALTER TABLE public.training_syllabus_settings
  ADD COLUMN IF NOT EXISTS force_student_acknowledgement_for_all_courses boolean NOT NULL DEFAULT false;

UPDATE public.training_syllabus_settings
SET force_student_acknowledgement_for_all_courses = COALESCE(require_student_acknowledgement, false)
WHERE force_student_acknowledgement_for_all_courses IS DISTINCT FROM COALESCE(require_student_acknowledgement, false);
