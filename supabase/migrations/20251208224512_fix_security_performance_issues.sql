/*
  # Fix Security and Performance Issues

  ## Changes Made

  1. **Add Missing Foreign Key Indexes** (13 indexes)
     - aircraft_documents: aircraft_id, uploaded_by
     - aircraft_rates: aircraft_id
     - endorsements: instructor_id, student_id
     - flight_logs: booking_id
     - invoice_items: invoice_id
     - invoices: student_id
     - maintenance_milestones: aircraft_id
     - training_records: aircraft_id, booking_id
     - training_sequence_results: sequence_id, training_record_id

  2. **Optimize RLS Policies for Performance**
     - Replace `auth.uid()` with `(select auth.uid())` in all policies
     - This prevents re-evaluation of auth functions for each row
     - Affects all tables: users, students, bookings, training_records, syllabus_sequences,
       training_sequence_results, endorsements, defects, invoices, invoice_items, 
       flight_logs, booking_field_settings

  3. **Consolidate Duplicate Policies**
     - Remove redundant permissive policies that overlap
     - Simplify policy management and improve query performance

  ## Performance Impact
  - Foreign key indexes will dramatically improve join performance
  - Optimized RLS policies will scale better with large datasets
  - Reduced policy overhead from consolidated rules
*/

-- =====================================================
-- PART 1: ADD MISSING FOREIGN KEY INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_aircraft_documents_aircraft_id 
  ON aircraft_documents(aircraft_id);

CREATE INDEX IF NOT EXISTS idx_aircraft_documents_uploaded_by 
  ON aircraft_documents(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_aircraft_rates_aircraft_id 
  ON aircraft_rates(aircraft_id);

CREATE INDEX IF NOT EXISTS idx_endorsements_instructor_id 
  ON endorsements(instructor_id);

CREATE INDEX IF NOT EXISTS idx_endorsements_student_id 
  ON endorsements(student_id);

CREATE INDEX IF NOT EXISTS idx_flight_logs_booking_id 
  ON flight_logs(booking_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id 
  ON invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoices_student_id 
  ON invoices(student_id);

CREATE INDEX IF NOT EXISTS idx_maintenance_milestones_aircraft_id 
  ON maintenance_milestones(aircraft_id);

CREATE INDEX IF NOT EXISTS idx_training_records_aircraft_id 
  ON training_records(aircraft_id);

CREATE INDEX IF NOT EXISTS idx_training_records_booking_id 
  ON training_records(booking_id);

CREATE INDEX IF NOT EXISTS idx_training_sequence_results_sequence_id 
  ON training_sequence_results(sequence_id);

CREATE INDEX IF NOT EXISTS idx_training_sequence_results_training_record_id 
  ON training_sequence_results(training_record_id);

-- =====================================================
-- PART 2: OPTIMIZE RLS POLICIES - USERS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Users can read own data" ON users;
DROP POLICY IF EXISTS "Users can update own data" ON users;
DROP POLICY IF EXISTS "Admins can read all users" ON users;
DROP POLICY IF EXISTS "Instructors can read students" ON users;
DROP POLICY IF EXISTS "Admins and instructors can update users" ON users;
DROP POLICY IF EXISTS "Users can insert own record" ON users;

CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY "Users can update own data"
  ON users FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "Admins can read all users"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY "Instructors can read students"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Admins and instructors can update users"
  ON users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Users can insert own record"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = id);

-- =====================================================
-- PART 3: OPTIMIZE RLS POLICIES - STUDENTS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Students can read own data" ON students;
DROP POLICY IF EXISTS "Students can update own data" ON students;
DROP POLICY IF EXISTS "Admins and instructors can read all students" ON students;
DROP POLICY IF EXISTS "Admins and instructors can manage students" ON students;
DROP POLICY IF EXISTS "Admins and instructors can insert students" ON students;
DROP POLICY IF EXISTS "Users can insert own student record" ON students;

CREATE POLICY "Students can read own data"
  ON students FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY "Students can update own data"
  ON students FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "Admins and instructors can read all students"
  ON students FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Admins and instructors can manage students"
  ON students FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Users can insert own student record"
  ON students FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = id);

-- =====================================================
-- PART 4: OPTIMIZE RLS POLICIES - BOOKINGS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Students can read own bookings" ON bookings;
DROP POLICY IF EXISTS "Students can create own bookings" ON bookings;
DROP POLICY IF EXISTS "Users can update relevant bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can delete bookings" ON bookings;

CREATE POLICY "Students can read own bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    student_id = (select auth.uid()) OR 
    instructor_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Students can create own bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (student_id = (select auth.uid()));

CREATE POLICY "Users can update relevant bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    student_id = (select auth.uid()) OR 
    instructor_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    student_id = (select auth.uid()) OR 
    instructor_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Admins can delete bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  );

