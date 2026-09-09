-- Keep progression approval separate from the student's assessment grades.
-- Existing training-record staff guards and audit triggers protect and audit updates.
alter table public.training_records
  add column instructor_progression_approved boolean not null default false;
