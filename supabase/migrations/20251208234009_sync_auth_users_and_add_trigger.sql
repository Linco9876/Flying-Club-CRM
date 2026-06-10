/*
  # Sync Auth Users and Add Auto-Create Trigger

  1. Changes
    - Insert existing auth.users into public.users table
    - Create trigger function to automatically create user records
    - Add trigger to run on auth.users insert

  2. Details
    - Syncs existing users from auth.users to public.users
    - Sets default role to 'student' for new users
    - Future user signups will automatically create records in both tables
*/

-- Insert existing auth users into public.users table
INSERT INTO users (id, email, name, role, phone)
SELECT 
  id,
  email,
  COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1)) as name,
  'student' as role,
  raw_user_meta_data->>'phone' as phone
FROM auth.users
WHERE id NOT IN (SELECT id FROM users)
ON CONFLICT (id) DO NOTHING;

-- Create function to automatically create user records when auth users are created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    NEW.raw_user_meta_data->>'phone'
  );
  RETURN NEW;
END;
$$;

-- Create trigger to run the function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
