/*
  # Create remaining missing tables

  ## Summary
  Creates all tables that are referenced by the application but do not yet exist.
  Skips tables that were already created in previous migrations.

  ## New Tables
  - user_roles, defect_history, maintenance_milestone_templates, maintenance_settings
  - maintenance_completions, maintenance_audit_log, organisation_settings
  - calendar_settings, booking_rules_settings, notification_settings
  - safety_compliance_settings, safety_report_categories, flight_log_field_settings
  - user_preferences, flight_types, payment_methods, booking_conflicts
  - instructor_weekly_schedules, instructor_absences, instructor_schedule_changes
  - syllabi, syllabus_items, student_syllabi, training_templates, training_template_items

  ## Security
  - RLS enabled on all tables with appropriate policies
*/

-- user_roles
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_roles' AND policyname='Authenticated users can read user_roles') THEN
    CREATE POLICY "Authenticated users can read user_roles" ON user_roles FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_roles' AND policyname='Authenticated users can insert user_roles') THEN
    CREATE POLICY "Authenticated users can insert user_roles" ON user_roles FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_roles' AND policyname='Authenticated users can update user_roles') THEN
    CREATE POLICY "Authenticated users can update user_roles" ON user_roles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_roles' AND policyname='Authenticated users can delete user_roles') THEN
    CREATE POLICY "Authenticated users can delete user_roles" ON user_roles FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- Backfill user_roles from users.role
INSERT INTO user_roles (user_id, role)
SELECT id, role FROM users
ON CONFLICT (user_id, role) DO NOTHING;

-- defect_history
CREATE TABLE IF NOT EXISTS defect_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id uuid NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES users(id),
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_at timestamptz DEFAULT now()
);
ALTER TABLE defect_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='defect_history' AND policyname='Authenticated users can read defect_history') THEN
    CREATE POLICY "Authenticated users can read defect_history" ON defect_history FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='defect_history' AND policyname='Authenticated users can insert defect_history') THEN
    CREATE POLICY "Authenticated users can insert defect_history" ON defect_history FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- maintenance_milestone_templates
CREATE TABLE IF NOT EXISTS maintenance_milestone_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  due_condition text,
  due_value text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE maintenance_milestone_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_milestone_templates' AND policyname='Authenticated users can read maintenance_milestone_templates') THEN
    CREATE POLICY "Authenticated users can read maintenance_milestone_templates" ON maintenance_milestone_templates FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_milestone_templates' AND policyname='Authenticated users can insert maintenance_milestone_templates') THEN
    CREATE POLICY "Authenticated users can insert maintenance_milestone_templates" ON maintenance_milestone_templates FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_milestone_templates' AND policyname='Authenticated users can update maintenance_milestone_templates') THEN
    CREATE POLICY "Authenticated users can update maintenance_milestone_templates" ON maintenance_milestone_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_milestone_templates' AND policyname='Authenticated users can delete maintenance_milestone_templates') THEN
    CREATE POLICY "Authenticated users can delete maintenance_milestone_templates" ON maintenance_milestone_templates FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- maintenance_settings
CREATE TABLE IF NOT EXISTS maintenance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE maintenance_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_settings' AND policyname='Authenticated users can read maintenance_settings') THEN
    CREATE POLICY "Authenticated users can read maintenance_settings" ON maintenance_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_settings' AND policyname='Authenticated users can insert maintenance_settings') THEN
    CREATE POLICY "Authenticated users can insert maintenance_settings" ON maintenance_settings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_settings' AND policyname='Authenticated users can update maintenance_settings') THEN
    CREATE POLICY "Authenticated users can update maintenance_settings" ON maintenance_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- maintenance_completions
CREATE TABLE IF NOT EXISTS maintenance_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid REFERENCES maintenance_milestones(id) ON DELETE CASCADE,
  aircraft_id uuid REFERENCES aircraft(id) ON DELETE CASCADE,
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz DEFAULT now(),
  notes text,
  tach_hours numeric,
  hobbs_hours numeric
);
ALTER TABLE maintenance_completions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_completions' AND policyname='Authenticated users can read maintenance_completions') THEN
    CREATE POLICY "Authenticated users can read maintenance_completions" ON maintenance_completions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_completions' AND policyname='Authenticated users can insert maintenance_completions') THEN
    CREATE POLICY "Authenticated users can insert maintenance_completions" ON maintenance_completions FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_completions' AND policyname='Authenticated users can update maintenance_completions') THEN
    CREATE POLICY "Authenticated users can update maintenance_completions" ON maintenance_completions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- maintenance_audit_log
