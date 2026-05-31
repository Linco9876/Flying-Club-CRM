/*
  Make safety and compliance operational.

  The claimed Bolt database contained the early JSON-only safety settings table.
  Align it with the application settings UI and add a real occurrence register.
*/

ALTER TABLE public.safety_compliance_settings
  ADD COLUMN IF NOT EXISTS recency_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS medical_warning_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS licence_warning_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS bfr_warning_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS instructor_sop_check_months integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS senior_instructor_sop_check_months integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS default_safety_officer text NOT NULL DEFAULT 'Safety Officer',
  ADD COLUMN IF NOT EXISTS auto_assign_incidents boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_photos_for_defects boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_ground_on_major_defect boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_block_expired_medical boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_block_expired_licence boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_bfr_for_solo boolean NOT NULL DEFAULT true;

INSERT INTO public.safety_compliance_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.safety_compliance_settings);

INSERT INTO public.safety_report_categories (name, default_assignee, display_order)
SELECT seed.name, seed.default_assignee, seed.display_order
FROM (VALUES
  ('Hazard', 'Safety Officer', 0),
  ('Aircraft Incident', 'Safety Officer', 1),
  ('Ground Incident', 'Safety Officer', 2),
  ('Injury or Medical', 'Safety Officer', 3),
  ('Operational Occurrence', 'Chief Flying Instructor', 4)
) AS seed(name, default_assignee, display_order)
WHERE NOT EXISTS (SELECT 1 FROM public.safety_report_categories);

CREATE TABLE IF NOT EXISTS public.safety_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES public.safety_report_categories(id) ON DELETE SET NULL,
  report_type text NOT NULL CHECK (report_type IN ('incident', 'hazard', 'risk_assessment')),
  severity text NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  description text NOT NULL,
  location text,
  immediate_actions text,
  involved_user_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'closed')),
  assigned_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.safety_reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_safety_reports_created_at
  ON public.safety_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_reports_reporter_id
  ON public.safety_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_safety_reports_involved_user_ids
  ON public.safety_reports USING gin(involved_user_ids);

DROP POLICY IF EXISTS "Authenticated users can read safety reports" ON public.safety_reports;
DROP POLICY IF EXISTS "Authenticated users can create safety reports" ON public.safety_reports;
DROP POLICY IF EXISTS "Staff can update safety reports" ON public.safety_reports;
DROP POLICY IF EXISTS "Staff can delete safety reports" ON public.safety_reports;

CREATE POLICY "Authenticated users can read safety reports"
  ON public.safety_reports FOR SELECT TO authenticated
  USING (
    reporter_id = (SELECT auth.uid())
    OR (SELECT auth.uid()) = ANY(involved_user_ids)
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

CREATE POLICY "Authenticated users can create safety reports"
  ON public.safety_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()));

CREATE POLICY "Staff can update safety reports"
  ON public.safety_reports FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

CREATE POLICY "Staff can delete safety reports"
  ON public.safety_reports FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE public.safety_compliance_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.safety_report_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.safety_reports TO authenticated;
