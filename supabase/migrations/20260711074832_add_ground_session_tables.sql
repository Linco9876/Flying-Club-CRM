ALTER TABLE public.flight_types
  ADD COLUMN IF NOT EXISTS ground_session_hourly_rate numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.ground_session_description_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ground_session_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  instructor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  duration_hours numeric NOT NULL CHECK (duration_hours > 0),
  flight_type_id uuid REFERENCES public.flight_types(id) ON DELETE SET NULL,
  payment_type text NOT NULL,
  description_option_id uuid REFERENCES public.ground_session_description_options(id) ON DELETE SET NULL,
  description_text text,
  notes text,
  calculated_cost numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('free', 'pending', 'paid')),
  xero_invoice_id text,
  xero_invoice_number text,
  xero_invoice_status text,
  xero_sync_status text,
  xero_sync_error text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.account_transactions
  ADD COLUMN IF NOT EXISTS ground_session_log_id uuid REFERENCES public.ground_session_logs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ground_session_description_options_active
  ON public.ground_session_description_options(active, display_order);

CREATE INDEX IF NOT EXISTS idx_ground_session_logs_booking
  ON public.ground_session_logs(booking_id);

CREATE INDEX IF NOT EXISTS idx_ground_session_logs_member_start
  ON public.ground_session_logs(student_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_ground_session_logs_instructor_start
  ON public.ground_session_logs(instructor_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_account_transactions_ground_session_log
  ON public.account_transactions(ground_session_log_id)
  WHERE ground_session_log_id IS NOT NULL;

ALTER TABLE public.ground_session_description_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ground_session_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view ground session descriptions"
  ON public.ground_session_description_options;
DROP POLICY IF EXISTS "Admins can manage ground session descriptions"
  ON public.ground_session_description_options;

CREATE POLICY "Authenticated users can view ground session descriptions"
  ON public.ground_session_description_options
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage ground session descriptions"
  ON public.ground_session_description_options
  FOR ALL
  TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

DROP POLICY IF EXISTS "Users can view relevant ground session logs"
  ON public.ground_session_logs;
DROP POLICY IF EXISTS "Staff can create ground session logs"
  ON public.ground_session_logs;
DROP POLICY IF EXISTS "Staff can update ground session logs"
  ON public.ground_session_logs;
DROP POLICY IF EXISTS "Staff can delete ground session logs"
  ON public.ground_session_logs;

CREATE POLICY "Users can view relevant ground session logs"
  ON public.ground_session_logs
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid()
    OR instructor_id = auth.uid()
    OR public.current_user_has_staff_role()
  );

CREATE POLICY "Staff can create ground session logs"
  ON public.ground_session_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_has_staff_role());

CREATE POLICY "Staff can update ground session logs"
  ON public.ground_session_logs
  FOR UPDATE
  TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

CREATE POLICY "Staff can delete ground session logs"
  ON public.ground_session_logs
  FOR DELETE
  TO authenticated
  USING (public.current_user_has_staff_role());

GRANT SELECT ON public.ground_session_description_options TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ground_session_description_options TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ground_session_logs TO authenticated;

INSERT INTO public.ground_session_description_options (name, description, display_order)
VALUES
  ('Exam', 'Ground session for an exam briefing, sitting or review.', 1),
  ('Weather Briefing', 'Weather, operational planning or go/no-go briefing.', 2),
  ('Ground Session', 'General ground instruction or pre/post-flight training session.', 3)
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.flight_types.ground_session_hourly_rate IS
  'Hourly ground instruction rate used for instructor-only bookings. Logs bill in 15 minute increments.';

COMMENT ON COLUMN public.ground_session_logs.duration_hours IS
  'Billable ground session duration, stored in 0.25 hour / 15 minute increments.';

NOTIFY pgrst, 'reload schema';
