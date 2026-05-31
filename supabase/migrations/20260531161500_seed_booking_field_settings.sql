/*
  # Seed booking form fields

  Ensures the settings screen describes the real booking form and includes the
  pilot role used by the portal.
*/

INSERT INTO booking_field_settings (
  field_name, label, is_required, is_visible, applies_to_roles, display_order, help_text
) VALUES
  ('pilot', 'Pilot', true, true, ARRAY['admin','instructor','student','pilot'], 1, 'Pilot or student attached to the booking'),
  ('startDate', 'Start Date', true, true, ARRAY['admin','instructor','student','pilot'], 2, 'Date when the booking begins'),
  ('startTime', 'Start Time', true, true, ARRAY['admin','instructor','student','pilot'], 3, 'Time when the booking begins'),
  ('endDate', 'End Date', true, true, ARRAY['admin','instructor','student','pilot'], 4, 'Date when the booking ends'),
  ('endTime', 'End Time', true, true, ARRAY['admin','instructor','student','pilot'], 5, 'Time when the booking ends'),
  ('aircraft', 'Aircraft', true, true, ARRAY['admin','instructor','student','pilot'], 6, 'Aircraft allocated to the booking'),
  ('instructor', 'Instructor', false, true, ARRAY['admin','instructor','student','pilot'], 7, 'Optional instructor for dual instruction'),
  ('paymentType', 'Flight Type', true, true, ARRAY['admin','instructor','student','pilot'], 8, 'Rate category used for billing'),
  ('notes', 'Notes', false, true, ARRAY['admin','instructor','student','pilot'], 9, 'Lesson details or operational notes')
ON CONFLICT (field_name) DO UPDATE SET
  label = EXCLUDED.label,
  applies_to_roles = CASE
    WHEN NOT ('pilot' = ANY(booking_field_settings.applies_to_roles))
      THEN array_append(booking_field_settings.applies_to_roles, 'pilot')
    ELSE booking_field_settings.applies_to_roles
  END,
  display_order = EXCLUDED.display_order,
  help_text = EXCLUDED.help_text,
  updated_at = now();
