/*
  Allow internal nested trigger updates to protected access fields,
  while still blocking direct self-service access changes.
*/

CREATE OR REPLACE FUNCTION public.prevent_self_service_access_field_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting_user uuid := auth.uid();
  acting_is_staff boolean := false;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF acting_user IS NULL OR acting_user <> OLD.id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = acting_user
      AND ur.role = ANY (ARRAY['admin','instructor','senior_instructor'])
  ) INTO acting_is_staff;

  IF acting_is_staff THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
    OR COALESCE(NEW.portal_access_scope, 'full') IS DISTINCT FROM COALESCE(OLD.portal_access_scope, 'full')
    OR COALESCE(NEW.is_active, true) IS DISTINCT FROM COALESCE(OLD.is_active, true)
    OR COALESCE(NEW.is_senior_instructor, false) IS DISTINCT FROM COALESCE(OLD.is_senior_instructor, false)
  THEN
    RAISE EXCEPTION 'Protected account access fields can only be changed by staff';
  END IF;

  RETURN NEW;
END;
$$;
