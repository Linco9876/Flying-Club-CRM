/*
  Allow CASA matrix lesson requirements to map to broader course assessment
  criteria, so matrix failures can explain broad pass/fail outcomes.
*/

ALTER TABLE public.syllabus_matrix_requirements
  ADD COLUMN IF NOT EXISTS assessment_criterion_id text;

CREATE INDEX IF NOT EXISTS idx_syllabus_matrix_requirements_assessment_criterion
  ON public.syllabus_matrix_requirements(course_id, assessment_criterion_id);

COMMENT ON COLUMN public.syllabus_matrix_requirements.assessment_criterion_id IS
  'Optional course assessment criterion id this matrix requirement contributes to.';
