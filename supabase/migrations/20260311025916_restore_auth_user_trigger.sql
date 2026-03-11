/*
  # Restore auth user trigger and fix missing user records

  ## Summary
  The trigger that auto-creates a public.users record when a new auth user signs up
  was missing. This migration restores it and backfills any auth users that don't
  have a corresponding public.users record.

  ## Changes
  1. Creates/replaces the `handle_new_user` function that inserts into public.users
     using metadata from the auth signup (name, phone, role)
  2. Creates the `on_auth_user_created` trigger on auth.users
  3. Backfills existing auth users that are missing a public.users record

  ## Security
  - Function runs with SECURITY DEFINER to bypass RLS during user creation
  - Sets search_path to prevent search path injection
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role, phone, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    NEW.raw_user_meta_data->>'phone',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.users (id, email, name, role, phone, created_at, updated_at)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'name', split_part(au.email, '@', 1)),
  COALESCE(au.raw_user_meta_data->>'role', 'student'),
  au.raw_user_meta_data->>'phone',
  au.created_at,
  NOW()
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.users pu WHERE pu.id = au.id
);
