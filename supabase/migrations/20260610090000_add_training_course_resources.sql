/*
  # Add editable course resources

  Adds a JSONB resources field to training_courses so the active syllabus editor
  can store reference documents, videos, links and checklists for each course.
*/

ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS resources jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.training_courses.resources IS 'Course reference resources shown in the training course editor and exports.';
