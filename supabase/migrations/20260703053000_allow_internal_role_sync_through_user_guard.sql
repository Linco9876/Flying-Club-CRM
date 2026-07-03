/*
  Allow internal nested trigger updates to protected user fields,
  while still blocking direct self-service privilege escalation.
*/

CREATE OR REPLACE FUNCTION public.guard_users_self_service_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF auth.uid() = OLD.id AND NOT public.current_user_has_staff_role() THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.is_senior_instructor IS DISTINCT FROM OLD.is_senior_instructor
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Only staff can change protected member fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
