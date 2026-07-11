/*
  # Learning Centre

  Adds an online program system for staff-created learning programs with
  schedule, enrolment/payment rules, ordered sections, article/video/quiz steps,
  participant enrolments/progress, and links to flying course lessons.
*/

CREATE TABLE IF NOT EXISTS public.learning_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  description text NOT NULL DEFAULT '',
  cover_photo_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  schedule_type text NOT NULL DEFAULT 'self_paced' CHECK (schedule_type IN ('self_paced', 'scheduled')),
  self_paced_limit_type text NOT NULL DEFAULT 'none' CHECK (self_paced_limit_type IN ('none', 'duration_days', 'fixed_end')),
  duration_days integer,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  price_type text NOT NULL DEFAULT 'free' CHECK (price_type IN ('free', 'paid')),
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  payment_notes text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private', 'secret')),
  participant_limit integer CHECK (participant_limit IS NULL OR participant_limit > 0),
  step_order_mode text NOT NULL DEFAULT 'in_order' CHECK (step_order_mode IN ('any_order', 'in_order')),
  future_steps_visible boolean NOT NULL DEFAULT true,
  video_watch_required boolean NOT NULL DEFAULT false,
  video_required_percent integer NOT NULL DEFAULT 90 CHECK (video_required_percent BETWEEN 0 AND 100),
  autoplay_next_video boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.learning_program_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.learning_programs(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.learning_program_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.learning_programs(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.learning_program_sections(id) ON DELETE SET NULL,
  step_type text NOT NULL CHECK (step_type IN ('article', 'video', 'quiz')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  content_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  video_url text,
  video_storage_path text,
  video_duration_seconds integer,
  quiz_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  passing_score_percent integer CHECK (passing_score_percent IS NULL OR passing_score_percent BETWEEN 0 AND 100),
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.learning_program_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.learning_programs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  invited_email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'pending_approval', 'active', 'completed', 'cancelled')),
  payment_status text NOT NULL DEFAULT 'not_required' CHECK (payment_status IN ('not_required', 'unpaid', 'paid', 'waived')),
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_id, user_id),
  UNIQUE(program_id, invited_email)
);

