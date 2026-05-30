/*
  # Expand booking rules settings

  Repairs databases created from the older Bolt JSON settings table and adds
  practical booking guardrails used by the frontend.
*/

ALTER TABLE booking_rules_settings
  ADD COLUMN IF NOT EXISTS min_booking_notice_hours integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_booking_advance_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS allow_double_booking boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_instructor_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancellation_notice_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS enforce_min_notice boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enforce_max_advance boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enforce_cancellation_notice boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prevent_past_bookings boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enforce_max_duration boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_booking_duration_hours integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

INSERT INTO booking_rules_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM booking_rules_settings);

NOTIFY pgrst, 'reload schema';
