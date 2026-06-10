-- Payment tracking foundation for future Stripe checkout integration.
-- This does not enable Stripe checkout yet; it stores the identifiers and status
-- that Stripe webhooks/checkouts will update later.

ALTER TABLE public.trial_flight_voucher_products
  ADD COLUMN IF NOT EXISTS stripe_price_id text;

ALTER TABLE public.trial_flight_vouchers
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS payment_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'AUD',
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trial_flight_vouchers_payment_status_check'
  ) THEN
    ALTER TABLE public.trial_flight_vouchers
      ADD CONSTRAINT trial_flight_vouchers_payment_status_check
      CHECK (payment_status IN ('manual', 'pending', 'paid', 'failed', 'refunded', 'waived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trial_flight_voucher_products_stripe_price_id
  ON public.trial_flight_voucher_products(stripe_price_id)
  WHERE stripe_price_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trial_flight_vouchers_payment_status
  ON public.trial_flight_vouchers(payment_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_flight_vouchers_stripe_checkout_session_id
  ON public.trial_flight_vouchers(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_flight_vouchers_stripe_payment_intent_id
  ON public.trial_flight_vouchers(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