CREATE TABLE IF NOT EXISTS maintenance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid REFERENCES aircraft(id) ON DELETE CASCADE,
  action text NOT NULL,
  performed_by uuid REFERENCES users(id),
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE maintenance_audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_audit_log' AND policyname='Authenticated users can read maintenance_audit_log') THEN
    CREATE POLICY "Authenticated users can read maintenance_audit_log" ON maintenance_audit_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_audit_log' AND policyname='Authenticated users can insert maintenance_audit_log') THEN
    CREATE POLICY "Authenticated users can insert maintenance_audit_log" ON maintenance_audit_log FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- organisation_settings
CREATE TABLE IF NOT EXISTS organisation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE organisation_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organisation_settings' AND policyname='Authenticated users can read organisation_settings') THEN
    CREATE POLICY "Authenticated users can read organisation_settings" ON organisation_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organisation_settings' AND policyname='Authenticated users can insert organisation_settings') THEN
    CREATE POLICY "Authenticated users can insert organisation_settings" ON organisation_settings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organisation_settings' AND policyname='Authenticated users can update organisation_settings') THEN
    CREATE POLICY "Authenticated users can update organisation_settings" ON organisation_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- calendar_settings
CREATE TABLE IF NOT EXISTS calendar_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE calendar_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='calendar_settings' AND policyname='Authenticated users can read calendar_settings') THEN
    CREATE POLICY "Authenticated users can read calendar_settings" ON calendar_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='calendar_settings' AND policyname='Authenticated users can insert calendar_settings') THEN
    CREATE POLICY "Authenticated users can insert calendar_settings" ON calendar_settings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='calendar_settings' AND policyname='Authenticated users can update calendar_settings') THEN
    CREATE POLICY "Authenticated users can update calendar_settings" ON calendar_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- booking_rules_settings
CREATE TABLE IF NOT EXISTS booking_rules_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE booking_rules_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='booking_rules_settings' AND policyname='Authenticated users can read booking_rules_settings') THEN
    CREATE POLICY "Authenticated users can read booking_rules_settings" ON booking_rules_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='booking_rules_settings' AND policyname='Authenticated users can insert booking_rules_settings') THEN
    CREATE POLICY "Authenticated users can insert booking_rules_settings" ON booking_rules_settings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='booking_rules_settings' AND policyname='Authenticated users can update booking_rules_settings') THEN
    CREATE POLICY "Authenticated users can update booking_rules_settings" ON booking_rules_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- notification_settings
CREATE TABLE IF NOT EXISTS notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_settings' AND policyname='Authenticated users can read notification_settings') THEN
    CREATE POLICY "Authenticated users can read notification_settings" ON notification_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_settings' AND policyname='Authenticated users can insert notification_settings') THEN
    CREATE POLICY "Authenticated users can insert notification_settings" ON notification_settings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_settings' AND policyname='Authenticated users can update notification_settings') THEN
    CREATE POLICY "Authenticated users can update notification_settings" ON notification_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- safety_compliance_settings
CREATE TABLE IF NOT EXISTS safety_compliance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE safety_compliance_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='safety_compliance_settings' AND policyname='Authenticated users can read safety_compliance_settings') THEN
    CREATE POLICY "Authenticated users can read safety_compliance_settings" ON safety_compliance_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='safety_compliance_settings' AND policyname='Authenticated users can insert safety_compliance_settings') THEN
    CREATE POLICY "Authenticated users can insert safety_compliance_settings" ON safety_compliance_settings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='safety_compliance_settings' AND policyname='Authenticated users can update safety_compliance_settings') THEN
    CREATE POLICY "Authenticated users can update safety_compliance_settings" ON safety_compliance_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- safety_report_categories
CREATE TABLE IF NOT EXISTS safety_report_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE safety_report_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='safety_report_categories' AND policyname='Authenticated users can read safety_report_categories') THEN
    CREATE POLICY "Authenticated users can read safety_report_categories" ON safety_report_categories FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='safety_report_categories' AND policyname='Authenticated users can insert safety_report_categories') THEN
    CREATE POLICY "Authenticated users can insert safety_report_categories" ON safety_report_categories FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='safety_report_categories' AND policyname='Authenticated users can update safety_report_categories') THEN
    CREATE POLICY "Authenticated users can update safety_report_categories" ON safety_report_categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='safety_report_categories' AND policyname='Authenticated users can delete safety_report_categories') THEN
    CREATE POLICY "Authenticated users can delete safety_report_categories" ON safety_report_categories FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- flight_log_field_settings
