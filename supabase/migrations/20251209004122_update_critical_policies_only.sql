/*
  # Update Critical RLS Policies (Students and Bookings Only)

  1. Changes
    - Update students table policies to use get_user_role() function
    - Update bookings table policies to use get_user_role() function
    - This should fix the immediate login issue
*/

-- Students table policies
DROP POLICY IF EXISTS "Admins and instructors can read all students" ON students;
DROP POLICY IF EXISTS "Admins and instructors can manage students" ON students;
DROP POLICY IF EXISTS "Students can read own data" ON students;
DROP POLICY IF EXISTS "Users can insert own student record" ON students;

CREATE POLICY "Users can read own student data"
  ON students FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR get_user_role() = 'instructor' OR get_user_role() = 'admin');

CREATE POLICY "Users can update own student data"
  ON students FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR get_user_role() = 'instructor' OR get_user_role() = 'admin')
  WITH CHECK (id = auth.uid() OR get_user_role() = 'instructor' OR get_user_role() = 'admin');

CREATE POLICY "Users can insert own student record"
  ON students FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Admins and instructors can delete students"
  ON students FOR DELETE
  TO authenticated
  USING (get_user_role() = 'instructor' OR get_user_role() = 'admin');

-- Bookings table policies
DROP POLICY IF EXISTS "Students can read own bookings" ON bookings;
DROP POLICY IF EXISTS "Users can update relevant bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can delete bookings" ON bookings;
DROP POLICY IF EXISTS "Users can create bookings" ON bookings;
DROP POLICY IF EXISTS "Users can read relevant bookings" ON bookings;

CREATE POLICY "Users can read relevant bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid() OR 
    instructor_id = auth.uid() OR 
    get_user_role() = 'instructor' OR 
    get_user_role() = 'admin'
  );

CREATE POLICY "Users can create bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid() OR 
    instructor_id = auth.uid() OR 
    get_user_role() = 'instructor' OR 
    get_user_role() = 'admin'
  );

CREATE POLICY "Users can update relevant bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    student_id = auth.uid() OR 
    instructor_id = auth.uid() OR 
    get_user_role() = 'instructor' OR 
    get_user_role() = 'admin'
  )
  WITH CHECK (
    student_id = auth.uid() OR 
    instructor_id = auth.uid() OR 
    get_user_role() = 'instructor' OR 
    get_user_role() = 'admin'
  );

CREATE POLICY "Admins can delete bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin');