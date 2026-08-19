-- Public password reset emails use the club's branded email provider because
-- the hosted Auth SMTP recovery endpoint can fail without a useful response.
-- Keep the public endpoint non-enumerating and enforce limits server-side.
CREATE TABLE public.password_reset_email_requests (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_hash text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_email_requests_hash_check
    CHECK (email_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.password_reset_email_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.password_reset_email_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.password_reset_email_requests FROM anon;
REVOKE ALL ON TABLE public.password_reset_email_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.password_reset_email_requests TO service_role;

COMMENT ON TABLE public.password_reset_email_requests IS
  'Server-only cooldown and abuse-prevention state for public password reset email requests.';
COMMENT ON COLUMN public.password_reset_email_requests.email_hash IS
  'SHA-256 of the normalised current authentication email; the email address is not duplicated in this table.';
