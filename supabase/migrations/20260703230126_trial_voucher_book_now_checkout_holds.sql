ALTER TABLE public.trial_flight_vouchers
  ADD COLUMN IF NOT EXISTS checkout_intent text NOT NULL DEFAULT 'gift_certificate',
  ADD COLUMN IF NOT EXISTS held_aircraft_id uuid REFERENCES public.aircraft(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS held_instructor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS held_start_time timestamptz,
  ADD COLUMN IF NOT EXISTS held_end_time timestamptz,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchaser_confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchaser_confirmation_error text,
  ADD COLUMN IF NOT EXISTS recipient_confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_confirmation_error text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_url text,
  ADD COLUMN IF NOT EXISTS checkout_abandoned_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_abandoned_email_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trial_flight_vouchers_checkout_intent_check'
  ) THEN
    ALTER TABLE public.trial_flight_vouchers
      ADD CONSTRAINT trial_flight_vouchers_checkout_intent_check
      CHECK (checkout_intent IN ('gift_certificate', 'book_now'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trial_voucher_active_checkout_holds
  ON public.trial_flight_vouchers(product_id, held_start_time, held_end_time, hold_expires_at)
  WHERE checkout_intent = 'book_now'
    AND payment_status = 'pending'
    AND held_start_time IS NOT NULL
    AND held_end_time IS NOT NULL
    AND hold_expires_at IS NOT NULL;
