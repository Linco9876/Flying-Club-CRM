-- Administrators can create a portal identity without sending an invitation.
-- A later public signup attempt may reserve a rate-limited setup email, but the
-- account is only marked claimed after the authenticated password setup flow.
CREATE TABLE public.pending_portal_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claim_email_reserved_at timestamptz,
  claim_email_window_started_at timestamptz,
  claim_email_count integer NOT NULL DEFAULT 0 CHECK (claim_email_count >= 0),
  claimed_at timestamptz,
  CONSTRAINT pending_portal_accounts_email_normalised_check
    CHECK (email = lower(btrim(email)) AND email <> '')
);

CREATE UNIQUE INDEX pending_portal_accounts_unclaimed_email_key
  ON public.pending_portal_accounts (lower(email))
  WHERE claimed_at IS NULL;

ALTER TABLE public.pending_portal_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pending_portal_accounts FROM PUBLIC;
REVOKE ALL ON TABLE public.pending_portal_accounts FROM anon;
REVOKE ALL ON TABLE public.pending_portal_accounts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pending_portal_accounts TO service_role;

COMMENT ON TABLE public.pending_portal_accounts IS
  'Server-only state for portal identities created by an administrator without an invitation email.';
COMMENT ON COLUMN public.pending_portal_accounts.claim_email_reserved_at IS
  'Last time the public claim flow reserved an email send; used for compare-and-swap rate limiting.';
COMMENT ON COLUMN public.pending_portal_accounts.claim_email_count IS
  'Number of setup-email reservations in the current 24-hour abuse-prevention window.';
COMMENT ON COLUMN public.pending_portal_accounts.claimed_at IS
  'Set only after the user has authenticated through the emailed setup link and chosen a password.';
