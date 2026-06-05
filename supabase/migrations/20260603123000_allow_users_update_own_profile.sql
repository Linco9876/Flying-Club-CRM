/*
  Allow authenticated users to update their own profile row.
  This is required for profile and cover photo URL updates after storage upload.
*/

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS cover_url text;

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

CREATE POLICY "Users can update own profile"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

