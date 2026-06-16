-- Track whether a restricted trial voucher account has completed password setup.
-- A Supabase recovery/invite link can create a valid session before the user
-- actually saves a password, so voucher availability must check this flag.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS trial_voucher_password_set_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_trial_voucher_password_set
  ON public.users(portal_access_scope, trial_voucher_password_set_at)
  WHERE portal_access_scope = 'trial_voucher';
