-- Flight review/test authority must be backed by roles that can actually be
-- assigned in the CRM. Legacy examiner labels were template-only strings and
-- therefore could not provide an enforceable permission boundary.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.normalise_crm_reviewer_roles(p_roles jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH mapped AS (
    SELECT DISTINCT CASE lower(btrim(role_value))
      WHEN 'pilot_examiner' THEN 'cfi'
      WHEN 'flight_examiner' THEN 'cfi'
      WHEN 'admin' THEN 'admin'
      WHEN 'cfi' THEN 'cfi'
      WHEN 'senior_instructor' THEN 'senior_instructor'
      WHEN 'instructor' THEN 'instructor'
      ELSE NULL
    END AS role
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_roles) = 'array' THEN p_roles ELSE '[]'::jsonb END
    ) AS supplied(role_value)
  )
  SELECT coalesce(jsonb_agg(role ORDER BY role) FILTER (WHERE role IS NOT NULL), '[]'::jsonb)
  FROM mapped;
$$;

REVOKE ALL ON FUNCTION private.normalise_crm_reviewer_roles(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.normalise_crm_reviewer_roles(jsonb) TO service_role;

-- Preserve the intent of existing templates while replacing the two labels
-- that never existed in public.user_roles with the assignable CFI authority.
UPDATE public.training_courses
SET review_configuration = jsonb_set(
  CASE WHEN jsonb_typeof(review_configuration) = 'object'
    THEN review_configuration ELSE '{}'::jsonb END,
  '{allowed_reviewer_roles}',
  CASE
    WHEN private.normalise_crm_reviewer_roles(review_configuration->'allowed_reviewer_roles') = '[]'::jsonb
      THEN '["cfi","instructor","senior_instructor"]'::jsonb
    ELSE private.normalise_crm_reviewer_roles(review_configuration->'allowed_reviewer_roles')
  END,
  true
)
WHERE course_purpose IN ('flight_review', 'flight_test', 'proficiency_check');

-- A record keeps an immutable template snapshot, so migrate those snapshots as
-- well. This ensures old in-progress records use the same CRM-backed rules.
UPDATE public.flight_review_records
SET template_snapshot = jsonb_set(
  CASE WHEN jsonb_typeof(template_snapshot) = 'object'
    THEN template_snapshot ELSE '{}'::jsonb END,
  '{review_configuration}',
  (
    CASE WHEN jsonb_typeof(template_snapshot->'review_configuration') = 'object'
      THEN template_snapshot->'review_configuration' ELSE '{}'::jsonb END
  ) || jsonb_build_object(
    'allowed_reviewer_roles',
    CASE
      WHEN private.normalise_crm_reviewer_roles(
        template_snapshot->'review_configuration'->'allowed_reviewer_roles'
      ) = '[]'::jsonb
        THEN '["cfi","instructor","senior_instructor"]'::jsonb
      ELSE private.normalise_crm_reviewer_roles(
        template_snapshot->'review_configuration'->'allowed_reviewer_roles'
      )
    END
  ),
  true
);

CREATE OR REPLACE FUNCTION private.crm_user_has_reviewer_role(
  p_user_id uuid,
  p_allowed_roles jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH allowed AS (
    SELECT role_value
    FROM jsonb_array_elements_text(
      private.normalise_crm_reviewer_roles(p_allowed_roles)
    ) AS roles(role_value)
  )
  SELECT p_user_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM allowed)
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_roles assigned
        JOIN allowed ON allowed.role_value = assigned.role
        WHERE assigned.user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.users crm_user
        JOIN allowed ON allowed.role_value = crm_user.role
        WHERE crm_user.id = p_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.users crm_user
        JOIN allowed ON allowed.role_value = 'senior_instructor'
        WHERE crm_user.id = p_user_id
          AND coalesce(crm_user.is_senior_instructor, false)
      )
    );
$$;

