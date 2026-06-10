-- Automatically send trial flight voucher emails that were scheduled for a future time.
-- Supabase Cron invokes the Edge Function every five minutes; the function only sends
-- recipient-directed vouchers that are issued, due, and not already delivered.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

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
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"action":"send-due"}'::jsonb
    ) AS request_id;
  $$
);