-- =====================================================
-- PART 5: OPTIMIZE RLS POLICIES - TRAINING_RECORDS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Students can read own training records" ON training_records;
DROP POLICY IF EXISTS "Instructors can manage training records" ON training_records;

CREATE POLICY "Students can read own training records"
  ON training_records FOR SELECT
  TO authenticated
  USING (
    student_id = (select auth.uid()) OR 
    instructor_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Instructors can manage training records"
  ON training_records FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

-- =====================================================
-- PART 6: OPTIMIZE RLS POLICIES - SYLLABUS_SEQUENCES TABLE
-- =====================================================

DROP POLICY IF EXISTS "Admins and instructors can manage syllabus" ON syllabus_sequences;
DROP POLICY IF EXISTS "All authenticated users can read syllabus" ON syllabus_sequences;

CREATE POLICY "All authenticated users can read syllabus"
  ON syllabus_sequences FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and instructors can manage syllabus"
  ON syllabus_sequences FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

-- =====================================================
-- PART 7: OPTIMIZE RLS POLICIES - TRAINING_SEQUENCE_RESULTS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Users can read relevant sequence results" ON training_sequence_results;
DROP POLICY IF EXISTS "Instructors can manage sequence results" ON training_sequence_results;

CREATE POLICY "Users can read relevant sequence results"
  ON training_sequence_results FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM training_records tr
      WHERE tr.id = training_record_id 
      AND (tr.student_id = (select auth.uid()) OR tr.instructor_id = (select auth.uid()))
    ) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Instructors can manage sequence results"
  ON training_sequence_results FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

-- =====================================================
-- PART 8: OPTIMIZE RLS POLICIES - ENDORSEMENTS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Students can read own endorsements" ON endorsements;
DROP POLICY IF EXISTS "Instructors can manage endorsements" ON endorsements;
DROP POLICY IF EXISTS "Admins and instructors can insert endorsements" ON endorsements;
DROP POLICY IF EXISTS "Users can read relevant endorsements" ON endorsements;
DROP POLICY IF EXISTS "Admins and instructors can update endorsements" ON endorsements;
DROP POLICY IF EXISTS "Admins and instructors can delete endorsements" ON endorsements;

CREATE POLICY "Users can read endorsements"
  ON endorsements FOR SELECT
  TO authenticated
  USING (
    student_id = (select auth.uid()) OR 
    instructor_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Instructors can manage endorsements"
  ON endorsements FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

-- =====================================================
-- PART 9: OPTIMIZE RLS POLICIES - DEFECTS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Admins and instructors can manage defects" ON defects;
DROP POLICY IF EXISTS "All authenticated users can read defects" ON defects;
DROP POLICY IF EXISTS "All authenticated users can report defects" ON defects;

CREATE POLICY "All authenticated users can read defects"
  ON defects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can report defects"
  ON defects FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins and instructors can manage defects"
  ON defects FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

-- =====================================================
-- PART 10: OPTIMIZE RLS POLICIES - INVOICES TABLE
-- =====================================================

DROP POLICY IF EXISTS "Students can read own invoices" ON invoices;
DROP POLICY IF EXISTS "Admins can manage invoices" ON invoices;

CREATE POLICY "Users can read relevant invoices"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    student_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY "Admins can manage invoices"
  ON invoices FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  );

-- =====================================================
-- PART 11: OPTIMIZE RLS POLICIES - INVOICE_ITEMS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Users can read relevant invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Admins can manage invoice items" ON invoice_items;

CREATE POLICY "Users can read relevant invoice items"
  ON invoice_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices 
      WHERE invoices.id = invoice_id 
      AND (invoices.student_id = (select auth.uid()) OR
           EXISTS (SELECT 1 FROM users WHERE id = (select auth.uid()) AND role = 'admin'))
    )
  );

CREATE POLICY "Admins can manage invoice items"
  ON invoice_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  );

-- =====================================================
-- PART 12: OPTIMIZE RLS POLICIES - FLIGHT_LOGS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Users can read relevant flight logs" ON flight_logs;
DROP POLICY IF EXISTS "Instructors can manage flight logs" ON flight_logs;

CREATE POLICY "Users can read relevant flight logs"
  ON flight_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings 
      WHERE bookings.id = booking_id 
      AND (bookings.student_id = (select auth.uid()) OR bookings.instructor_id = (select auth.uid()))
    ) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

CREATE POLICY "Instructors can manage flight logs"
  ON flight_logs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role IN ('instructor', 'admin')
    )
  );

-- =====================================================
-- PART 13: OPTIMIZE RLS POLICIES - BOOKING_FIELD_SETTINGS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Admins can manage booking field settings" ON booking_field_settings;
DROP POLICY IF EXISTS "All authenticated users can read booking field settings" ON booking_field_settings;

CREATE POLICY "All authenticated users can read booking field settings"
  ON booking_field_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage booking field settings"
  ON booking_field_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) AND role = 'admin'
    )
  );
