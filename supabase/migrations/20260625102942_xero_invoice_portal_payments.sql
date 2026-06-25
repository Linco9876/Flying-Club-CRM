-- Track member portal payments made against Xero invoices that may not have
-- originated from CRM flight logs.

CREATE TABLE IF NOT EXISTS public.xero_invoice_portal_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  xero_contact_id text NOT NULL,
  xero_invoice_id text NOT NULL,
  xero_invoice_number text,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'AUD',
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text,
  xero_payment_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'needs_review')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xero_invoice_portal_payments_user_id
  ON public.xero_invoice_portal_payments(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xero_invoice_portal_payments_invoice_id
  ON public.xero_invoice_portal_payments(xero_invoice_id);

ALTER TABLE public.xero_invoice_portal_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read own Xero invoice portal payments" ON public.xero_invoice_portal_payments;
CREATE POLICY "Members can read own Xero invoice portal payments"
  ON public.xero_invoice_portal_payments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Staff can read all Xero invoice portal payments" ON public.xero_invoice_portal_payments;
CREATE POLICY "Staff can read all Xero invoice portal payments"
  ON public.xero_invoice_portal_payments
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_staff_role());

GRANT SELECT ON public.xero_invoice_portal_payments TO authenticated;

NOTIFY pgrst, 'reload schema';
