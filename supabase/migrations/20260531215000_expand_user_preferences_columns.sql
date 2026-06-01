/*
  Backfill explicit user_preferences columns for projects that were created with
  only the jsonb preferences payload.
*/

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notifications boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booking_reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS currency_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maintenance_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Australia/Melbourne',
  ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'dd/MM/yyyy',
  ADD COLUMN IF NOT EXISTS time_format text NOT NULL DEFAULT '24h',
  ADD COLUMN IF NOT EXISTS default_calendar_view text NOT NULL DEFAULT 'day',
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'light',
  ADD COLUMN IF NOT EXISTS show_progress_dashboard boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_upcoming_bookings boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_recent_activity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS compact_view boolean NOT NULL DEFAULT false;

UPDATE public.user_preferences
SET
  email_notifications = COALESCE((preferences->>'email_notifications')::boolean, email_notifications),
  sms_notifications = COALESCE((preferences->>'sms_notifications')::boolean, sms_notifications),
  booking_reminders = COALESCE((preferences->>'booking_reminders')::boolean, booking_reminders),
  currency_alerts = COALESCE((preferences->>'currency_alerts')::boolean, currency_alerts),
  maintenance_alerts = COALESCE((preferences->>'maintenance_alerts')::boolean, maintenance_alerts),
  timezone = COALESCE(preferences->>'timezone', timezone),
  date_format = COALESCE(preferences->>'date_format', date_format),
  time_format = COALESCE(preferences->>'time_format', time_format),
  default_calendar_view = COALESCE(preferences->>'default_calendar_view', default_calendar_view),
  theme = COALESCE(preferences->>'theme', theme),
  show_progress_dashboard = COALESCE((preferences->>'show_progress_dashboard')::boolean, show_progress_dashboard),
  show_upcoming_bookings = COALESCE((preferences->>'show_upcoming_bookings')::boolean, show_upcoming_bookings),
  show_recent_activity = COALESCE((preferences->>'show_recent_activity')::boolean, show_recent_activity),
  compact_view = COALESCE((preferences->>'compact_view')::boolean, compact_view)
WHERE preferences IS NOT NULL;

NOTIFY pgrst, 'reload schema';
