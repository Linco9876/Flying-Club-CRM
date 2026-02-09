/*
  # Fix User Roles Synchronization for Defect Delete
  
  1. Changes
    - Resync all user roles to auth.users metadata
    - Ensure roles array exists in app_metadata for JWT-based policies
    - Add helper function to manually resync user roles if needed
  
  2. Purpose
    - Fix DELETE permission issues by ensuring JWT has correct roles array
    - Support the has_role() function used in RLS policies
*/

-- Resync all existing users' roles to auth metadata
DO $$
DECLARE
  user_record RECORD;
  user_roles_array text[];
BEGIN
  FOR user_record IN SELECT DISTINCT id FROM users LOOP
    -- Get all roles for this user from user_roles table
    SELECT array_agg(role ORDER BY 
      CASE role
        WHEN 'admin' THEN 1
        WHEN 'senior_instructor' THEN 2
        WHEN 'instructor' THEN 3
        WHEN 'pilot' THEN 4
        WHEN 'student' THEN 5
      END
    )
    INTO user_roles_array
    FROM user_roles
    WHERE user_id = user_record.id;
    
    -- If no roles found in user_roles table, check users.role column
    IF user_roles_array IS NULL THEN
      SELECT ARRAY[role] INTO user_roles_array
      FROM users
      WHERE id = user_record.id;
    END IF;
    
    -- Update auth.users with roles array
    IF user_roles_array IS NOT NULL THEN
      UPDATE auth.users
      SET raw_app_meta_data = 
        COALESCE(raw_app_meta_data, '{}'::jsonb) 
        || jsonb_build_object('roles', to_jsonb(user_roles_array))
      WHERE id = user_record.id;
    END IF;
  END LOOP;
END $$;

-- Create a helper function to manually resync a user's roles
CREATE OR REPLACE FUNCTION public.resync_user_roles(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_roles_array text[];
BEGIN
  -- Get all roles for the user from user_roles table
  SELECT array_agg(role ORDER BY 
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'senior_instructor' THEN 2
      WHEN 'instructor' THEN 3
      WHEN 'pilot' THEN 4
      WHEN 'student' THEN 5
    END
  )
  INTO user_roles_array
  FROM user_roles
  WHERE user_id = target_user_id;
  
  -- If no roles found in user_roles table, check users.role column
  IF user_roles_array IS NULL THEN
    SELECT ARRAY[role] INTO user_roles_array
    FROM users
    WHERE id = target_user_id;
  END IF;
  
  -- Update auth.users with roles array
  IF user_roles_array IS NOT NULL THEN
    UPDATE auth.users
    SET raw_app_meta_data = 
      COALESCE(raw_app_meta_data, '{}'::jsonb) 
      || jsonb_build_object('roles', to_jsonb(user_roles_array))
    WHERE id = target_user_id;
  END IF;
END;
$$;