CREATE TABLE IF NOT EXISTS flight_log_field_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE flight_log_field_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='flight_log_field_settings' AND policyname='Authenticated users can read flight_log_field_settings') THEN
    CREATE POLICY "Authenticated users can read flight_log_field_settings" ON flight_log_field_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='flight_log_field_settings' AND policyname='Authenticated users can insert flight_log_field_settings') THEN
    CREATE POLICY "Authenticated users can insert flight_log_field_settings" ON flight_log_field_settings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='flight_log_field_settings' AND policyname='Authenticated users can update flight_log_field_settings') THEN
    CREATE POLICY "Authenticated users can update flight_log_field_settings" ON flight_log_field_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- user_preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  preferences jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_preferences' AND policyname='Users can read own preferences') THEN
    CREATE POLICY "Users can read own preferences" ON user_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_preferences' AND policyname='Users can insert own preferences') THEN
    CREATE POLICY "Users can insert own preferences" ON user_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_preferences' AND policyname='Users can update own preferences') THEN
    CREATE POLICY "Users can update own preferences" ON user_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- flight_types
CREATE TABLE IF NOT EXISTS flight_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE flight_types ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='flight_types' AND policyname='Authenticated users can read flight_types') THEN
    CREATE POLICY "Authenticated users can read flight_types" ON flight_types FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='flight_types' AND policyname='Authenticated users can insert flight_types') THEN
    CREATE POLICY "Authenticated users can insert flight_types" ON flight_types FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='flight_types' AND policyname='Authenticated users can update flight_types') THEN
    CREATE POLICY "Authenticated users can update flight_types" ON flight_types FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='flight_types' AND policyname='Authenticated users can delete flight_types') THEN
    CREATE POLICY "Authenticated users can delete flight_types" ON flight_types FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- payment_methods
CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_methods' AND policyname='Authenticated users can read payment_methods') THEN
    CREATE POLICY "Authenticated users can read payment_methods" ON payment_methods FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_methods' AND policyname='Authenticated users can insert payment_methods') THEN
    CREATE POLICY "Authenticated users can insert payment_methods" ON payment_methods FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_methods' AND policyname='Authenticated users can update payment_methods') THEN
    CREATE POLICY "Authenticated users can update payment_methods" ON payment_methods FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_methods' AND policyname='Authenticated users can delete payment_methods') THEN
    CREATE POLICY "Authenticated users can delete payment_methods" ON payment_methods FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- booking_conflicts
CREATE TABLE IF NOT EXISTS booking_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  conflicting_booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  conflict_type text,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE booking_conflicts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='booking_conflicts' AND policyname='Authenticated users can read booking_conflicts') THEN
    CREATE POLICY "Authenticated users can read booking_conflicts" ON booking_conflicts FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='booking_conflicts' AND policyname='Authenticated users can insert booking_conflicts') THEN
    CREATE POLICY "Authenticated users can insert booking_conflicts" ON booking_conflicts FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='booking_conflicts' AND policyname='Authenticated users can update booking_conflicts') THEN
    CREATE POLICY "Authenticated users can update booking_conflicts" ON booking_conflicts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- instructor_weekly_schedules
CREATE TABLE IF NOT EXISTS instructor_weekly_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL,
  start_time time,
  end_time time,
  start_time_2 time,
  end_time_2 time,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE instructor_weekly_schedules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_weekly_schedules' AND policyname='Authenticated users can read instructor_weekly_schedules') THEN
    CREATE POLICY "Authenticated users can read instructor_weekly_schedules" ON instructor_weekly_schedules FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_weekly_schedules' AND policyname='Authenticated users can insert instructor_weekly_schedules') THEN
    CREATE POLICY "Authenticated users can insert instructor_weekly_schedules" ON instructor_weekly_schedules FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_weekly_schedules' AND policyname='Authenticated users can update instructor_weekly_schedules') THEN
    CREATE POLICY "Authenticated users can update instructor_weekly_schedules" ON instructor_weekly_schedules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_weekly_schedules' AND policyname='Authenticated users can delete instructor_weekly_schedules') THEN
    CREATE POLICY "Authenticated users can delete instructor_weekly_schedules" ON instructor_weekly_schedules FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- instructor_absences
CREATE TABLE IF NOT EXISTS instructor_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE instructor_absences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_absences' AND policyname='Authenticated users can read instructor_absences') THEN
    CREATE POLICY "Authenticated users can read instructor_absences" ON instructor_absences FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_absences' AND policyname='Authenticated users can insert instructor_absences') THEN
    CREATE POLICY "Authenticated users can insert instructor_absences" ON instructor_absences FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_absences' AND policyname='Authenticated users can update instructor_absences') THEN
    CREATE POLICY "Authenticated users can update instructor_absences" ON instructor_absences FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_absences' AND policyname='Authenticated users can delete instructor_absences') THEN
    CREATE POLICY "Authenticated users can delete instructor_absences" ON instructor_absences FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- instructor_schedule_changes
