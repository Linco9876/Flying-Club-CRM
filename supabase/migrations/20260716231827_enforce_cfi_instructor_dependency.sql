-- A CFI authority is additive to an Instructor account. Keep this invariant in
-- the database as well as the role editor so direct API changes cannot create
-- a CFI-only account or remove Instructor while CFI remains assigned.
CREATE OR REPLACE FUNCTION public.enforce_cfi_instructor_dependency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.role = 'cfi' AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = NEW.user_id
      AND role = 'instructor'
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'CFI authority requires the Instructor role';
  END IF;

  IF TG_OP IN ('DELETE', 'UPDATE')
    AND OLD.role = 'instructor'
    AND (TG_OP = 'DELETE' OR NEW.role <> 'instructor')
    AND EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = v_user_id
        AND role = 'cfi'
    )
  THEN
    RAISE EXCEPTION 'Remove CFI authority before removing the Instructor role';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cfi_instructor_dependency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_cfi_instructor_dependency() TO service_role;

DROP TRIGGER IF EXISTS enforce_cfi_instructor_dependency_trigger ON public.user_roles;
CREATE TRIGGER enforce_cfi_instructor_dependency_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cfi_instructor_dependency();
