-- Ensure the scheduled trial voucher email cron has a shared secret to send.
-- The secret value is generated inside Postgres and is not stored in this repo.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.secrets
    WHERE name = 'trial_voucher_cron_secret'
  ) THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(48), 'base64'),
      'trial_voucher_cron_secret',
      'Secret used by pg_cron to trigger scheduled trial voucher recipient emails'
    );
  END IF;
END $$;
