/*
  Seed operational maintenance settings and starter milestone templates.

  The live project inherited the JSON settings shape from the Bolt database,
  so keep the defaults inside the existing settings document.
*/

INSERT INTO public.maintenance_settings (settings)
SELECT '{
  "autoGroundOnMajorDefect": true,
  "requireMaintenanceApproval": true,
  "maintenanceReminderDays": 14,
  "defectPhotoRequired": false,
  "urgentReminderHours": 10,
  "upcomingReminderHours": 25,
  "urgentReminderDays": 7,
  "upcomingReminderDays": 30,
  "defaultDefectFilter": "open"
}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.maintenance_settings);

INSERT INTO public.maintenance_milestone_templates (
  title, due_condition, due_value,
  name, type, interval_hours, interval_months, description, is_default
)
SELECT
  values_row.name,
  values_row.type,
  CASE
    WHEN values_row.type = 'calendar' THEN values_row.interval_months::text
    ELSE values_row.interval_hours::text
  END,
  values_row.*
FROM (
  VALUES
    ('50 Hour Check', 'hours', 50::numeric, 0, 'Basic inspection and oil change', true),
    ('100 Hour Check', 'hours', 100::numeric, 0, 'Comprehensive inspection', true),
    ('Annual Inspection', 'calendar', 0::numeric, 12, 'Annual airworthiness inspection', true),
    ('Hose Replacement', 'calendar', 0::numeric, 24, 'Replace fuel and oil hoses', true)
) AS values_row(name, type, interval_hours, interval_months, description, is_default)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.maintenance_milestone_templates existing
  WHERE existing.name = values_row.name
);
