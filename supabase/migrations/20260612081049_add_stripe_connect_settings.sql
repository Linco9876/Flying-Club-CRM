-- Store the CRM's Stripe Connect link without exposing OAuth details to the browser.
-- These tables are intentionally service-role only; admins interact with them
-- through the stripe-connect Edge Function.

CREATE TABLE IF NOT EXISTS public.stripe_connect_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL UNIQUE,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  redirect_to text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_connect_oauth_states_state
  ON public.stripe_connect_oauth_states(state);

CREATE INDEX IF NOT EXISTS idx_stripe_connect_oauth_states_expires_at
  ON public.stripe_connect_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS public.stripe_connect_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  stripe_user_id text,
  stripe_publishable_key text,
  scope text,
  livemode boolean NOT NULL DEFAULT false,
  connected_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_connect_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_connect_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stripe_connect_oauth_states FROM anon, authenticated;
REVOKE ALL ON public.stripe_connect_settings FROM anon, authenticated;

GRANT ALL ON public.stripe_connect_oauth_states TO service_role;
GRANT ALL ON public.stripe_connect_settings TO service_role;