REVOKE ALL ON FUNCTION private.crm_user_has_reviewer_role(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.crm_user_has_reviewer_role(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.validate_review_template_crm_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roles jsonb := coalesce(NEW.review_configuration->'allowed_reviewer_roles', '[]'::jsonb);
  v_invalid_roles integer;
BEGIN
  IF NEW.course_purpose NOT IN ('flight_review', 'flight_test', 'proficiency_check') THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v_roles) <> 'array' OR jsonb_array_length(v_roles) = 0 THEN
    RAISE EXCEPTION 'Choose at least one CRM role that can conduct or verify this review';
  END IF;

  SELECT count(*)
  INTO v_invalid_roles
  FROM jsonb_array_elements_text(v_roles) AS supplied(role_value)
  WHERE lower(btrim(role_value)) NOT IN ('admin', 'cfi', 'senior_instructor', 'instructor');

  IF v_invalid_roles > 0 THEN
    RAISE EXCEPTION 'Reviewer roles must be assigned CRM roles: admin, cfi, senior_instructor or instructor';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_review_template_crm_roles() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_review_template_crm_roles() TO service_role;

DROP TRIGGER IF EXISTS validate_review_template_crm_roles ON public.training_courses;
CREATE TRIGGER validate_review_template_crm_roles
BEFORE INSERT OR UPDATE OF course_purpose, review_configuration
ON public.training_courses
FOR EACH ROW
EXECUTE FUNCTION private.validate_review_template_crm_roles();

CREATE OR REPLACE FUNCTION private.validate_flight_review_reviewer_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roles jsonb := coalesce(
    NEW.template_snapshot->'review_configuration'->'allowed_reviewer_roles',
    '[]'::jsonb
  );
  v_verifier_id uuid := coalesce(NEW.reviewer_user_id, NEW.updated_by, NEW.created_by);
  v_actor_id uuid;
  v_validate_assignment boolean := TG_OP = 'INSERT';
  v_validate_outcome boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_validate_assignment := NEW.reviewer_user_id IS DISTINCT FROM OLD.reviewer_user_id
      OR NEW.template_snapshot IS DISTINCT FROM OLD.template_snapshot;
    v_validate_outcome := NEW.status IN ('completed', 'further_training_required')
      AND NEW.status IS DISTINCT FROM OLD.status;
  ELSE
    v_validate_outcome := NEW.status IN ('completed', 'further_training_required');
  END IF;

  IF v_validate_assignment OR v_validate_outcome THEN
    IF jsonb_typeof(v_roles) <> 'array'
      OR private.normalise_crm_reviewer_roles(v_roles) = '[]'::jsonb THEN
      RAISE EXCEPTION 'This review template has no valid CRM reviewer role configured';
    END IF;

    IF NOT private.crm_user_has_reviewer_role(v_verifier_id, v_roles) THEN
      RAISE EXCEPTION 'The assigned reviewer or verifier does not hold a CRM role authorised by this template';
    END IF;
  END IF;

  IF v_validate_outcome THEN
    v_actor_id := coalesce((SELECT auth.uid()), NEW.updated_by, NEW.created_by);
    IF NOT private.crm_user_has_reviewer_role(v_actor_id, v_roles) THEN
      RAISE EXCEPTION 'Your CRM role is not authorised to complete or verify this review';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_flight_review_reviewer_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_flight_review_reviewer_role() TO service_role;

DROP TRIGGER IF EXISTS validate_flight_review_reviewer_role ON public.flight_review_records;
CREATE TRIGGER validate_flight_review_reviewer_role
BEFORE INSERT OR UPDATE OF reviewer_user_id, template_snapshot, status
ON public.flight_review_records
FOR EACH ROW
EXECUTE FUNCTION private.validate_flight_review_reviewer_role();

CREATE OR REPLACE FUNCTION private.current_user_can_conduct_flight_review(p_record_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.flight_review_records review_record
    WHERE review_record.id = p_record_id
      AND private.crm_user_has_reviewer_role(
        (SELECT auth.uid()),
        review_record.template_snapshot->'review_configuration'->'allowed_reviewer_roles'
      )
  );
$$;

REVOKE ALL ON FUNCTION private.current_user_can_conduct_flight_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_can_conduct_flight_review(uuid) TO authenticated, service_role;

-- Reading remains available to relevant staff, but changing an assessment is
-- now limited to a user who currently holds one of the template's CRM roles.
DROP POLICY IF EXISTS "Staff can update review records" ON public.flight_review_records;
CREATE POLICY "Authorised CRM reviewers can update review records"
ON public.flight_review_records FOR UPDATE TO authenticated
USING (
  private.can_manage_flight_reviews()
  AND private.current_user_can_conduct_flight_review(id)
)
WITH CHECK (
  private.can_manage_flight_reviews()
  AND private.current_user_can_conduct_flight_review(id)
);

DROP POLICY IF EXISTS "Staff can create review items" ON public.flight_review_record_items;
CREATE POLICY "Authorised CRM reviewers can create review items"
ON public.flight_review_record_items FOR INSERT TO authenticated
WITH CHECK (
  private.current_user_can_conduct_flight_review(review_record_id)
  OR (
    result = 'not_assessed'
    AND nullif(btrim(notes), '') IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.flight_review_records review_record
      WHERE review_record.id = review_record_id
        AND review_record.created_by = (SELECT auth.uid())
        AND review_record.status = 'draft'
    )
  )
);

DROP POLICY IF EXISTS "Staff can update review items" ON public.flight_review_record_items;
CREATE POLICY "Authorised CRM reviewers can update review items"
ON public.flight_review_record_items FOR UPDATE TO authenticated
USING (private.current_user_can_conduct_flight_review(review_record_id))
WITH CHECK (private.current_user_can_conduct_flight_review(review_record_id));

DROP POLICY IF EXISTS "Staff can delete review items" ON public.flight_review_record_items;
CREATE POLICY "Authorised CRM reviewers can delete review items"
ON public.flight_review_record_items FOR DELETE TO authenticated
USING (private.current_user_can_conduct_flight_review(review_record_id));

COMMENT ON FUNCTION private.crm_user_has_reviewer_role(uuid, jsonb) IS
  'Returns whether a user currently holds at least one CRM role authorised by a flight review/test template.';
