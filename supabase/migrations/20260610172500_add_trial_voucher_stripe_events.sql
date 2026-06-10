CREATE TABLE IF NOT EXISTS public.trial_flight_voucher_stripe_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  voucher_id uuid REFERENCES public.trial_flight_vouchers(id) ON DELETE SET NULL,
  stripe_checkout_session_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_trial_flight_voucher_stripe_events_voucher_id
  ON public.trial_flight_voucher_stripe_events(voucher_id);

CREATE INDEX IF NOT EXISTS idx_trial_flight_voucher_stripe_events_session_id
  ON public.trial_flight_voucher_stripe_events(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trial_flight_voucher_stripe_events_processed_at
  ON public.trial_flight_voucher_stripe_events(processed_at);

ALTER TABLE public.trial_flight_voucher_stripe_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read trial flight voucher stripe events"
  ON public.trial_flight_voucher_stripe_events;

CREATE POLICY "Admins read trial flight voucher stripe events"
  ON public.trial_flight_voucher_stripe_events
  FOR SELECT
  TO authenticated
  USING (public.current_user_is_admin());
