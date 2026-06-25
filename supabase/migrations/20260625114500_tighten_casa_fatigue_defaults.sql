ALTER TABLE booking_rules_settings
  ALTER COLUMN fatigue_min_rest_hours SET DEFAULT 12,
  ALTER COLUMN fatigue_max_duty_hours_per_day SET DEFAULT 11;

UPDATE booking_rules_settings
SET
  fatigue_min_rest_hours = GREATEST(COALESCE(fatigue_min_rest_hours, 12), 12),
  fatigue_max_duty_hours_per_day = LEAST(COALESCE(fatigue_max_duty_hours_per_day, 11), 11),
  fatigue_max_flight_hours_per_day = LEAST(COALESCE(fatigue_max_flight_hours_per_day, 7), 7),
  fatigue_rules_enabled = COALESCE(fatigue_rules_enabled, true),
  fatigue_include_supervision = COALESCE(fatigue_include_supervision, true),
  fatigue_block_on_breach = COALESCE(fatigue_block_on_breach, true),
  updated_at = now()
WHERE
  fatigue_min_rest_hours IS DISTINCT FROM GREATEST(COALESCE(fatigue_min_rest_hours, 12), 12)
  OR fatigue_max_duty_hours_per_day IS DISTINCT FROM LEAST(COALESCE(fatigue_max_duty_hours_per_day, 11), 11)
  OR fatigue_max_flight_hours_per_day IS DISTINCT FROM LEAST(COALESCE(fatigue_max_flight_hours_per_day, 7), 7)
  OR fatigue_rules_enabled IS DISTINCT FROM COALESCE(fatigue_rules_enabled, true)
  OR fatigue_include_supervision IS DISTINCT FROM COALESCE(fatigue_include_supervision, true)
  OR fatigue_block_on_breach IS DISTINCT FROM COALESCE(fatigue_block_on_breach, true);

COMMENT ON COLUMN booking_rules_settings.fatigue_min_rest_hours IS
  'Minimum off-duty hours required between instructor duties. Default 12 hours aligns with CASA CAO 48.1 Appendix 6 flight training controls.';
COMMENT ON COLUMN booking_rules_settings.fatigue_max_duty_hours_per_day IS
  'Local maximum instructor duty span. The application also applies the CASA Appendix 6 FDP start-time table.';
