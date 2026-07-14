-- Members may submit licence evidence, but only verified licences can grant access.

ALTER TABLE public.licences
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS proof_document_id uuid REFERENCES public.student_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.licences
  DROP CONSTRAINT IF EXISTS licences_verification_status_check;
ALTER TABLE public.licences
  ADD CONSTRAINT licences_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'rejected'));

UPDATE public.licences
SET verification_status = 'verified',
    verified_at = COALESCE(verified_at, created_at)
WHERE verification_status = 'verified';

CREATE INDEX IF NOT EXISTS licences_pending_verification_idx
  ON public.licences(verification_status, created_at DESC)
  WHERE verification_status = 'pending';

COMMENT ON COLUMN public.licences.verification_status IS
  'Member submissions remain pending until staff verify them. Only verified licences grant Pilot status or aircraft access.';
COMMENT ON COLUMN public.licences.proof_document_id IS
  'Supporting document uploaded into the member student-documents area.';

CREATE POLICY "Members can submit own licences for verification"
  ON public.licences FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND submitted_by = auth.uid()
    AND verification_status = 'pending'
    AND is_active = false
    AND instructor_id IS NULL
    AND source_course_id IS NULL
    AND verified_by IS NULL
    AND verified_at IS NULL
    AND rejection_reason IS NULL
    AND proof_document_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.student_documents document
      WHERE document.id = proof_document_id
        AND document.student_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.notify_staff_of_licence_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  member_name text;
BEGIN
  IF NEW.verification_status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(name), ''), email, 'A member')
  INTO member_name
  FROM public.users
  WHERE id = NEW.student_id;

  INSERT INTO public.notifications (user_id, type, title, message, metadata, is_read)
  SELECT DISTINCT
    staff.user_id,
    'licence_verification',
    'Licence verification required',
    format('%s submitted %s for verification.', member_name, NEW.type),
    jsonb_build_object(
      'student_id', NEW.student_id::text,
      'licence_id', NEW.id::text,
      'route', '/students/' || NEW.student_id::text || '?tab=overview'
    ),
    false
  FROM (
    SELECT u.id AS user_id
    FROM public.users u
    WHERE COALESCE(u.is_active, true)
      AND (
        u.role IN ('admin', 'senior_instructor', 'instructor')
        OR EXISTS (
          SELECT 1
          FROM public.user_roles role
          WHERE role.user_id = u.id
            AND role.role IN ('admin', 'senior_instructor', 'instructor')
        )
      )
  ) staff;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_staff_of_licence_submission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_staff_of_licence_submission() TO service_role;

DROP TRIGGER IF EXISTS notify_staff_after_licence_submission ON public.licences;
CREATE TRIGGER notify_staff_after_licence_submission
AFTER INSERT ON public.licences
FOR EACH ROW EXECUTE FUNCTION public.notify_staff_of_licence_submission();

CREATE OR REPLACE FUNCTION public.sync_member_role_from_licences(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  should_be_pilot boolean := false;
  has_staff_role boolean := false;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.licences licence
    WHERE licence.student_id = target_user_id
      AND licence.verification_status = 'verified'
      AND licence.is_active
      AND (licence.expiry_date IS NULL OR licence.expiry_date >= CURRENT_DATE)
  ) INTO should_be_pilot;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = target_user_id
      AND role IN ('admin', 'senior_instructor', 'instructor')
  ) INTO has_staff_role;

  IF should_be_pilot THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (target_user_id, 'pilot')
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = target_user_id AND role = 'student';
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = target_user_id AND role = 'pilot';

    IF NOT has_staff_role THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (target_user_id, 'student')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_member_role_from_licences(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_member_role_from_licences(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_aircraft_solo_hire_qualifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  aircraft_row public.aircraft%ROWTYPE;
  meets_all_endorsements boolean;
  meets_any_endorsement boolean;
  meets_all_licences boolean;
  meets_any_licence boolean;
BEGIN
  IF NEW.aircraft_id IS NULL OR NEW.instructor_id IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO aircraft_row FROM public.aircraft WHERE id = NEW.aircraft_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(aircraft_row.required_endorsement_all_types) required
    WHERE NOT EXISTS (
      SELECT 1 FROM public.endorsements held
      WHERE held.student_id = NEW.student_id AND held.is_active
        AND (held.expiry_date IS NULL OR held.expiry_date >= CURRENT_DATE)
        AND lower(trim(held.type)) = lower(trim(required))
    )
  ) INTO meets_all_endorsements;

  SELECT cardinality(aircraft_row.required_endorsement_types) = 0 OR EXISTS (
    SELECT 1 FROM public.endorsements held
    WHERE held.student_id = NEW.student_id AND held.is_active
      AND (held.expiry_date IS NULL OR held.expiry_date >= CURRENT_DATE)
      AND EXISTS (
        SELECT 1 FROM unnest(aircraft_row.required_endorsement_types) required
        WHERE lower(trim(required)) = lower(trim(held.type))
      )
  ) INTO meets_any_endorsement;

  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(aircraft_row.required_licence_all_types) required
    WHERE NOT EXISTS (
      SELECT 1 FROM public.licences held
      WHERE held.student_id = NEW.student_id
        AND held.verification_status = 'verified'
        AND held.is_active
        AND (held.expiry_date IS NULL OR held.expiry_date >= CURRENT_DATE)
        AND lower(trim(held.type)) = lower(trim(required))
    )
  ) INTO meets_all_licences;

  SELECT cardinality(aircraft_row.required_licence_types) = 0 OR EXISTS (
    SELECT 1 FROM public.licences held
    WHERE held.student_id = NEW.student_id
      AND held.verification_status = 'verified'
      AND held.is_active
      AND (held.expiry_date IS NULL OR held.expiry_date >= CURRENT_DATE)
      AND EXISTS (
        SELECT 1 FROM unnest(aircraft_row.required_licence_types) required
        WHERE lower(trim(required)) = lower(trim(held.type))
      )
  ) INTO meets_any_licence;

  IF NOT (meets_all_endorsements AND meets_any_endorsement AND meets_all_licences AND meets_any_licence) THEN
    RAISE EXCEPTION 'Pilot does not hold the verified licences and endorsements required for solo hire of this aircraft'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_aircraft_solo_hire_qualifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_aircraft_solo_hire_qualifications() TO service_role;
