/*
  # Update Remaining Table Policies for Multi-Role System

  1. Changes
    - Update policies for existing tables only
    - Use has_role() function consistently
  
  2. Security
    - Maintain strict access control with multi-role support
*/

-- Update users table policies
DROP POLICY IF EXISTS "Admins can read all users" ON users;
DROP POLICY IF EXISTS "Instructors can read all users" ON users;
DROP POLICY IF EXISTS "Admins and instructors can read all users" ON users;
DROP POLICY IF EXISTS "Users can read own data" ON users;
DROP POLICY IF EXISTS "Users can insert own record" ON users;
DROP POLICY IF EXISTS "Users can update own data" ON users;

CREATE POLICY "Admins and instructors can read all users"
  ON users FOR SELECT
  TO authenticated
  USING (has_role('admin') OR has_role('instructor'));

CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own record"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own data"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Update students table policies
DROP POLICY IF EXISTS "Users can read own student data" ON students;
DROP POLICY IF EXISTS "Users can update own student data" ON students;
DROP POLICY IF EXISTS "Admins and instructors can delete students" ON students;
DROP POLICY IF EXISTS "Users can insert own student record" ON students;

CREATE POLICY "Users can read own student data"
  ON students FOR SELECT
  TO authenticated
  USING (
    (id = auth.uid()) OR 
    has_role('instructor') OR 
    has_role('admin')
  );

CREATE POLICY "Users can insert own student record"
  ON students FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own student data"
  ON students FOR UPDATE
  TO authenticated
  USING (
    (id = auth.uid()) OR 
    has_role('instructor') OR 
    has_role('admin')
  )
  WITH CHECK (
    (id = auth.uid()) OR 
    has_role('instructor') OR 
    has_role('admin')
  );

CREATE POLICY "Admins and instructors can delete students"
  ON students FOR DELETE
  TO authenticated
  USING (has_role('instructor') OR has_role('admin'));

-- Update endorsements table policies
DROP POLICY IF EXISTS "Instructors can manage endorsements" ON endorsements;
DROP POLICY IF EXISTS "Users can view own endorsements" ON endorsements;
DROP POLICY IF EXISTS "Instructors and admins can manage endorsements" ON endorsements;

CREATE POLICY "Instructors and admins can manage endorsements"
  ON endorsements FOR ALL
  TO authenticated
  USING (has_role('instructor') OR has_role('admin'))
  WITH CHECK (has_role('instructor') OR has_role('admin'));

CREATE POLICY "Users can view own endorsements"
  ON endorsements FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

-- Update defects table policies
DROP POLICY IF EXISTS "All authenticated users can create defect reports" ON defects;
DROP POLICY IF EXISTS "All authenticated users can view defect reports" ON defects;
DROP POLICY IF EXISTS "Instructors can update defect reports" ON defects;
DROP POLICY IF EXISTS "Instructors and admins can update defect reports" ON defects;

CREATE POLICY "All authenticated users can create defects"
  ON defects FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "All authenticated users can view defects"
  ON defects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Instructors and admins can update defects"
  ON defects FOR UPDATE
  TO authenticated
  USING (has_role('instructor') OR has_role('admin'))
  WITH CHECK (has_role('instructor') OR has_role('admin'));

-- Update invitations table policies
DROP POLICY IF EXISTS "Admins can manage invitations" ON invitations;
DROP POLICY IF EXISTS "Instructors can manage invitations" ON invitations;
DROP POLICY IF EXISTS "Admins and instructors can create invitations" ON invitations;
DROP POLICY IF EXISTS "Admins and instructors can update invitations" ON invitations;
DROP POLICY IF EXISTS "Admins and instructors can view invitations" ON invitations;
DROP POLICY IF EXISTS "Users can view own sent invitations" ON invitations;
DROP POLICY IF EXISTS "Admins and instructors can manage invitations" ON invitations;

CREATE POLICY "Admins and instructors can manage invitations"
  ON invitations FOR ALL
  TO authenticated
  USING (has_role('admin') OR has_role('instructor'))
  WITH CHECK (has_role('admin') OR has_role('instructor'));

CREATE POLICY "Users can view own sent invitations"
  ON invitations FOR SELECT
  TO authenticated
  USING (invited_by = auth.uid());

-- Update notifications table policies
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "System can create notifications" ON notifications;
DROP POLICY IF EXISTS "Admins and instructors can create notifications" ON notifications;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins and instructors can create notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (has_role('admin') OR has_role('instructor'));