CREATE TABLE IF NOT EXISTS instructor_schedule_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  change_date date NOT NULL,
  start_time time,
  end_time time,
  start_time_2 time,
  end_time_2 time,
  is_available boolean DEFAULT true,
  reason text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE instructor_schedule_changes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_schedule_changes' AND policyname='Authenticated users can read instructor_schedule_changes') THEN
    CREATE POLICY "Authenticated users can read instructor_schedule_changes" ON instructor_schedule_changes FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_schedule_changes' AND policyname='Authenticated users can insert instructor_schedule_changes') THEN
    CREATE POLICY "Authenticated users can insert instructor_schedule_changes" ON instructor_schedule_changes FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_schedule_changes' AND policyname='Authenticated users can update instructor_schedule_changes') THEN
    CREATE POLICY "Authenticated users can update instructor_schedule_changes" ON instructor_schedule_changes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='instructor_schedule_changes' AND policyname='Authenticated users can delete instructor_schedule_changes') THEN
    CREATE POLICY "Authenticated users can delete instructor_schedule_changes" ON instructor_schedule_changes FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- syllabi
CREATE TABLE IF NOT EXISTS syllabi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE syllabi ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='syllabi' AND policyname='Authenticated users can read syllabi') THEN
    CREATE POLICY "Authenticated users can read syllabi" ON syllabi FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='syllabi' AND policyname='Authenticated users can insert syllabi') THEN
    CREATE POLICY "Authenticated users can insert syllabi" ON syllabi FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='syllabi' AND policyname='Authenticated users can update syllabi') THEN
    CREATE POLICY "Authenticated users can update syllabi" ON syllabi FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='syllabi' AND policyname='Authenticated users can delete syllabi') THEN
    CREATE POLICY "Authenticated users can delete syllabi" ON syllabi FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- syllabus_items
CREATE TABLE IF NOT EXISTS syllabus_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_id uuid NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE syllabus_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='syllabus_items' AND policyname='Authenticated users can read syllabus_items') THEN
    CREATE POLICY "Authenticated users can read syllabus_items" ON syllabus_items FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='syllabus_items' AND policyname='Authenticated users can insert syllabus_items') THEN
    CREATE POLICY "Authenticated users can insert syllabus_items" ON syllabus_items FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='syllabus_items' AND policyname='Authenticated users can update syllabus_items') THEN
    CREATE POLICY "Authenticated users can update syllabus_items" ON syllabus_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='syllabus_items' AND policyname='Authenticated users can delete syllabus_items') THEN
    CREATE POLICY "Authenticated users can delete syllabus_items" ON syllabus_items FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- student_syllabi
CREATE TABLE IF NOT EXISTS student_syllabi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  syllabus_id uuid NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(student_id, syllabus_id)
);
ALTER TABLE student_syllabi ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='student_syllabi' AND policyname='Authenticated users can read student_syllabi') THEN
    CREATE POLICY "Authenticated users can read student_syllabi" ON student_syllabi FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='student_syllabi' AND policyname='Authenticated users can insert student_syllabi') THEN
    CREATE POLICY "Authenticated users can insert student_syllabi" ON student_syllabi FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='student_syllabi' AND policyname='Authenticated users can update student_syllabi') THEN
    CREATE POLICY "Authenticated users can update student_syllabi" ON student_syllabi FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='student_syllabi' AND policyname='Authenticated users can delete student_syllabi') THEN
    CREATE POLICY "Authenticated users can delete student_syllabi" ON student_syllabi FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- training_templates
CREATE TABLE IF NOT EXISTS training_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE training_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_templates' AND policyname='Authenticated users can read training_templates') THEN
    CREATE POLICY "Authenticated users can read training_templates" ON training_templates FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_templates' AND policyname='Authenticated users can insert training_templates') THEN
    CREATE POLICY "Authenticated users can insert training_templates" ON training_templates FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_templates' AND policyname='Authenticated users can update training_templates') THEN
    CREATE POLICY "Authenticated users can update training_templates" ON training_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_templates' AND policyname='Authenticated users can delete training_templates') THEN
    CREATE POLICY "Authenticated users can delete training_templates" ON training_templates FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- training_template_items
CREATE TABLE IF NOT EXISTS training_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES training_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE training_template_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_template_items' AND policyname='Authenticated users can read training_template_items') THEN
    CREATE POLICY "Authenticated users can read training_template_items" ON training_template_items FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_template_items' AND policyname='Authenticated users can insert training_template_items') THEN
    CREATE POLICY "Authenticated users can insert training_template_items" ON training_template_items FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_template_items' AND policyname='Authenticated users can update training_template_items') THEN
    CREATE POLICY "Authenticated users can update training_template_items" ON training_template_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='training_template_items' AND policyname='Authenticated users can delete training_template_items') THEN
    CREATE POLICY "Authenticated users can delete training_template_items" ON training_template_items FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
