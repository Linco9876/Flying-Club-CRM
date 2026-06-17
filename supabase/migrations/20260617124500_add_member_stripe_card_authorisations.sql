ALTER TABLE public.flight_logs
  ADD COLUMN IF NOT EXISTS stripe_payment_error text,
  ADD COLUMN IF NOT EXISTS stripe_charge_attempted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.member_stripe_card_setup_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_checkout_session_id text UNIQUE,
  consent_text text NOT NULL,
  consent_accepted_at timestamptz NOT NULL DEFAULT now(),
  consent_ip text,
  consent_user_agent text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_stripe_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_payment_method_id text NOT NULL UNIQUE,
  stripe_setup_intent_id text,
  card_brand text,
  card_last4 text,
  card_exp_month integer,
  card_exp_year integer,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT true,
  consent_text text NOT NULL,
  consent_accepted_at timestamptz NOT NULL,
  consent_ip text,
  consent_user_agent text,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_stripe_card_setup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_stripe_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_stripe_payment_methods_one_default
  ON public.member_stripe_payment_methods(user_id)
  WHERE active IS TRUE AND is_default IS TRUE;

CREATE INDEX IF NOT EXISTS idx_member_stripe_card_setup_sessions_user
  ON public.member_stripe_card_setup_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_stripe_payment_methods_user
  ON public.member_stripe_payment_methods(user_id, active, is_default);

DROP POLICY IF EXISTS "Members can read own stripe card setup sessions" ON public.member_stripe_card_setup_sessions;
CREATE POLICY "Members can read own stripe card setup sessions"
  ON public.member_stripe_card_setup_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Staff can read stripe card setup sessions" ON public.member_stripe_card_setup_sessions;
CREATE POLICY "Staff can read stripe card setup sessions"
  ON public.member_stripe_card_setup_sessions
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

DROP POLICY IF EXISTS "Members can read own stripe payment methods" ON public.member_stripe_payment_methods;
CREATE POLICY "Members can read own stripe payment methods"
  ON public.member_stripe_payment_methods
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Staff can read stripe payment methods" ON public.member_stripe_payment_methods;
CREATE POLICY "Staff can read stripe payment methods"
  ON public.member_stripe_payment_methods
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
