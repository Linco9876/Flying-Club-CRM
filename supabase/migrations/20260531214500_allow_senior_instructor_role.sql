/*
  Allow senior_instructor in user_roles so role assignment matches the RLS
  policies and frontend access model that already reference it.
*/

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'user_roles'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%role%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'senior_instructor', 'instructor', 'pilot', 'student'));
