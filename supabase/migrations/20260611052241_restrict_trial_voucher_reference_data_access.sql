-- Restrict remaining broad authenticated CRM/reference reads from trial-voucher accounts.
-- Voucher-only users book through the trial-voucher Edge Function, so they do not
-- need direct Data API access to the normal member, settings, safety, syllabus,
-- maintenance, billing, or document reference tables.

DROP POLICY IF EXISTS "Authenticated users can view aircraft documents" ON public.aircraft_documents;
CREATE POLICY "Full portal users can view aircraft documents"
  ON public.aircraft_documents FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can view aircraft rates" ON public.aircraft_rates;
CREATE POLICY "Full portal users can view aircraft rates"
  ON public.aircraft_rates FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read booking_conflicts" ON public.booking_conflicts;
CREATE POLICY "Full portal users can read booking conflicts"
  ON public.booking_conflicts FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "All authenticated users can read booking field settings" ON public.booking_field_settings;
CREATE POLICY "Full portal users can read booking field settings"
  ON public.booking_field_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read booking_rules_settings" ON public.booking_rules_settings;
CREATE POLICY "Full portal users can read booking rules settings"
  ON public.booking_rules_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read calendar_settings" ON public.calendar_settings;
CREATE POLICY "Full portal users can read calendar settings"
  ON public.calendar_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read defect_history" ON public.defect_history;
CREATE POLICY "Full portal users can read defect history"
  ON public.defect_history FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read flight_log_field_settings" ON public.flight_log_field_settings;
CREATE POLICY "Full portal users can read flight log field settings"
  ON public.flight_log_field_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read flight_types" ON public.flight_types;
CREATE POLICY "Full portal users can read flight types"
  ON public.flight_types FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read instructor_absences" ON public.instructor_absences;
CREATE POLICY "Full portal users can read instructor absences"
  ON public.instructor_absences FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read instructor_schedule_changes" ON public.instructor_schedule_changes;
CREATE POLICY "Full portal users can read instructor schedule changes"
  ON public.instructor_schedule_changes FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read instructor_weekly_schedules" ON public.instructor_weekly_schedules;
CREATE POLICY "Full portal users can read instructor weekly schedules"
  ON public.instructor_weekly_schedules FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read lesson_snapshots" ON public.lesson_snapshots;
CREATE POLICY "Full portal users can read lesson snapshots"
  ON public.lesson_snapshots FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read maintenance_completions" ON public.maintenance_completions;
CREATE POLICY "Full portal users can read maintenance completions"
  ON public.maintenance_completions FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read maintenance_milestone_templates" ON public.maintenance_milestone_templates;
CREATE POLICY "Full portal users can read maintenance milestone templates"
  ON public.maintenance_milestone_templates FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can view maintenance milestones" ON public.maintenance_milestones;
CREATE POLICY "Full portal users can view maintenance milestones"
  ON public.maintenance_milestones FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read maintenance_settings" ON public.maintenance_settings;
CREATE POLICY "Full portal users can read maintenance settings"
  ON public.maintenance_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read notification_settings" ON public.notification_settings;
CREATE POLICY "Full portal users can read notification settings"
  ON public.notification_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read organisation settings" ON public.organisation_settings;
CREATE POLICY "Full portal users can read organisation settings"
  ON public.organisation_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read payment_methods" ON public.payment_methods;
CREATE POLICY "Full portal users can read payment methods"
  ON public.payment_methods FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read portal UX settings" ON public.portal_ux_settings;
CREATE POLICY "Full portal users can read portal UX settings"
  ON public.portal_ux_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can view resource settings" ON public.resource_settings;
CREATE POLICY "Full portal users can view resource settings"
  ON public.resource_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can view rooms" ON public.rooms;
CREATE POLICY "Full portal users can view rooms"
  ON public.rooms FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read safety_compliance_settings" ON public.safety_compliance_settings;
CREATE POLICY "Full portal users can read safety compliance settings"
  ON public.safety_compliance_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read safety documents" ON public.safety_documents;
CREATE POLICY "Full portal users can read safety documents"
  ON public.safety_documents FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read safety_report_categories" ON public.safety_report_categories;
CREATE POLICY "Full portal users can read safety report categories"
  ON public.safety_report_categories FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can create safety reports" ON public.safety_reports;
CREATE POLICY "Full portal users can create safety reports"
  ON public.safety_reports FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_has_full_portal_access()
    AND reporter_id = auth.uid()
  );

DROP POLICY IF EXISTS "Authenticated users can read safety reports" ON public.safety_reports;
CREATE POLICY "Full portal users can read relevant safety reports"
  ON public.safety_reports FOR SELECT TO authenticated
  USING (
    public.current_user_has_full_portal_access()
    AND (
      reporter_id = auth.uid()
      OR auth.uid() = ANY (involved_user_ids)
      OR public.current_user_has_staff_role()
    )
  );

DROP POLICY IF EXISTS "Authenticated users can read relevant student exam results" ON public.student_exam_results;
CREATE POLICY "Full users and staff can read relevant student exam results"
  ON public.student_exam_results FOR SELECT TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND (student_id = auth.uid() OR instructor_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Authenticated users can read syllabi" ON public.syllabi;
CREATE POLICY "Full portal users can read syllabi"
  ON public.syllabi FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read syllabus_items" ON public.syllabus_items;
CREATE POLICY "Full portal users can read syllabus items"
  ON public.syllabus_items FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read syllabus matrix requirements" ON public.syllabus_matrix_requirements;
CREATE POLICY "Full portal users can read syllabus matrix requirements"
  ON public.syllabus_matrix_requirements FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read syllabus matrix rows" ON public.syllabus_matrix_rows;
CREATE POLICY "Full portal users can read syllabus matrix rows"
  ON public.syllabus_matrix_rows FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "All authenticated users can read syllabus" ON public.syllabus_sequences;
DROP POLICY IF EXISTS "Authenticated users can read syllabus sequences" ON public.syllabus_sequences;
CREATE POLICY "Full portal users can read syllabus sequences"
  ON public.syllabus_sequences FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read training_courses" ON public.training_courses;
CREATE POLICY "Full portal users can read training courses"
  ON public.training_courses FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read training_lessons" ON public.training_lessons;
CREATE POLICY "Full portal users can read training lessons"
  ON public.training_lessons FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read training syllabus settings" ON public.training_syllabus_settings;
CREATE POLICY "Full portal users can read training syllabus settings"
  ON public.training_syllabus_settings FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read training_template_items" ON public.training_template_items;
CREATE POLICY "Full portal users can read training template items"
  ON public.training_template_items FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read training_templates" ON public.training_templates;
CREATE POLICY "Full portal users can read training templates"
  ON public.training_templates FOR SELECT TO authenticated
  USING (public.current_user_has_full_portal_access());
