-- Secure the scheduled trial voucher email sender.
--
-- Before relying on this cron job in production, store the same random value in:
-- 1. Supabase Edge Function secret: TRIAL_VOUCHER_CRON_SECRET
-- 2. Supabase Vault secret named: trial_voucher_cron_secret
--
-- Example Vault setup in SQL editor:
--   select vault.create_secret('replace-with-a-long-random-secret', 'trial_voucher_cron_secret');

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

SELECT cron.unschedule('send-due-trial-voucher-emails')
WHERE EXISTS (
  SELECT 1
  FROM cron.job
  WHERE jobname = 'send-due-trial-voucher-emails'
);

SELECT cron.schedule(
  'send-due-trial-voucher-emails',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://joarmzswpufrduectjse.supabase.co/functions/v1/send-trial-voucher-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'trial_voucher_cron_secret'),
          ''
        )
      ),
      body := '{"action":"send-due"}'::jsonb
    ) AS request_id;
  $$
);
