ALTER TABLE public.flight_logs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_status text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_flight_logs_stripe_checkout_session_id
  ON public.flight_logs(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flight_logs_stripe_payment_intent_id
  ON public.flight_logs(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.flight_log_stripe_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  flight_log_id uuid REFERENCES public.flight_logs(id) ON DELETE SET NULL,
  stripe_checkout_session_id text,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flight_log_stripe_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read flight log stripe events" ON public.flight_log_stripe_events;
CREATE POLICY "Staff can read flight log stripe events"
  ON public.flight_log_stripe_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'instructor', 'senior_instructor')
    )
  );

CREATE INDEX IF NOT EXISTS idx_flight_log_stripe_events_flight_log
  ON public.flight_log_stripe_events(flight_log_id, created_at DESC);
