CREATE OR REPLACE FUNCTION public.prepare_instructor_compliance_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_senior boolean;
  v_missing_required integer := 0;
  v_unsatisfactory integer := 0;
BEGIN
  IF NOT public.current_user_is_cfi() THEN
    RAISE EXCEPTION 'Only a CFI can manage instructor compliance records';
  END IF;

  IF NEW.examiner_cfi_id <> auth.uid() THEN
    RAISE EXCEPTION 'The signed-in CFI must be the examiner';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.candidate_instructor_id
      AND role = 'senior_instructor'
  ) INTO v_is_senior;

  IF NOT v_is_senior AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.candidate_instructor_id
      AND role = 'instructor'
  ) THEN
    RAISE EXCEPTION 'The candidate must hold an Instructor or Senior Instructor role';
  END IF;

  NEW.instructor_level := CASE WHEN v_is_senior THEN 'senior_instructor' ELSE 'instructor' END;
  NEW.updated_at := now();

  IF NEW.status IN ('completed', 'remedial_required') THEN
    IF NOT NEW.medical_sighted THEN
      RAISE EXCEPTION 'A current instructor medical must be sighted before completion';
    END IF;
    IF NOT NEW.emergency_control_plan_confirmed THEN
      RAISE EXCEPTION 'The real-emergency control plan must be confirmed before completion';
    END IF;
    IF btrim(NEW.briefing_lesson) = '' THEN
      RAISE EXCEPTION 'The examiner-nominated briefing lesson is required';
    END IF;
    IF jsonb_typeof(NEW.checklist) <> 'array' THEN
      RAISE EXCEPTION 'The CFI checklist must be a JSON array';
    END IF;

    SELECT count(*) INTO v_missing_required
    FROM public.instructor_compliance_course_items required_item
    WHERE required_item.course_id = NEW.course_id
      AND required_item.required
      AND NEW.instructor_level = ANY(required_item.applicable_levels)
      AND NEW.check_type = ANY(required_item.applicable_check_types)
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(NEW.checklist) result
        WHERE result->>'itemId' = required_item.id::text
          AND result->>'result' IN ('satisfactory', 'unsatisfactory')
      );

    IF v_missing_required > 0 THEN
      RAISE EXCEPTION '% required CFI checklist items have not been assessed', v_missing_required;
    END IF;

    SELECT count(*) INTO v_unsatisfactory
    FROM jsonb_array_elements(NEW.checklist) result
    WHERE result->>'result' = 'unsatisfactory';

    IF v_unsatisfactory > 0 AND NEW.outcome <> 'unsatisfactory' THEN
      RAISE EXCEPTION 'The outcome must be unsatisfactory when any checklist item is below standard';
    END IF;
    IF v_unsatisfactory = 0 AND NEW.outcome <> 'satisfactory' THEN
      RAISE EXCEPTION 'The outcome must be satisfactory when all checklist items meet standard';
    END IF;
    IF v_unsatisfactory > 0 AND btrim(NEW.development_plan) = '' THEN
      RAISE EXCEPTION 'A development or remedial plan is required for an unsatisfactory check';
    END IF;
    IF NEW.check_type = 'renewal' AND NEW.raaus_form_path IS NULL THEN
      RAISE EXCEPTION 'The completed RAAus instructor renewal form must be attached';
    END IF;

    NEW.completed_at := COALESCE(NEW.completed_at, now());
    IF NEW.outcome = 'satisfactory' THEN
      NEW.next_sp_check_due := NEW.check_date + CASE
        WHEN NEW.instructor_level = 'senior_instructor' THEN INTERVAL '12 months'
        ELSE INTERVAL '90 days'
      END;
      IF NEW.check_type IN ('initial_issue', 'renewal') THEN
        NEW.next_renewal_due := NEW.check_date + INTERVAL '2 years';
      END IF;
    ELSE
      NEW.next_sp_check_due := NEW.check_date;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_instructor_compliance_record() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_instructor_compliance_record() TO service_role;
