/*
  Allow full portal members to add their own endorsements, and
  automatically sync Pilot status when endorsement records change.
*/

DROP POLICY IF EXISTS "Full members can insert own endorsements" ON public.endorsements;
CREATE POLICY "Full members can insert own endorsements"
  ON public.endorsements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_has_full_portal_access()
    AND student_id = auth.uid()
    AND instructor_id IS NULL
  );

CREATE OR REPLACE FUNCTION public.sync_member_role_from_endorsements(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pilot_status_endorsement_types text[];
  has_staff_role boolean := false;
  should_be_pilot boolean := false;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = target_user_id
      AND role IN ('admin', 'senior_instructor', 'instructor')
  )
  INTO has_staff_role;

  IF has_staff_role THEN
    RETURN;
  END IF;

  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT trim(value)
      FROM unnest(
        COALESCE(
          (SELECT pilot_status_endorsement_types FROM public.training_syllabus_settings LIMIT 1),
          ARRAY[
            'Pilot Certificate',
            'Recreational Pilots Licence RPL (A)',
            'RPL(A) Aeroplane Category Rating'
          ]::text[]
        )
      ) AS value
      WHERE trim(value) <> ''
    ),
    ARRAY[
      'Pilot Certificate',
      'Recreational Pilots Licence RPL (A)',
      'RPL(A) Aeroplane Category Rating'
    ]::text[]
  )
  INTO pilot_status_endorsement_types;

  SELECT EXISTS (
    SELECT 1
    FROM public.endorsements AS endorsement
    WHERE endorsement.student_id = target_user_id
      AND COALESCE(endorsement.is_active, true)
      AND (
        endorsement.expiry_date IS NULL
        OR endorsement.expiry_date >= CURRENT_DATE
      )
      AND EXISTS (
        SELECT 1
        FROM unnest(pilot_status_endorsement_types) AS allowed_type
        WHERE lower(trim(allowed_type)) = lower(trim(endorsement.type))
      )
  )
  INTO should_be_pilot;

  IF should_be_pilot THEN
    UPDATE public.users
    SET role = 'pilot',
        updated_at = now()
    WHERE id = target_user_id
      AND role IS DISTINCT FROM 'pilot';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (target_user_id, 'pilot')
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = target_user_id
      AND role = 'student';
  ELSE
    UPDATE public.users
    SET role = 'student',
        updated_at = now()
    WHERE id = target_user_id
      AND role IS DISTINCT FROM 'student';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (target_user_id, 'student')
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = target_user_id
      AND role = 'pilot';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_member_role_from_endorsements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_member_role_from_endorsements(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_member_role_from_endorsements(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_endorsement_role_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_member_role_from_endorsements(COALESCE(NEW.student_id, OLD.student_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.handle_endorsement_role_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_endorsement_role_sync() FROM anon;

DROP TRIGGER IF EXISTS sync_member_role_after_endorsement_change ON public.endorsements;
CREATE TRIGGER sync_member_role_after_endorsement_change
AFTER INSERT OR UPDATE OR DELETE ON public.endorsements
FOR EACH ROW
EXECUTE FUNCTION public.handle_endorsement_role_sync();
