/*
  # Fix Always-True RLS Policies

  Replace all "always true for authenticated" write policies with role-restricted ones.

  Access patterns:
  - admin only: aircraft, aircraft_documents, aircraft_rates, booking_field_settings,
    booking_rules_settings, calendar_settings, flight_log_field_settings, flight_types,
    invitations, invoice_items, invoices, maintenance_*, notification_settings,
    organisation_settings, payment_methods, safety_compliance_settings,
    safety_report_categories, syllabi, syllabus_items, syllabus_sequences,
    training_template_items, training_templates, user_roles
  - admin+instructor: bookings, booking_conflicts, defects, defect_history,
    flight_logs, student_syllabi, training_records, training_sequence_results,
    maintenance_completions, maintenance_audit_log, notifications
  - admin+instructor+self: instructor_absences, instructor_schedule_changes,
    instructor_weekly_schedules
*/

-- AIRCRAFT
DROP POLICY IF EXISTS "Authenticated users can insert aircraft" ON aircraft;
DROP POLICY IF EXISTS "Authenticated users can update aircraft" ON aircraft;
DROP POLICY IF EXISTS "Authenticated users can delete aircraft" ON aircraft;
CREATE POLICY "Admins can insert aircraft" ON aircraft FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update aircraft" ON aircraft FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete aircraft" ON aircraft FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- AIRCRAFT_DOCUMENTS
DROP POLICY IF EXISTS "Authenticated users can insert aircraft documents" ON aircraft_documents;
DROP POLICY IF EXISTS "Authenticated users can update aircraft documents" ON aircraft_documents;
DROP POLICY IF EXISTS "Authenticated users can delete aircraft documents" ON aircraft_documents;
CREATE POLICY "Admins can insert aircraft documents" ON aircraft_documents FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update aircraft documents" ON aircraft_documents FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete aircraft documents" ON aircraft_documents FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- AIRCRAFT_RATES
DROP POLICY IF EXISTS "Authenticated users can insert aircraft rates" ON aircraft_rates;
DROP POLICY IF EXISTS "Authenticated users can update aircraft rates" ON aircraft_rates;
DROP POLICY IF EXISTS "Authenticated users can delete aircraft rates" ON aircraft_rates;
CREATE POLICY "Admins can insert aircraft rates" ON aircraft_rates FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update aircraft rates" ON aircraft_rates FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete aircraft rates" ON aircraft_rates FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- BOOKING_CONFLICTS
DROP POLICY IF EXISTS "Authenticated users can insert booking_conflicts" ON booking_conflicts;
DROP POLICY IF EXISTS "Authenticated users can update booking_conflicts" ON booking_conflicts;
CREATE POLICY "Admins and instructors can insert booking_conflicts" ON booking_conflicts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins and instructors can update booking_conflicts" ON booking_conflicts FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));

-- BOOKING_FIELD_SETTINGS
DROP POLICY IF EXISTS "Authenticated users can manage booking field settings" ON booking_field_settings;
DROP POLICY IF EXISTS "Authenticated users can update booking field settings" ON booking_field_settings;
DROP POLICY IF EXISTS "Authenticated users can delete booking field settings" ON booking_field_settings;
CREATE POLICY "Admins can insert booking field settings" ON booking_field_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update booking field settings" ON booking_field_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete booking field settings" ON booking_field_settings FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- BOOKING_RULES_SETTINGS
DROP POLICY IF EXISTS "Authenticated users can insert booking_rules_settings" ON booking_rules_settings;
DROP POLICY IF EXISTS "Authenticated users can update booking_rules_settings" ON booking_rules_settings;
CREATE POLICY "Admins can insert booking_rules_settings" ON booking_rules_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update booking_rules_settings" ON booking_rules_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- BOOKINGS
DROP POLICY IF EXISTS "Authenticated users can insert bookings" ON bookings;
DROP POLICY IF EXISTS "Authenticated users can update bookings" ON bookings;
DROP POLICY IF EXISTS "Authenticated users can delete bookings" ON bookings;
CREATE POLICY "Authenticated users can create bookings" ON bookings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and instructors can update any booking" ON bookings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR student_id = auth.uid())
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR student_id = auth.uid());
CREATE POLICY "Admins and instructors can delete bookings" ON bookings FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR student_id = auth.uid());

-- CALENDAR_SETTINGS
DROP POLICY IF EXISTS "Authenticated users can insert calendar_settings" ON calendar_settings;
DROP POLICY IF EXISTS "Authenticated users can update calendar_settings" ON calendar_settings;
CREATE POLICY "Admins can insert calendar_settings" ON calendar_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update calendar_settings" ON calendar_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- DEFECT_HISTORY
DROP POLICY IF EXISTS "Authenticated users can insert defect_history" ON defect_history;
CREATE POLICY "Admins and instructors can insert defect_history" ON defect_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));

