/*
  Add operational Training / Syllabus settings.
*/

CREATE TABLE IF NOT EXISTS public.training_syllabus_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  default_grading_system text NOT NULL DEFAULT 'NC/S/C/-'
    CHECK (default_grading_system IN ('NC/S/C/-', 'Pass or Fail', 'Out of 100')),
  require_student_acknowledgement boolean NOT NULL DEFAULT true,
  lock_record_after_student_ack boolean NOT NULL DEFAULT true,
  allow_submitted_record_editing boolean NOT NULL DEFAULT false,
  require_flight_comments boolean NOT NULL DEFAULT true,
  require_briefing_comments_when_formal boolean NOT NULL DEFAULT true,
  default_formal_briefing boolean NOT NULL DEFAULT false,
  prefill_highest_grades boolean NOT NULL DEFAULT true,
  next_lesson_rule text NOT NULL DEFAULT 'advance_on_pass'
    CHECK (next_lesson_rule IN ('advance_on_pass', 'always_advance', 'manual')),
  auto_notify_student_on_submit boolean NOT NULL DEFAULT true,
  auto_mark_flight_log_recorded boolean NOT NULL DEFAULT true,
  course_completion_rule text NOT NULL DEFAULT 'all_required_criteria'
    CHECK (course_completion_rule IN ('all_required_criteria', 'all_lessons_attempted', 'criteria_or_lessons')),
  show_pass_mark_guidance boolean NOT NULL DEFAULT true,
  show_best_grade_guidance boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.training_syllabus_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read training syllabus settings" ON public.training_syllabus_settings;
CREATE POLICY "Authenticated users can read training syllabus settings"
  ON public.training_syllabus_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can insert training syllabus settings" ON public.training_syllabus_settings;
CREATE POLICY "Admins can insert training syllabus settings"
  ON public.training_syllabus_settings FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
  );

DROP POLICY IF EXISTS "Admins can update training syllabus settings" ON public.training_syllabus_settings;
CREATE POLICY "Admins can update training syllabus settings"
  ON public.training_syllabus_settings FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
  );

INSERT INTO public.training_syllabus_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.training_syllabus_settings);

REVOKE ALL ON TABLE public.training_syllabus_settings FROM anon;
REVOKE ALL ON TABLE public.training_syllabus_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.training_syllabus_settings TO authenticated;
