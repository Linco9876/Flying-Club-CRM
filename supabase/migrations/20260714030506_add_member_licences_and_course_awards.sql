-- Separate licences from endorsements. Licences control Pilot status; endorsements do not.

ALTER TABLE public.training_syllabus_settings
  ADD COLUMN IF NOT EXISTS licence_types text[] NOT NULL DEFAULT ARRAY[
    'RAAus Pilot Certificate',
    'CASA Recreational Pilot Licence (RPL)',
    'CASA Private Pilot Licence (PPL)',
    'CASA Commercial Pilot Licence (CPL)',
    'CASA Air Transport Pilot Licence (ATPL)'
  ]::text[];

COMMENT ON COLUMN public.training_syllabus_settings.licence_types IS
  'Organisation-managed pilot licence names. Holding any active, current licence grants Pilot status.';

CREATE TABLE IF NOT EXISTS public.licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  licence_number text,
  date_obtained date,
  expiry_date date,
  issuing_authority text,
  instructor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  source_course_id uuid REFERENCES public.training_courses(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licences_type_not_blank CHECK (length(trim(type)) > 0),
  CONSTRAINT licences_date_order CHECK (
    expiry_date IS NULL OR date_obtained IS NULL OR expiry_date >= date_obtained
  )
);

CREATE INDEX IF NOT EXISTS licences_student_id_idx ON public.licences(student_id);
CREATE INDEX IF NOT EXISTS licences_source_course_id_idx ON public.licences(source_course_id);
CREATE UNIQUE INDEX IF NOT EXISTS licences_one_active_type_per_member_idx
  ON public.licences(student_id, lower(trim(type)))
  WHERE is_active;

ALTER TABLE public.licences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read own licences and staff can read all"
  ON public.licences FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.current_user_has_staff_role());

CREATE POLICY "Staff can insert licences"
  ON public.licences FOR INSERT TO authenticated
  WITH CHECK (public.current_user_has_staff_role());

CREATE POLICY "Staff can update licences"
  ON public.licences FOR UPDATE TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

CREATE POLICY "Staff can delete licences"
  ON public.licences FOR DELETE TO authenticated
  USING (public.current_user_has_staff_role());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.licences TO authenticated;
GRANT ALL ON public.licences TO service_role;

ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS completion_licence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_licence_type text,
  ADD COLUMN IF NOT EXISTS completion_licence_expiry_months integer;

ALTER TABLE public.training_courses
  DROP CONSTRAINT IF EXISTS training_courses_completion_licence_expiry_months_check;
ALTER TABLE public.training_courses
  ADD CONSTRAINT training_courses_completion_licence_expiry_months_check
  CHECK (completion_licence_expiry_months IS NULL OR completion_licence_expiry_months > 0);

COMMENT ON COLUMN public.training_courses.completion_licence_enabled IS
  'When true, 100% course completion grants the configured licence.';
COMMENT ON COLUMN public.training_courses.completion_licence_type IS
  'Licence granted when the course reaches 100% completion.';

ALTER TABLE public.aircraft
  ADD COLUMN IF NOT EXISTS required_endorsement_all_types text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS required_licence_types text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS required_licence_all_types text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.aircraft.required_endorsement_types IS
  'Any-one endorsement eligibility list for solo hire.';
COMMENT ON COLUMN public.aircraft.required_endorsement_all_types IS
  'All endorsements in this list are required for solo hire.';
COMMENT ON COLUMN public.aircraft.required_licence_types IS
  'Any-one licence eligibility list for solo hire.';
COMMENT ON COLUMN public.aircraft.required_licence_all_types IS
  'All licences in this list are required for solo hire.';