-- DEFECTS
DROP POLICY IF EXISTS "All authenticated users can report defects" ON defects;
DROP POLICY IF EXISTS "Authenticated users can insert defects" ON defects;
DROP POLICY IF EXISTS "Authenticated users can update defects" ON defects;
DROP POLICY IF EXISTS "Authenticated users can delete defects" ON defects;
CREATE POLICY "Authenticated users can report defects" ON defects FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and instructors can update defects" ON defects FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins can delete defects" ON defects FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- FLIGHT_LOG_FIELD_SETTINGS
DROP POLICY IF EXISTS "Authenticated users can insert flight_log_field_settings" ON flight_log_field_settings;
DROP POLICY IF EXISTS "Authenticated users can update flight_log_field_settings" ON flight_log_field_settings;
CREATE POLICY "Admins can insert flight_log_field_settings" ON flight_log_field_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update flight_log_field_settings" ON flight_log_field_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- FLIGHT_LOGS
DROP POLICY IF EXISTS "Authenticated users can insert flight logs" ON flight_logs;
DROP POLICY IF EXISTS "Authenticated users can update flight logs" ON flight_logs;
DROP POLICY IF EXISTS "Authenticated users can delete flight logs" ON flight_logs;
CREATE POLICY "Admins and instructors can insert flight logs" ON flight_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins and instructors can update flight logs" ON flight_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins can delete flight logs" ON flight_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- FLIGHT_TYPES
DROP POLICY IF EXISTS "Authenticated users can insert flight_types" ON flight_types;
DROP POLICY IF EXISTS "Authenticated users can update flight_types" ON flight_types;
DROP POLICY IF EXISTS "Authenticated users can delete flight_types" ON flight_types;
CREATE POLICY "Admins can insert flight_types" ON flight_types FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update flight_types" ON flight_types FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete flight_types" ON flight_types FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- INSTRUCTOR_ABSENCES
DROP POLICY IF EXISTS "Authenticated users can insert instructor_absences" ON instructor_absences;
DROP POLICY IF EXISTS "Authenticated users can update instructor_absences" ON instructor_absences;
DROP POLICY IF EXISTS "Authenticated users can delete instructor_absences" ON instructor_absences;
CREATE POLICY "Admins and instructors can insert instructor_absences" ON instructor_absences FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());
CREATE POLICY "Admins and instructors can update instructor_absences" ON instructor_absences FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid())
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());
CREATE POLICY "Admins and instructors can delete instructor_absences" ON instructor_absences FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());

-- INSTRUCTOR_SCHEDULE_CHANGES
DROP POLICY IF EXISTS "Authenticated users can insert instructor_schedule_changes" ON instructor_schedule_changes;
DROP POLICY IF EXISTS "Authenticated users can update instructor_schedule_changes" ON instructor_schedule_changes;
DROP POLICY IF EXISTS "Authenticated users can delete instructor_schedule_changes" ON instructor_schedule_changes;
CREATE POLICY "Admins and instructors can insert instructor_schedule_changes" ON instructor_schedule_changes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());
CREATE POLICY "Admins and instructors can update instructor_schedule_changes" ON instructor_schedule_changes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid())
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());
CREATE POLICY "Admins and instructors can delete instructor_schedule_changes" ON instructor_schedule_changes FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());

-- INSTRUCTOR_WEEKLY_SCHEDULES
DROP POLICY IF EXISTS "Authenticated users can insert instructor_weekly_schedules" ON instructor_weekly_schedules;
DROP POLICY IF EXISTS "Authenticated users can update instructor_weekly_schedules" ON instructor_weekly_schedules;
DROP POLICY IF EXISTS "Authenticated users can delete instructor_weekly_schedules" ON instructor_weekly_schedules;
CREATE POLICY "Admins and instructors can insert instructor_weekly_schedules" ON instructor_weekly_schedules FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());
CREATE POLICY "Admins and instructors can update instructor_weekly_schedules" ON instructor_weekly_schedules FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid())
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());
CREATE POLICY "Admins and instructors can delete instructor_weekly_schedules" ON instructor_weekly_schedules FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')) OR instructor_id = auth.uid());

