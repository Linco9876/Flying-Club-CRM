ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS cover_url text;
