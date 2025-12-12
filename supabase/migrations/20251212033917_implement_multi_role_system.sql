/*
  # Implement Multi-Role System

  1. New Tables
    - `user_roles` - Junction table for user-role relationships
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `role` (text) - one of: admin, instructor, pilot, student
      - `created_at` (timestamptz)
  
  2. Changes
    - Migrate existing role data from users table to user_roles
    - Create helper functions for role checking
    - Update auth metadata sync to store roles as array
    - Keep users.role column for backwards compatibility initially
  
  3. Security
    - Enable RLS on user_roles table
    - Admins can manage all roles
    - Users can view their own roles
*/

-- Create user_roles junction table
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'instructor', 'pilot', 'student')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Enable RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_roles
CREATE POLICY "Users can view own roles"
  ON user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all roles"
  ON user_roles FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' -> 'roles')::jsonb ? 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' -> 'roles')::jsonb ? 'admin');

-- Migrate existing role data to user_roles table
INSERT INTO user_roles (user_id, role)
SELECT id, role
FROM users
WHERE role IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- Create function to check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(check_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Check JWT metadata for roles array
  RETURN (auth.jwt() -> 'app_metadata' -> 'roles')::jsonb ? check_role;
END;
$$;

-- Create function to get all user roles
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Return roles array from JWT metadata
  RETURN COALESCE(
    ARRAY(SELECT jsonb_array_elements_text((auth.jwt() -> 'app_metadata' -> 'roles')::jsonb)),
    ARRAY['student']::text[]
  );
END;
$$;

-- Update get_user_role to return primary role for backwards compatibility
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  roles text[];
BEGIN
  roles := get_user_roles();
  
  -- Priority: admin > instructor > pilot > student
  IF 'admin' = ANY(roles) THEN
    RETURN 'admin';
  ELSIF 'instructor' = ANY(roles) THEN
    RETURN 'instructor';
  ELSIF 'pilot' = ANY(roles) THEN
    RETURN 'pilot';
  ELSE
    RETURN 'student';
  END IF;
END;
$$;

-- Create trigger function to sync roles to auth metadata
CREATE OR REPLACE FUNCTION public.sync_user_roles_to_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_roles_array text[];
BEGIN
  -- Get all roles for the user
  SELECT array_agg(role ORDER BY 
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'instructor' THEN 2
      WHEN 'pilot' THEN 3
      WHEN 'student' THEN 4
    END
  )
  INTO user_roles_array
  FROM user_roles
  WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);

  -- Update auth.users metadata
  UPDATE auth.users
  SET raw_app_meta_data = 
    COALESCE(raw_app_meta_data, '{}'::jsonb) || 
    jsonb_build_object('roles', to_jsonb(user_roles_array))
  WHERE id = COALESCE(NEW.user_id, OLD.user_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger on user_roles table
DROP TRIGGER IF EXISTS sync_roles_to_auth_trigger ON user_roles;
CREATE TRIGGER sync_roles_to_auth_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_roles_to_auth();

-- Update the user creation trigger to assign student role by default
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert into users table
  INSERT INTO public.users (id, email, name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, users.name),
    phone = COALESCE(EXCLUDED.phone, users.phone);

  -- Insert student role by default
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Insert into students table
  INSERT INTO public.students (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Sync all existing users' roles to auth metadata
DO $$
DECLARE
  user_record RECORD;
  user_roles_array text[];
BEGIN
  FOR user_record IN SELECT DISTINCT user_id FROM user_roles LOOP
    SELECT array_agg(role ORDER BY 
      CASE role
        WHEN 'admin' THEN 1
        WHEN 'instructor' THEN 2
        WHEN 'pilot' THEN 3
        WHEN 'student' THEN 4
      END
    )
    INTO user_roles_array
    FROM user_roles
    WHERE user_id = user_record.user_id;

    UPDATE auth.users
    SET raw_app_meta_data = 
      COALESCE(raw_app_meta_data, '{}'::jsonb) || 
      jsonb_build_object('roles', to_jsonb(user_roles_array))
    WHERE id = user_record.user_id;
  END LOOP;
END $$;
