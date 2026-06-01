/*
  Expand notification settings for CRM-wide alert control.

  These fields are consumed by the Notifications settings screen. Some delivery
  paths, such as email/SMS and scheduled digests, still require provider jobs.
*/

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notifications_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_app_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_change_notification_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS waitlist_notification_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS instructor_absence_notification_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maintenance_due_alert_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS maintenance_due_alert_hours integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS defect_report_notification_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS safety_report_notification_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_request_notification_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS overdue_flight_record_alert_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS daily_ops_digest_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_ops_digest_time time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start time NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_end time NOT NULL DEFAULT '07:00';

INSERT INTO public.notification_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.notification_settings LIMIT 1);
