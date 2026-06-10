/*
  # Fix Circular Dependency in RLS Policies

  1. Changes
    - Drop policies that use get_user_role()
    - Replace get_user_role() function with JWT-based version
    - Recreate policies with the new function
    
  2. Reasoning
    - Current get_user_role() queries users table causing circular dependency
    - JWT claims are faster and don't require database queries
    - This eliminates the deadlock on login
*/

-- Drop policies that depend on get_user_role()
DROP POLICY IF EXISTS "Users can read own student data" ON students;
DROP POLICY IF EXISTS "Users can update own student data" ON students;
DROP POLICY IF EXISTS "Admins and instructors can delete students" ON students;
DROP POLICY IF EXISTS "Users can read relevant bookings" ON bookings;
DROP POLICY IF EXISTS "Users can create bookings" ON bookings;
DROP POLICY IF EXISTS "Users can update relevant bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can delete bookings" ON bookings;

-- Now we can drop the function
DROP FUNCTION IF EXISTS get_user_role() CASCADE;

-- Create a new function that uses JWT claims
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN COALESCE(
    auth.jwt()->>'user_role',
    'student'
  );
END;
$$;

-- Recreate students policies
CREATE POLICY "Users can read own student data"
  ON students FOR SELECT
  TO authenticated
  USING (
    id = auth.uid() OR 
    get_user_role() IN ('instructor', 'admin')
  );

CREATE POLICY "Users can update own student data"
  ON students FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid() OR 
    get_user_role() IN ('instructor', 'admin')
  )
  WITH CHECK (
    id = auth.uid() OR 
    get_user_role() IN ('instructor', 'admin')
  );

CREATE POLICY "Admins and instructors can delete students"
  ON students FOR DELETE
  TO authenticated
  USING (get_user_role() IN ('instructor', 'admin'));

-- Recreate bookings policies
CREATE POLICY "Users can read relevant bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid() OR 
    instructor_id = auth.uid() OR 
    get_user_role() IN ('instructor', 'admin')
  );

CREATE POLICY "Users can create bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid() OR 
    instructor_id = auth.uid() OR 
    get_user_role() IN ('instructor', 'admin')
  );

CREATE POLICY "Users can update relevant bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    student_id = auth.uid() OR 
    instructor_id = auth.uid() OR 
    get_user_role() IN ('instructor', 'admin')
  )
  WITH CHECK (
    student_id = auth.uid() OR 
    instructor_id = auth.uid() OR 
    get_user_role() IN ('instructor', 'admin')
  );

CREATE POLICY "Admins can delete bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin');

-- Update the trigger to set role in JWT metadata
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  user_role text;
BEGIN
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');

  -- Update the user metadata to include role for JWT
  UPDATE auth.users
  SET raw_app_meta_data = 
    COALESCE(raw_app_meta_data, '{}'::jsonb) || 
    jsonb_build_object('user_role', user_role)
  WHERE id = NEW.id;

  INSERT INTO public.users (id, email, name, role, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    user_role,
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO NOTHING;

  IF user_role = 'student' THEN
    INSERT INTO public.students (id, prepaid_balance)
    VALUES (NEW.id, 0)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to create user/student record: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Update existing users to have role in JWT metadata
DO $$
DECLARE
  user_record RECORD;
BEGIN
  FOR user_record IN 
    SELECT u.id, u.role 
    FROM public.users u
    JOIN auth.users au ON u.id = au.id
  LOOP
    BEGIN
      UPDATE auth.users
      SET raw_app_meta_data = 
        COALESCE(raw_app_meta_data, '{}'::jsonb) || 
        jsonb_build_object('user_role', user_record.role)
      WHERE id = user_record.id;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'Failed to update metadata for user %: %', user_record.id, SQLERRM;
    END;
  END LOOP;
END;
$$;