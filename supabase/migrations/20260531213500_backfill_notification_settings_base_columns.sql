/*
  Backfill older notification_settings tables that were created with a jsonb
  settings payload instead of the explicit columns expected by the app.
*/

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS booking_confirmation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_reminder_24h_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_reminder_2h_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancellation_notification_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maintenance_alert_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS currency_expiry_alert_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

NOTIFY pgrst, 'reload schema';
