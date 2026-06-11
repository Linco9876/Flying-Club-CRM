-- Prevent duplicate scheduled voucher email sends when multiple schedulers overlap.

ALTER TABLE public.trial_flight_vouchers
  ADD COLUMN IF NOT EXISTS email_delivery_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_trial_flight_vouchers_email_delivery_claim
  ON public.trial_flight_vouchers(email_delivery_claimed_at)
  WHERE delivered_at IS NULL AND email_delivery_claimed_at IS NOT NULL;
