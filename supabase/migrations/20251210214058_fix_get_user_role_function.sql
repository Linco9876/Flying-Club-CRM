/*
  # Fix get_user_role function to check correct JWT field

  1. Changes
    - Update get_user_role function to check 'role' instead of 'user_role'
    - Clean up auth.users metadata to only use 'role' field
    - Resync all user roles to auth metadata
    
  2. Purpose
    - Fix the function to correctly read role from JWT
    - Allow admin/instructor users to see all students
*/

-- First update all auth.users to have correct role in app_metadata
UPDATE auth.users au
SET raw_app_meta_data = 
  COALESCE(raw_app_meta_data, '{}'::jsonb) 
  - 'user_role'
  || jsonb_build_object('role', u.role)
FROM public.users u
WHERE au.id = u.id;

-- Update the get_user_role function
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN COALESCE(
    (auth.jwt()->>'role'),
    (SELECT role FROM users WHERE id = auth.uid()),
    'student'
  );
END;
$$;
