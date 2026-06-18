ALTER TABLE public.student_exam_results
  ADD COLUMN IF NOT EXISTS answer_sheet_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS kdr_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS kdr_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kdr_completion_method text NOT NULL DEFAULT 'verbal',
  ADD COLUMN IF NOT EXISTS kdr_notes text,
  ADD COLUMN IF NOT EXISTS kdr_signed_off_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kdr_signed_off_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_exam_results_kdr_completion_method_check'
  ) THEN
    ALTER TABLE public.student_exam_results
      ADD CONSTRAINT student_exam_results_kdr_completion_method_check
      CHECK (kdr_completion_method IN ('verbal', 'written', 'not_required'));
  END IF;
END $$;

ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS two_occasion_competency_rule_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.flight_logs
  ADD COLUMN IF NOT EXISTS training_record_overdue_email_sent_at timestamptz;

UPDATE public.training_courses
SET two_occasion_competency_rule_enabled = true,
    last_updated = now()
WHERE id = '608e8835-c7fc-4523-9437-577684105f9d';

UPDATE public.training_courses
SET assessment_criteria = (
  SELECT jsonb_agg(
    CASE
      WHEN item->>'id' = 'criterion-1780981114361-mspard'
        THEN jsonb_set(item, '{id}', '"circuits"'::jsonb)
      ELSE item
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(assessment_criteria::jsonb) WITH ORDINALITY AS criteria(item, ordinality)
)
WHERE id = '608e8835-c7fc-4523-9437-577684105f9d'
  AND assessment_criteria::jsonb @> '[{"id":"criterion-1780981114361-mspard"}]'::jsonb;

UPDATE public.training_lessons
SET pass_marks = (pass_marks::jsonb - 'criterion-1780981114361-mspard')
  || jsonb_build_object('circuits', pass_marks::jsonb->'criterion-1780981114361-mspard')
WHERE course_id = '608e8835-c7fc-4523-9437-577684105f9d'
  AND pass_marks::jsonb ? 'criterion-1780981114361-mspard';