-- INVITATIONS
DROP POLICY IF EXISTS "Authenticated users can insert invitations" ON invitations;
DROP POLICY IF EXISTS "Authenticated users can update invitations" ON invitations;
DROP POLICY IF EXISTS "Authenticated users can delete invitations" ON invitations;
CREATE POLICY "Admins can insert invitations" ON invitations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update invitations" ON invitations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete invitations" ON invitations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- INVOICE_ITEMS
DROP POLICY IF EXISTS "Authenticated users can insert invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Authenticated users can update invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Authenticated users can delete invoice items" ON invoice_items;
CREATE POLICY "Admins can insert invoice items" ON invoice_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update invoice items" ON invoice_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete invoice items" ON invoice_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- INVOICES
DROP POLICY IF EXISTS "Authenticated users can insert invoices" ON invoices;
DROP POLICY IF EXISTS "Authenticated users can update invoices" ON invoices;
DROP POLICY IF EXISTS "Authenticated users can delete invoices" ON invoices;
CREATE POLICY "Admins can insert invoices" ON invoices FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update invoices" ON invoices FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete invoices" ON invoices FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- MAINTENANCE_AUDIT_LOG
DROP POLICY IF EXISTS "Authenticated users can insert maintenance_audit_log" ON maintenance_audit_log;
CREATE POLICY "Admins and instructors can insert maintenance_audit_log" ON maintenance_audit_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));

-- MAINTENANCE_COMPLETIONS
DROP POLICY IF EXISTS "Authenticated users can insert maintenance_completions" ON maintenance_completions;
DROP POLICY IF EXISTS "Authenticated users can update maintenance_completions" ON maintenance_completions;
CREATE POLICY "Admins and instructors can insert maintenance_completions" ON maintenance_completions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins and instructors can update maintenance_completions" ON maintenance_completions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));

-- MAINTENANCE_MILESTONE_TEMPLATES
DROP POLICY IF EXISTS "Authenticated users can insert maintenance_milestone_templates" ON maintenance_milestone_templates;
DROP POLICY IF EXISTS "Authenticated users can update maintenance_milestone_templates" ON maintenance_milestone_templates;
DROP POLICY IF EXISTS "Authenticated users can delete maintenance_milestone_templates" ON maintenance_milestone_templates;
CREATE POLICY "Admins can insert maintenance_milestone_templates" ON maintenance_milestone_templates FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update maintenance_milestone_templates" ON maintenance_milestone_templates FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete maintenance_milestone_templates" ON maintenance_milestone_templates FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- MAINTENANCE_MILESTONES
DROP POLICY IF EXISTS "Authenticated users can insert maintenance milestones" ON maintenance_milestones;
DROP POLICY IF EXISTS "Authenticated users can update maintenance milestones" ON maintenance_milestones;
DROP POLICY IF EXISTS "Authenticated users can delete maintenance milestones" ON maintenance_milestones;
CREATE POLICY "Admins can insert maintenance milestones" ON maintenance_milestones FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update maintenance milestones" ON maintenance_milestones FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete maintenance milestones" ON maintenance_milestones FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- MAINTENANCE_SETTINGS
DROP POLICY IF EXISTS "Authenticated users can insert maintenance_settings" ON maintenance_settings;
DROP POLICY IF EXISTS "Authenticated users can update maintenance_settings" ON maintenance_settings;
CREATE POLICY "Admins can insert maintenance_settings" ON maintenance_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update maintenance_settings" ON maintenance_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- NOTIFICATION_SETTINGS (global org settings, no user_id column)
DROP POLICY IF EXISTS "Authenticated users can insert notification_settings" ON notification_settings;
DROP POLICY IF EXISTS "Authenticated users can update notification_settings" ON notification_settings;
CREATE POLICY "Admins can insert notification_settings" ON notification_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update notification_settings" ON notification_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- NOTIFICATIONS
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON notifications;
CREATE POLICY "Admins and instructors can insert notifications" ON notifications FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));

-- ORGANISATION_SETTINGS
DROP POLICY IF EXISTS "Authenticated users can insert organisation_settings" ON organisation_settings;
DROP POLICY IF EXISTS "Authenticated users can update organisation_settings" ON organisation_settings;
CREATE POLICY "Admins can insert organisation_settings" ON organisation_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update organisation_settings" ON organisation_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- PAYMENT_METHODS
DROP POLICY IF EXISTS "Authenticated users can insert payment_methods" ON payment_methods;
DROP POLICY IF EXISTS "Authenticated users can update payment_methods" ON payment_methods;
DROP POLICY IF EXISTS "Authenticated users can delete payment_methods" ON payment_methods;
CREATE POLICY "Admins can insert payment_methods" ON payment_methods FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update payment_methods" ON payment_methods FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete payment_methods" ON payment_methods FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- SAFETY_COMPLIANCE_SETTINGS
DROP POLICY IF EXISTS "Authenticated users can insert safety_compliance_settings" ON safety_compliance_settings;
DROP POLICY IF EXISTS "Authenticated users can update safety_compliance_settings" ON safety_compliance_settings;
CREATE POLICY "Admins can insert safety_compliance_settings" ON safety_compliance_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update safety_compliance_settings" ON safety_compliance_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- SAFETY_REPORT_CATEGORIES
DROP POLICY IF EXISTS "Authenticated users can insert safety_report_categories" ON safety_report_categories;
DROP POLICY IF EXISTS "Authenticated users can update safety_report_categories" ON safety_report_categories;
DROP POLICY IF EXISTS "Authenticated users can delete safety_report_categories" ON safety_report_categories;
CREATE POLICY "Admins can insert safety_report_categories" ON safety_report_categories FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update safety_report_categories" ON safety_report_categories FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete safety_report_categories" ON safety_report_categories FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- STUDENT_SYLLABI
DROP POLICY IF EXISTS "Authenticated users can insert student_syllabi" ON student_syllabi;
DROP POLICY IF EXISTS "Authenticated users can update student_syllabi" ON student_syllabi;
DROP POLICY IF EXISTS "Authenticated users can delete student_syllabi" ON student_syllabi;
CREATE POLICY "Admins and instructors can insert student_syllabi" ON student_syllabi FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins and instructors can update student_syllabi" ON student_syllabi FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins and instructors can delete student_syllabi" ON student_syllabi FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));

