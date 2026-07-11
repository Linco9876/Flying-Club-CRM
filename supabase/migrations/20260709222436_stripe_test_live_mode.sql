ALTER TABLE IF EXISTS public.stripe_connect_settings
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS allow_test_mode_xero_sync boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mode_updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mode_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stripe_connect_settings_stripe_mode_check'
  ) THEN
    ALTER TABLE public.stripe_connect_settings
      ADD CONSTRAINT stripe_connect_settings_stripe_mode_check
      CHECK (stripe_mode IN ('test', 'live'));
  END IF;
END $$;

UPDATE public.stripe_connect_settings
SET stripe_mode = CASE WHEN COALESCE(livemode, false) THEN 'live' ELSE 'test' END
WHERE stripe_mode IS NULL;

ALTER TABLE IF EXISTS public.trial_flight_vouchers
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.trial_flight_voucher_stripe_events
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.flight_log_stripe_events
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.flight_logs
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.member_stripe_card_setup_sessions
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.member_stripe_payment_methods
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.member_topup_link_notifications
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.xero_invoice_portal_payments
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.account_transactions
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS is_test_mode boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'trial_flight_vouchers',
    'trial_flight_voucher_stripe_events',
    'flight_log_stripe_events',
    'flight_logs',
    'member_stripe_card_setup_sessions',
    'member_stripe_payment_methods',
    'member_topup_link_notifications',
    'xero_invoice_portal_payments',
    'account_transactions'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = table_name || '_stripe_mode_check'
      ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (stripe_mode IN (''test'', ''live''))',
        table_name,
        table_name || '_stripe_mode_check'
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_trial_flight_vouchers_stripe_mode
  ON public.trial_flight_vouchers(stripe_mode, payment_status)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flight_logs_stripe_mode
  ON public.flight_logs(stripe_mode, stripe_payment_status)
  WHERE stripe_checkout_session_id IS NOT NULL OR stripe_payment_intent_id IS NOT NULL;