CREATE OR REPLACE FUNCTION public.rename_aircraft_licence_requirement(old_value text, new_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.current_user_has_staff_role() THEN
    RAISE EXCEPTION 'Only staff can rename aircraft licence requirements';
  END IF;

  UPDATE public.aircraft
  SET required_licence_types = ARRAY(
        SELECT CASE WHEN lower(trim(item)) = lower(trim(old_value)) THEN new_value ELSE item END
        FROM unnest(required_licence_types) item
      ),
      required_licence_all_types = ARRAY(
        SELECT CASE WHEN lower(trim(item)) = lower(trim(old_value)) THEN new_value ELSE item END
        FROM unnest(required_licence_all_types) item
      )
  WHERE EXISTS (
      SELECT 1 FROM unnest(required_licence_types) item
      WHERE lower(trim(item)) = lower(trim(old_value))
    ) OR EXISTS (
      SELECT 1 FROM unnest(required_licence_all_types) item
      WHERE lower(trim(item)) = lower(trim(old_value))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rename_aircraft_licence_requirement(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_aircraft_licence_requirement(text, text) TO authenticated, service_role;

-- Preserve existing licence-like endorsements as licences before retiring role promotion.
INSERT INTO public.licences (
  student_id,
  type,
  licence_number,
  date_obtained,
  expiry_date,
  issuing_authority,
  instructor_id,
  is_active
)
SELECT
  e.student_id,
  CASE
    WHEN lower(trim(e.type)) = 'pilot certificate' THEN 'RAAus Pilot Certificate'
    ELSE 'CASA Recreational Pilot Licence (RPL)'
  END,
  CASE
    WHEN lower(trim(e.type)) = 'pilot certificate' THEN s.raaus_id
    ELSE s.casa_id
  END,
  CASE
    WHEN e.date_obtained IS NOT NULL
      AND e.expiry_date IS NOT NULL
      AND e.date_obtained > e.expiry_date
      THEN NULL
    ELSE e.date_obtained
  END,
  e.expiry_date,
  CASE
    WHEN lower(trim(e.type)) = 'pilot certificate' THEN 'Recreational Aviation Australia'
    ELSE 'Civil Aviation Safety Authority'
  END,
  e.instructor_id,
  e.is_active
FROM public.endorsements e
LEFT JOIN public.students s ON s.id = e.student_id
WHERE lower(trim(e.type)) IN (
  'pilot certificate',
  'recreational pilots licence rpl (a)',
  'rpl(a) aeroplane category rating'
)
ON CONFLICT DO NOTHING;

-- If two legacy RPL labels existed, retain one active CASA RPL licence.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY student_id, lower(trim(type))
           ORDER BY date_obtained DESC NULLS LAST, created_at DESC, id
         ) AS rn
  FROM public.licences
  WHERE is_active
)
UPDATE public.licences l
SET is_active = false,
    updated_at = now()
FROM ranked r
WHERE l.id = r.id AND r.rn > 1;

DROP TRIGGER IF EXISTS sync_member_role_after_endorsement_change ON public.endorsements;

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

CREATE OR REPLACE FUNCTION public.handle_licence_role_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sync_member_role_from_licences(COALESCE(NEW.student_id, OLD.student_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.handle_licence_role_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_licence_role_sync() TO service_role;

CREATE TRIGGER sync_member_role_after_licence_change
AFTER INSERT OR UPDATE OR DELETE ON public.licences
FOR EACH ROW EXECUTE FUNCTION public.handle_licence_role_sync();

-- Existing courses that issued a licence-like endorsement now issue a licence instead.
UPDATE public.training_courses
SET completion_licence_enabled = true,
    completion_licence_type = CASE
      WHEN lower(trim(completion_endorsement_type)) = 'pilot certificate'
        THEN 'RAAus Pilot Certificate'
      ELSE 'CASA Recreational Pilot Licence (RPL)'
    END,
    completion_licence_expiry_months = completion_endorsement_expiry_months,
    completion_endorsement_enabled = false,
    completion_endorsement_type = NULL,
    completion_endorsement_expiry_months = NULL
WHERE lower(trim(coalesce(completion_endorsement_type, ''))) IN (
  'pilot certificate',
  'recreational pilots licence rpl (a)',
  'rpl(a) aeroplane category rating'
);

UPDATE public.training_syllabus_settings
SET endorsement_types = ARRAY(
      SELECT value
      FROM unnest(endorsement_types) value
      WHERE lower(trim(value)) NOT IN (
        'pilot certificate',
        'recreational pilots licence rpl (a)',
        'rpl(a) aeroplane category rating'
      )
    ),
    pilot_status_endorsement_types = '{}'::text[],
    updated_at = now();

DELETE FROM public.endorsements
WHERE lower(trim(type)) IN (
  'pilot certificate',
  'recreational pilots licence rpl (a)',
  'rpl(a) aeroplane category rating'
);

-- Reconcile roles once after the conversion.
DO $$
DECLARE
  member record;
BEGIN
  FOR member IN SELECT id FROM public.users LOOP
    PERFORM public.sync_member_role_from_licences(member.id);
  END LOOP;
END;
$$;

COMMENT ON COLUMN public.training_syllabus_settings.pilot_status_endorsement_types IS
  'Deprecated. Endorsements no longer grant Pilot status; active licences do.';

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
      AND EXISTS (SELECT 1 FROM unnest(aircraft_row.required_endorsement_types) required WHERE lower(trim(required)) = lower(trim(held.type)))
  ) INTO meets_any_endorsement;

  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(aircraft_row.required_licence_all_types) required
    WHERE NOT EXISTS (
      SELECT 1 FROM public.licences held
      WHERE held.student_id = NEW.student_id AND held.is_active
        AND (held.expiry_date IS NULL OR held.expiry_date >= CURRENT_DATE)
        AND lower(trim(held.type)) = lower(trim(required))
    )
  ) INTO meets_all_licences;

  SELECT cardinality(aircraft_row.required_licence_types) = 0 OR EXISTS (
    SELECT 1 FROM public.licences held
    WHERE held.student_id = NEW.student_id AND held.is_active
      AND (held.expiry_date IS NULL OR held.expiry_date >= CURRENT_DATE)
      AND EXISTS (SELECT 1 FROM unnest(aircraft_row.required_licence_types) required WHERE lower(trim(required)) = lower(trim(held.type)))
  ) INTO meets_any_licence;

  IF NOT (meets_all_endorsements AND meets_any_endorsement AND meets_all_licences AND meets_any_licence) THEN
    RAISE EXCEPTION 'Pilot does not hold the licences and endorsements required for solo hire of this aircraft'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_aircraft_solo_hire_qualifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_aircraft_solo_hire_qualifications() TO service_role;

CREATE TRIGGER enforce_aircraft_solo_hire_qualifications_trigger
BEFORE INSERT OR UPDATE OF student_id, instructor_id, aircraft_id, deleted_at ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_aircraft_solo_hire_qualifications();