-- SYLLABI
DROP POLICY IF EXISTS "Authenticated users can insert syllabi" ON syllabi;
DROP POLICY IF EXISTS "Authenticated users can update syllabi" ON syllabi;
DROP POLICY IF EXISTS "Authenticated users can delete syllabi" ON syllabi;
CREATE POLICY "Admins can insert syllabi" ON syllabi FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update syllabi" ON syllabi FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete syllabi" ON syllabi FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- SYLLABUS_ITEMS
DROP POLICY IF EXISTS "Authenticated users can insert syllabus_items" ON syllabus_items;
DROP POLICY IF EXISTS "Authenticated users can update syllabus_items" ON syllabus_items;
DROP POLICY IF EXISTS "Authenticated users can delete syllabus_items" ON syllabus_items;
CREATE POLICY "Admins can insert syllabus_items" ON syllabus_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update syllabus_items" ON syllabus_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete syllabus_items" ON syllabus_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- SYLLABUS_SEQUENCES
DROP POLICY IF EXISTS "Authenticated users can insert syllabus sequences" ON syllabus_sequences;
DROP POLICY IF EXISTS "Authenticated users can update syllabus sequences" ON syllabus_sequences;
DROP POLICY IF EXISTS "Authenticated users can delete syllabus sequences" ON syllabus_sequences;
CREATE POLICY "Admins can insert syllabus sequences" ON syllabus_sequences FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update syllabus sequences" ON syllabus_sequences FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete syllabus sequences" ON syllabus_sequences FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- TRAINING_RECORDS
DROP POLICY IF EXISTS "Authenticated users can insert training records" ON training_records;
DROP POLICY IF EXISTS "Authenticated users can update training records" ON training_records;
DROP POLICY IF EXISTS "Authenticated users can delete training records" ON training_records;
CREATE POLICY "Admins and instructors can insert training records" ON training_records FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins and instructors can update training records" ON training_records FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins can delete training records" ON training_records FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- TRAINING_SEQUENCE_RESULTS
DROP POLICY IF EXISTS "Authenticated users can insert sequences" ON training_sequence_results;
DROP POLICY IF EXISTS "Authenticated users can update sequences" ON training_sequence_results;
DROP POLICY IF EXISTS "Authenticated users can delete sequences" ON training_sequence_results;
CREATE POLICY "Admins and instructors can insert training_sequence_results" ON training_sequence_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins and instructors can update training_sequence_results" ON training_sequence_results FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','instructor','senior_instructor')));
CREATE POLICY "Admins can delete training_sequence_results" ON training_sequence_results FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- TRAINING_TEMPLATE_ITEMS
DROP POLICY IF EXISTS "Authenticated users can insert training_template_items" ON training_template_items;
DROP POLICY IF EXISTS "Authenticated users can update training_template_items" ON training_template_items;
DROP POLICY IF EXISTS "Authenticated users can delete training_template_items" ON training_template_items;
CREATE POLICY "Admins can insert training_template_items" ON training_template_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update training_template_items" ON training_template_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete training_template_items" ON training_template_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- TRAINING_TEMPLATES
DROP POLICY IF EXISTS "Authenticated users can insert training_templates" ON training_templates;
DROP POLICY IF EXISTS "Authenticated users can update training_templates" ON training_templates;
DROP POLICY IF EXISTS "Authenticated users can delete training_templates" ON training_templates;
CREATE POLICY "Admins can insert training_templates" ON training_templates FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update training_templates" ON training_templates FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete training_templates" ON training_templates FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- USER_ROLES
DROP POLICY IF EXISTS "Authenticated users can insert user_roles" ON user_roles;
DROP POLICY IF EXISTS "Authenticated users can update user_roles" ON user_roles;
DROP POLICY IF EXISTS "Authenticated users can delete user_roles" ON user_roles;
CREATE POLICY "Admins can insert user_roles" ON user_roles FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update user_roles" ON user_roles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete user_roles" ON user_roles FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
