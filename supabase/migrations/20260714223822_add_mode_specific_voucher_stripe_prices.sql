ALTER TABLE public.trial_flight_voucher_products
  ADD COLUMN IF NOT EXISTS stripe_test_price_id text,
  ADD COLUMN IF NOT EXISTS stripe_live_price_id text;

UPDATE public.trial_flight_voucher_products
SET stripe_live_price_id = COALESCE(stripe_live_price_id, stripe_price_id)
WHERE stripe_price_id IS NOT NULL
  AND btrim(stripe_price_id) <> '';

COMMENT ON COLUMN public.trial_flight_voucher_products.stripe_test_price_id IS
  'Stripe Price ID created with test credentials. Never use for live payments.';

COMMENT ON COLUMN public.trial_flight_voucher_products.stripe_live_price_id IS
  'Stripe Price ID created with live credentials. Never use for test payments.';