CREATE TABLE IF NOT EXISTS public.learning_step_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.learning_programs(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.learning_program_steps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  video_watch_percent integer NOT NULL DEFAULT 0 CHECK (video_watch_percent BETWEEN 0 AND 100),
  quiz_score_percent integer CHECK (quiz_score_percent IS NULL OR quiz_score_percent BETWEEN 0 AND 100),
  quiz_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(step_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.learning_program_lesson_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.learning_programs(id) ON DELETE CASCADE,
  training_course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  training_lesson_id uuid REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  visibility_timing text NOT NULL DEFAULT 'at_or_before_lesson' CHECK (visibility_timing IN ('always', 'at_or_before_lesson', 'after_lesson')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_id, training_course_id, training_lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_programs_status_visibility ON public.learning_programs(status, visibility);
CREATE INDEX IF NOT EXISTS idx_learning_sections_program ON public.learning_program_sections(program_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_learning_steps_program ON public.learning_program_steps(program_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_learning_steps_section ON public.learning_program_steps(section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_learning_enrolments_user ON public.learning_program_enrolments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_learning_progress_user ON public.learning_step_progress(user_id, program_id);
CREATE INDEX IF NOT EXISTS idx_learning_lesson_links_lesson ON public.learning_program_lesson_links(training_course_id, training_lesson_id);

ALTER TABLE public.learning_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_program_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_program_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_program_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_step_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_program_lesson_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage learning programs" ON public.learning_programs;
CREATE POLICY "Staff manage learning programs"
  ON public.learning_programs
  FOR ALL
  TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Members can view available learning programs" ON public.learning_programs;
CREATE POLICY "Members can view available learning programs"
  ON public.learning_programs
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      status = 'published'
      AND visibility IN ('public', 'private')
    )
    OR EXISTS (
      SELECT 1
      FROM public.learning_program_enrolments AS e
      WHERE e.program_id = learning_programs.id
        AND e.user_id = auth.uid()
        AND e.status IN ('invited', 'pending_approval', 'active', 'completed')
    )
  );

DROP POLICY IF EXISTS "Staff manage learning sections" ON public.learning_program_sections;
CREATE POLICY "Staff manage learning sections"
  ON public.learning_program_sections
  FOR ALL
  TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Members can view learning sections" ON public.learning_program_sections;
CREATE POLICY "Members can view learning sections"
  ON public.learning_program_sections
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR EXISTS (
      SELECT 1
      FROM public.learning_programs AS p
      WHERE p.id = learning_program_sections.program_id
        AND p.status = 'published'
        AND (
          p.visibility IN ('public', 'private')
          OR EXISTS (
            SELECT 1 FROM public.learning_program_enrolments AS e
            WHERE e.program_id = p.id AND e.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Staff manage learning steps" ON public.learning_program_steps;
CREATE POLICY "Staff manage learning steps"
  ON public.learning_program_steps
  FOR ALL
  TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Members can view learning steps" ON public.learning_program_steps;
CREATE POLICY "Members can view learning steps"
  ON public.learning_program_steps
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR EXISTS (
      SELECT 1
      FROM public.learning_programs AS p
      WHERE p.id = learning_program_steps.program_id
        AND p.status = 'published'
        AND (
          p.visibility IN ('public', 'private')
          OR EXISTS (
            SELECT 1 FROM public.learning_program_enrolments AS e
            WHERE e.program_id = p.id AND e.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Staff manage learning enrolments" ON public.learning_program_enrolments;
CREATE POLICY "Staff manage learning enrolments"
  ON public.learning_program_enrolments
  FOR ALL
  TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Members can view own learning enrolments" ON public.learning_program_enrolments;
CREATE POLICY "Members can view own learning enrolments"
  ON public.learning_program_enrolments
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_staff_role() OR user_id = auth.uid());

DROP POLICY IF EXISTS "Members can request learning enrolment" ON public.learning_program_enrolments;
CREATE POLICY "Members can request learning enrolment"
  ON public.learning_program_enrolments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_has_staff_role()
    OR (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.learning_programs AS p
        WHERE p.id = learning_program_enrolments.program_id
          AND p.status = 'published'
          AND p.visibility IN ('public', 'private')
      )
    )
  );

DROP POLICY IF EXISTS "Members can update own learning progress" ON public.learning_step_progress;
CREATE POLICY "Members can update own learning progress"
  ON public.learning_step_progress
  FOR ALL
  TO authenticated
  USING (public.current_user_has_staff_role() OR user_id = auth.uid())
  WITH CHECK (public.current_user_has_staff_role() OR user_id = auth.uid());

DROP POLICY IF EXISTS "Staff manage learning lesson links" ON public.learning_program_lesson_links;
CREATE POLICY "Staff manage learning lesson links"
  ON public.learning_program_lesson_links
  FOR ALL
  TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Members can view learning lesson links" ON public.learning_program_lesson_links;
CREATE POLICY "Members can view learning lesson links"
  ON public.learning_program_lesson_links
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR EXISTS (
      SELECT 1
      FROM public.learning_programs AS p
      WHERE p.id = learning_program_lesson_links.program_id
        AND p.status = 'published'
        AND p.visibility IN ('public', 'private')
    )
    OR EXISTS (
      SELECT 1
      FROM public.learning_program_enrolments AS e
      WHERE e.program_id = learning_program_lesson_links.program_id
        AND e.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.learning_programs,
  public.learning_program_sections,
  public.learning_program_steps,
  public.learning_program_enrolments,
  public.learning_step_progress,
  public.learning_program_lesson_links
TO authenticated;
