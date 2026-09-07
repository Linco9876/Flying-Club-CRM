-- A neutral S&P result must be the explicit `not_assessed` value. Reject
-- malformed, missing, duplicated or stale checklist entries before the main
-- compliance trigger derives the outcome and grants instructor currency.
CREATE OR REPLACE FUNCTION private.validate_instructor_compliance_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected_items integer := 0;
  v_invalid_items integer := 0;
  v_effective_level text;
BEGIN
  IF NEW.status NOT IN ('completed', 'remedial_required') THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.checklist) <> 'array' THEN
    RAISE EXCEPTION 'The CFI/DCFI checklist must be a JSON array';
  END IF;

  v_effective_level := CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = NEW.candidate_instructor_id
        AND role = 'senior_instructor'
    ) THEN 'senior_instructor'
    ELSE 'instructor'
  END;

  SELECT count(*)
  INTO v_expected_items
  FROM public.instructor_compliance_course_items course_item
  WHERE course_item.course_id = NEW.course_id
    AND v_effective_level = ANY(course_item.applicable_levels)
    AND NEW.check_type = ANY(course_item.applicable_check_types);

  IF v_expected_items = 0 THEN
    RAISE EXCEPTION 'The selected instructor review form has no applicable checklist items';
  END IF;

  IF jsonb_array_length(NEW.checklist) <> v_expected_items THEN
    RAISE EXCEPTION 'The CFI/DCFI checklist must contain every applicable item exactly once';
  END IF;

  SELECT count(*)
  INTO v_invalid_items
  FROM public.instructor_compliance_course_items course_item
  WHERE course_item.course_id = NEW.course_id
    AND v_effective_level = ANY(course_item.applicable_levels)
    AND NEW.check_type = ANY(course_item.applicable_check_types)
    AND (
      SELECT count(*)
      FROM jsonb_array_elements(NEW.checklist) checklist_item
      WHERE checklist_item->>'itemId' = course_item.id::text
        AND checklist_item->>'result' IN (
          'not_assessed',
          'satisfactory',
          'unsatisfactory'
        )
    ) <> 1;

  IF v_invalid_items > 0 THEN
    RAISE EXCEPTION 'Every applicable CFI/DCFI checklist item needs one valid result';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.validate_instructor_compliance_checklist() IS
  'Requires every applicable instructor compliance item exactly once with a recognised result before currency can be granted.';

REVOKE ALL ON FUNCTION private.validate_instructor_compliance_checklist()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS a_validate_instructor_compliance_checklist_trigger
  ON public.instructor_compliance_records;
CREATE TRIGGER a_validate_instructor_compliance_checklist_trigger
BEFORE INSERT OR UPDATE ON public.instructor_compliance_records
FOR EACH ROW EXECUTE FUNCTION private.validate_instructor_compliance_checklist();

SELECT private.assert_function_permission_manifest();
