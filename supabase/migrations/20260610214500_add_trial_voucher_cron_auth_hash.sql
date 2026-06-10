-- Store only a hash of the trial voucher cron secret in a service-role-readable table.
-- pg_cron sends the raw Vault secret to the Edge Function; the function compares
-- a SHA-256 hash of the supplied value with this stored hash.

CREATE TABLE IF NOT EXISTS public.trial_voucher_cron_auth (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  secret_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trial_voucher_cron_auth ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trial_voucher_cron_auth FROM anon;
REVOKE ALL ON public.trial_voucher_cron_auth FROM authenticated;

INSERT INTO public.trial_voucher_cron_auth (id, secret_hash, updated_at)
SELECT
  true,
  encode(digest(decrypted_secret, 'sha256'), 'hex'),
  now()
FROM vault.decrypted_secrets
WHERE name = 'trial_voucher_cron_secret'
ON CONFLICT (id)
DO UPDATE SET
  secret_hash = EXCLUDED.secret_hash,
  updated_at = now();
