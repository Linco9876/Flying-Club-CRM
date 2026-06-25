ALTER TABLE booking_rules_settings
  ADD COLUMN IF NOT EXISTS fatigue_rules_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fatigue_late_finish_time text NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS fatigue_early_start_time text NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS fatigue_min_rest_hours numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS fatigue_max_duty_hours_per_day numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS fatigue_max_flight_hours_per_day numeric NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS fatigue_max_late_finishes_7_days integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS fatigue_include_supervision boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fatigue_block_on_breach boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN booking_rules_settings.fatigue_rules_enabled IS
  'Enables configurable instructor fatigue checks for bookings.';
COMMENT ON COLUMN booking_rules_settings.fatigue_late_finish_time IS
  'Local time at or after which an instructor duty is treated as a late finish.';
COMMENT ON COLUMN booking_rules_settings.fatigue_early_start_time IS
  'Local time before which an instructor duty is treated as an early start.';
COMMENT ON COLUMN booking_rules_settings.fatigue_min_rest_hours IS
  'Minimum rest hours required between instructor duties.';
COMMENT ON COLUMN booking_rules_settings.fatigue_max_duty_hours_per_day IS
  'Maximum span from first instructor duty start to last instructor duty end in a local day.';
COMMENT ON COLUMN booking_rules_settings.fatigue_max_flight_hours_per_day IS
  'Maximum booked instructor flight/supervision hours in a local day.';
COMMENT ON COLUMN booking_rules_settings.fatigue_max_late_finishes_7_days IS
  'Maximum late finishes allowed for an instructor in a rolling 7-day window.';
COMMENT ON COLUMN booking_rules_settings.fatigue_include_supervision IS
  'Counts supervision/instructor allocations as duty for fatigue limits.';
COMMENT ON COLUMN booking_rules_settings.fatigue_block_on_breach IS
  'Blocks bookings when true; otherwise client code may warn only.';
