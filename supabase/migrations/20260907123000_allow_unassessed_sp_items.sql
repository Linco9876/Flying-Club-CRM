-- An S&P check may legitimately leave sections not assessed. Only a
-- "Needs attention" result makes the check remedial. Instructor renewals
-- retain their stricter requirement that every required evidence item is
-- assessed.
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
  v_course_check_type text;
  v_previous_renewal_due date;
BEGIN
  IF NOT public.current_user_is_cfi() THEN
    RAISE EXCEPTION 'Only a user with CFI/DCFI review authority can manage instructor compliance records';
  END IF;

  IF NEW.examiner_cfi_id <> auth.uid() THEN
    RAISE EXCEPTION 'The signed-in CFI/DCFI reviewer must be the examiner';
  END IF;

  SELECT check_type INTO v_course_check_type
  FROM public.instructor_compliance_courses
  WHERE id = NEW.course_id;

  IF v_course_check_type IS NOT NULL AND NEW.check_type <> v_course_check_type THEN
    RAISE EXCEPTION 'The selected instructor review form does not match the record type';
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
    IF NEW.check_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'An instructor check cannot be completed with a future date';
    END IF;
    IF NOT NEW.medical_sighted THEN
      RAISE EXCEPTION 'A current approved instructor medical must be sighted before completion';
    END IF;
    IF NOT NEW.emergency_control_plan_confirmed THEN
      RAISE EXCEPTION 'The real-emergency control plan must be confirmed before completion';
    END IF;
    IF btrim(NEW.briefing_lesson) = '' THEN
      RAISE EXCEPTION 'The examiner-nominated briefing lesson is required';
    END IF;
    IF jsonb_typeof(NEW.checklist) <> 'array' THEN
      RAISE EXCEPTION 'The CFI/DCFI checklist must be a JSON array';
    END IF;

    -- Renewals still require every required evidence item. S&P checks allow
    -- Not assessed because not every area must be sampled at every check.
    IF NEW.check_type <> 'sp_check' THEN
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
        RAISE EXCEPTION '% required CFI/DCFI checklist items have not been assessed', v_missing_required;
      END IF;
    END IF;

    SELECT count(*) INTO v_unsatisfactory
    FROM jsonb_array_elements(NEW.checklist) result
    WHERE result->>'result' = 'unsatisfactory';

    -- Derive both fields on the server so a client cannot accidentally grant
    -- currency when any item has been marked Needs attention.
    IF v_unsatisfactory > 0 THEN
      NEW.outcome := 'unsatisfactory';
      NEW.status := 'remedial_required';
    ELSE
      NEW.outcome := 'satisfactory';
      NEW.status := 'completed';
    END IF;

    IF v_unsatisfactory > 0 AND btrim(coalesce(NEW.development_plan, '')) = '' THEN
      RAISE EXCEPTION 'A development or remedial plan is required for an unsatisfactory check';
    END IF;
    IF NEW.outcome = 'satisfactory' AND NEW.flight_minutes < 60 THEN
      RAISE EXCEPTION 'A satisfactory RAAus instructor check must record at least 60 minutes in flight';
    END IF;
    IF NOT NEW.logbook_entries_confirmed THEN
      RAISE EXCEPTION 'Confirm the result was entered in both the candidate and CFI/DCFI logbooks';
    END IF;
    IF NEW.check_type = 'renewal' AND NEW.raaus_form_path IS NULL THEN
      RAISE EXCEPTION 'The completed current RAAus instructor renewal form must be attached';
    END IF;
    IF NEW.check_type = 'renewal'
       AND NEW.outcome = 'satisfactory'
       AND NOT NEW.authority_submission_confirmed THEN
      RAISE EXCEPTION 'Confirm the completed renewal was supplied to RAAus for processing';
    END IF;

    NEW.completed_at := COALESCE(NEW.completed_at, now());
    IF NEW.outcome = 'satisfactory' THEN
      NEW.next_sp_check_due := NEW.check_date + CASE
        WHEN NEW.instructor_level = 'senior_instructor' THEN INTERVAL '12 months'
        ELSE INTERVAL '90 days'
      END;

      IF NEW.check_type = 'renewal' THEN
        SELECT max(record.next_renewal_due)
        INTO v_previous_renewal_due
        FROM public.instructor_compliance_records record
        WHERE record.candidate_instructor_id = NEW.candidate_instructor_id
          AND record.id <> NEW.id
          AND record.status = 'completed'
          AND record.outcome = 'satisfactory'
          AND record.voided_at IS NULL
          AND record.next_renewal_due IS NOT NULL;

        NEW.next_renewal_due := CASE
          WHEN v_previous_renewal_due IS NOT NULL
            AND NEW.check_date BETWEEN v_previous_renewal_due - 90
                                   AND v_previous_renewal_due + 90
            THEN (v_previous_renewal_due + INTERVAL '2 years')::date
          ELSE (NEW.check_date + INTERVAL '2 years')::date
        END;
      END IF;
    ELSE
      NEW.next_sp_check_due := NEW.check_date;
      NEW.next_renewal_due := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prepare_instructor_compliance_record() IS
  'Validates instructor compliance records, permits neutral Not assessed S&P items, and forces Needs attention results to remedial status.';

REVOKE ALL ON FUNCTION public.prepare_instructor_compliance_record()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.assert_function_permission_manifest();
