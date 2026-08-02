-- Flight comments are the primary narrative for a flight. The separate review
-- field is reserved for adverse or non-standard findings, avoiding duplicate
-- entry on an ordinary completed review or passed test.

UPDATE public.training_courses
SET review_configuration = (
  CASE WHEN jsonb_typeof(review_configuration) = 'object'
    THEN review_configuration ELSE '{}'::jsonb END
) || jsonb_build_object(
  'requires_reviewer_summary', false,
  'reviewer_summary_label', 'Formal findings or required follow-up'
)
WHERE course_purpose IN ('flight_review', 'flight_test', 'proficiency_check');

CREATE OR REPLACE FUNCTION private.apply_review_findings_template_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.course_purpose IN ('flight_review', 'flight_test', 'proficiency_check') THEN
    NEW.review_configuration := (
      CASE WHEN jsonb_typeof(NEW.review_configuration) = 'object'
        THEN NEW.review_configuration ELSE '{}'::jsonb END
    ) || jsonb_build_object(
      'requires_reviewer_summary', false,
      'reviewer_summary_label', 'Formal findings or required follow-up'
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_review_findings_template_policy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_review_findings_template_policy() TO service_role;

DROP TRIGGER IF EXISTS apply_review_findings_template_policy ON public.training_courses;
CREATE TRIGGER apply_review_findings_template_policy
BEFORE INSERT OR UPDATE OF course_purpose, review_configuration
ON public.training_courses
FOR EACH ROW
EXECUTE FUNCTION private.apply_review_findings_template_policy();

CREATE OR REPLACE FUNCTION private.apply_review_findings_record_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apply_policy boolean := false;
BEGIN
  -- Do not alter the immutable snapshot during a candidate-only acknowledgement.
  -- The policy is applied when a record is created or its review outcome is saved.
  IF TG_OP = 'INSERT' THEN
    v_apply_policy := true;
  ELSE
    v_apply_policy := NEW.status IS DISTINCT FROM OLD.status
      OR NEW.reviewer_summary IS DISTINCT FROM OLD.reviewer_summary;
  END IF;

  IF v_apply_policy THEN
    NEW.template_snapshot := jsonb_set(
      CASE WHEN jsonb_typeof(NEW.template_snapshot) = 'object'
        THEN NEW.template_snapshot ELSE '{}'::jsonb END,
      '{review_configuration}',
      (
        CASE WHEN jsonb_typeof(NEW.template_snapshot->'review_configuration') = 'object'
          THEN NEW.template_snapshot->'review_configuration' ELSE '{}'::jsonb END
      ) || jsonb_build_object(
        'requires_reviewer_summary', false,
        'reviewer_summary_label', 'Formal findings or required follow-up'
      ),
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_review_findings_record_policy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_review_findings_record_policy() TO service_role;

DROP TRIGGER IF EXISTS apply_review_findings_record_policy ON public.flight_review_records;
CREATE TRIGGER apply_review_findings_record_policy
BEFORE INSERT OR UPDATE OF status, reviewer_summary
ON public.flight_review_records
FOR EACH ROW
EXECUTE FUNCTION private.apply_review_findings_record_policy();

CREATE OR REPLACE FUNCTION private.validate_training_record_formal_findings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(NEW.is_flight_review, false)
    AND NEW.status <> 'draft'
    AND NEW.flight_review_result IN ('fail', 'not_assessed')
    AND nullif(btrim(NEW.flight_review_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Formal findings or required follow-up are required for this flight test outcome';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_training_record_formal_findings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_training_record_formal_findings() TO service_role;

DROP TRIGGER IF EXISTS validate_training_record_formal_findings ON public.training_records;
CREATE TRIGGER validate_training_record_formal_findings
BEFORE INSERT OR UPDATE OF is_flight_review, flight_review_result, flight_review_notes, status
ON public.training_records
FOR EACH ROW
EXECUTE FUNCTION private.validate_training_record_formal_findings();

CREATE OR REPLACE FUNCTION private.validate_flight_review_formal_findings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_further_training boolean := false;
BEGIN
  IF NEW.status = 'completed' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.flight_review_record_items item
      WHERE item.review_record_id = NEW.id
        AND item.result = 'further_training'
    ) INTO v_has_further_training;
  END IF;

  IF (NEW.status = 'further_training_required' OR v_has_further_training)
    AND nullif(btrim(NEW.reviewer_summary), '') IS NULL THEN
    RAISE EXCEPTION 'Formal findings or required follow-up are required for this review outcome';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_flight_review_formal_findings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_flight_review_formal_findings() TO service_role;

DROP TRIGGER IF EXISTS validate_flight_review_formal_findings ON public.flight_review_records;
CREATE TRIGGER validate_flight_review_formal_findings
BEFORE INSERT OR UPDATE OF status, reviewer_summary
ON public.flight_review_records
FOR EACH ROW
EXECUTE FUNCTION private.validate_flight_review_formal_findings();

CREATE OR REPLACE FUNCTION private.validate_completed_review_item_findings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.result = 'further_training' AND EXISTS (
    SELECT 1
    FROM public.flight_review_records review_record
    WHERE review_record.id = NEW.review_record_id
      AND review_record.status = 'completed'
      AND nullif(btrim(review_record.reviewer_summary), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Record formal findings or required follow-up before adding further training to a completed review';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_completed_review_item_findings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_completed_review_item_findings() TO service_role;

DROP TRIGGER IF EXISTS validate_completed_review_item_findings ON public.flight_review_record_items;
CREATE TRIGGER validate_completed_review_item_findings
BEFORE INSERT OR UPDATE OF result
ON public.flight_review_record_items
FOR EACH ROW
EXECUTE FUNCTION private.validate_completed_review_item_findings();

COMMENT ON COLUMN public.training_records.flight_review_notes IS
  'Formal findings or required follow-up for an adverse or non-standard flight review/test outcome. Normal flight narrative belongs in comments.';

COMMENT ON COLUMN public.flight_review_records.reviewer_summary IS
  'Formal findings or required follow-up for an adverse or non-standard review/test outcome. Linked flight comments remain the primary narrative.';
