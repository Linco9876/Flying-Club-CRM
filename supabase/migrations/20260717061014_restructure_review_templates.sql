ALTER TABLE public.instructor_compliance_courses
  ADD COLUMN IF NOT EXISTS check_type text;

ALTER TABLE public.instructor_compliance_courses
  DROP CONSTRAINT IF EXISTS instructor_compliance_courses_check_type_check;

ALTER TABLE public.instructor_compliance_courses
  ADD CONSTRAINT instructor_compliance_courses_check_type_check
  CHECK (check_type IS NULL OR check_type IN ('sp_check', 'renewal'));

-- Preserve the combined form for historical record labels, but remove it from
-- the template picker. Submitted records continue to reference its snapshot.
UPDATE public.instructor_compliance_courses
SET is_active = false,
    updated_at = now()
WHERE name = 'RAAus Instructor Standards & Proficiency / Renewal';

INSERT INTO public.instructor_compliance_courses (
  name, description, version, source_documents, check_type, is_active
)
SELECT
  seed.name,
  seed.description,
  '2026.2',
  '[{"name":"RAAP 7 v2.0","purpose":"Conduct and standards for RAAus instructor S&P checks and renewals"},{"name":"RAAus Flight Operations Manual sections 2.08-2.09","purpose":"Instructor and Senior Instructor currency requirements"}]'::jsonb,
  seed.check_type,
  true
FROM (VALUES
  (
    'RAAus Instructor Standards & Proficiency Check',
    'CFI-only recurring standards and proficiency form. Use every 90 days for an Instructor and every 12 months for a Senior Instructor.',
    'sp_check'
  ),
  (
    'RAAus Instructor Rating Renewal',
    'CFI-only two-year Instructor or Senior Instructor rating renewal form, including the completed current RAAus renewal form.',
    'renewal'
  )
) AS seed(name, description, check_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.instructor_compliance_courses existing
  WHERE lower(existing.name) = lower(seed.name)
);

UPDATE public.instructor_compliance_courses
SET check_type = CASE
      WHEN name = 'RAAus Instructor Rating Renewal' THEN 'renewal'
      ELSE 'sp_check'
    END,
    is_active = true,
    version = '2026.2',
    updated_at = now()
WHERE name IN (
  'RAAus Instructor Standards & Proficiency Check',
  'RAAus Instructor Rating Renewal'
);

DELETE FROM public.instructor_compliance_course_items item
USING public.instructor_compliance_courses course
WHERE item.course_id = course.id
  AND course.name IN (
    'RAAus Instructor Standards & Proficiency Check',
    'RAAus Instructor Rating Renewal'
  );

INSERT INTO public.instructor_compliance_course_items (
  course_id, section, code, title, guidance, sort_order, required,
  applicable_levels, applicable_check_types
)
SELECT
  target.id,
  source_item.section,
  source_item.code,
  source_item.title,
  source_item.guidance,
  source_item.sort_order,
  source_item.required,
  source_item.applicable_levels,
  ARRAY[target.check_type]::text[]
FROM public.instructor_compliance_courses target
JOIN public.instructor_compliance_courses source_course
  ON source_course.name = 'RAAus Instructor Standards & Proficiency / Renewal'
JOIN public.instructor_compliance_course_items source_item
  ON source_item.course_id = source_course.id
WHERE target.name IN (
    'RAAus Instructor Standards & Proficiency Check',
    'RAAus Instructor Rating Renewal'
  )
  AND (
    (
      target.check_type = ANY(source_item.applicable_check_types)
      AND source_item.code <> 'ADM-05'
    )
    OR (
      target.name = 'RAAus Instructor Rating Renewal'
      AND source_item.code = 'ADM-05'
    )
  );

-- The initial issue is a qualification flight test, not a recurring internal
-- instructor review. Build it in the general review/test library.
INSERT INTO public.training_courses (
  title, description, category, version, status, estimated_duration_hours,
  tags, course_purpose, review_configuration,
  requires_student_acknowledgement, created_by, last_updated
)
SELECT
  'RAAus Instructor Rating Initial Issue',
  'Initial issue assessment for a RAAus Instructor or Senior Instructor rating, completed by an authorised RAAus examiner.',
  'Flight Tests',
  '2.0',
  'published',
  4,
  ARRAY['RAAus', 'instructor', 'initial issue', 'flight test'],
  'flight_test',
  jsonb_build_object(
    'review_type', 'raaus_instructor_initial_issue',
    'authority', 'raaus',
    'outcome_scheme', 'pass_fail',
    'minimum_ground_minutes', 60,
    'minimum_flight_minutes', 60,
    'validity_months', 0,
    'resets_flight_review', true,
    'candidate_ack_required', true,
    'allowed_reviewer_roles', jsonb_build_array('cfi'),
    'required_evidence', jsonb_build_array('authority_form'),
    'source_documents', jsonb_build_array(
      'RAAP 7 v2.0',
      'RAAus Flight Operations Manual sections 2.08, 2.09 and 3.03'
    ),
    'requires_logbook_confirmation', true,
    'requires_authority_submission_confirmation', true,
    'requires_reviewer_summary', true,
    'completion_button_label', 'Pass initial issue assessment',
    'reviewer_summary_label', 'Examiner assessment and recommendation',
    'remedial_plan_label', 'Deficiencies and remedial training required',
    'checklist', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', item.code,
          'section', item.section,
          'code', item.code,
          'title', item.title,
          'guidance', item.guidance,
          'required', item.required
        ) ORDER BY item.sort_order
      )
      FROM public.instructor_compliance_course_items item
      JOIN public.instructor_compliance_courses source
        ON source.id = item.course_id
      WHERE source.name = 'RAAus Instructor Standards & Proficiency / Renewal'
        AND 'initial_issue' = ANY(item.applicable_check_types)
    ), '[]'::jsonb)
  ),
  true,
  NULL,
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.training_courses existing
  WHERE lower(existing.title) = lower('RAAus Instructor Rating Initial Issue')
    AND existing.course_purpose = 'flight_test'
);

-- Replace the generic external-test shell with the actual RAAus RPC001
-- examiner record and the Pilot Certificate competency profile.
UPDATE public.training_courses
SET title = 'RAAus RPC Flight Test',
    description = 'Examiner form for the initial issue of a RAAus Recreational Pilot Certificate, including prerequisites, Pilot Certificate competency checks, examiner notes and RPC001 evidence.',
    category = 'Flight Tests',
    version = '3.1',
    tags = ARRAY['RAAus', 'RPC', 'Pilot Certificate', 'flight test'],
    course_purpose = 'flight_test',
    requires_student_acknowledgement = true,
    review_configuration = jsonb_build_object(
      'review_type', 'raaus_rpc_flight_test',
      'authority', 'raaus',
      'outcome_scheme', 'pass_fail',
      'minimum_ground_minutes', 0,
      'minimum_flight_minutes', 0,
      'validity_months', 0,
      'resets_flight_review', true,
      'candidate_ack_required', true,
      'allowed_reviewer_roles', jsonb_build_array('cfi'),
      'required_evidence', jsonb_build_array('authority_form'),
      'source_documents', jsonb_build_array(
        'RPC001 v3.1 July 2025',
        'RAAus Pilot Certificate GSP v5.1 July 2025',
        'RAAus Flight Operations Manual sections 2.07 and 3.03'
      ),
      'requires_logbook_confirmation', true,
      'requires_authority_submission_confirmation', true,
      'requires_reviewer_summary', true,
      'completion_button_label', 'Pass RPC flight test',
      'reviewer_summary_label', 'Examiner flight test notes and result',
      'remedial_plan_label', 'Unsatisfactory items and retraining required',
      'checklist', jsonb_build_array(
        jsonb_build_object('key','RPC-ADM-01','section','Applicant and examiner eligibility','code','RPC-ADM-01','title','Confirm valid Student or Converting Pilot Certificate and RAAus membership','guidance','Record the applicant membership number and expiry in the notes.','required',true),
        jsonb_build_object('key','RPC-ADM-02','section','Applicant and examiner eligibility','code','RPC-ADM-02','title','Confirm applicant health and English-language declarations','guidance','Confirm the RPC001 applicant declarations are complete, including any medical disclosure requirement.','required',true),
        jsonb_build_object('key','RPC-ADM-03','section','Applicant and examiner eligibility','code','RPC-ADM-03','title','Confirm examiner authority for this RPC flight test','guidance','The test must be conducted by the CFI, DCFI, or an assigned RAAus Pilot Examiner or higher approval holder. Record the examiner membership number and authority.','required',true),
        jsonb_build_object('key','RPC-ADM-04','section','Applicant and examiner eligibility','code','RPC-ADM-04','title','Record certificate aircraft group and endorsements sought','guidance','Record Group A, B or D and the Human Factors, Radio, undercarriage and any additional endorsements to be issued.','required',true),

        jsonb_build_object('key','RPC-PRE-01','section','Pre-test prerequisites','code','RPC-PRE-01','title','Confirm all required theory examinations are passed','guidance','Verify Pre-Solo Air Legislation/local procedures, Air Legislation, BAK, Human Factors and Radio requirements, plus any recognised equivalents. Record dates or references.','required',true),
        jsonb_build_object('key','RPC-PRE-02','section','Pre-test prerequisites','code','RPC-PRE-02','title','Confirm the complete RAAus syllabus has been trained and recorded','guidance','The training record must show all applicable syllabus elements at Pilot Certificate standard before test.','required',true),
        jsonb_build_object('key','RPC-PRE-03','section','Pre-test prerequisites','code','RPC-PRE-03','title','Confirm minimum aeronautical experience','guidance','For Group A or B ab-initio issue, verify at least 20 hours total training including at least 5 hours pilot in command in the same aircraft group, or document the recognised-experience pathway. Record total, dual and command hours.','required',true),
        jsonb_build_object('key','RPC-PRE-04','section','Pre-test prerequisites','code','RPC-PRE-04','title','Confirm aircraft suitability, registration and airworthiness','guidance','Record aircraft type, registration and any operational limitations relevant to the test.','required',true),
        jsonb_build_object('key','RPC-PRE-05','section','Pre-test prerequisites','code','RPC-PRE-05','title','Complete pre-flight planning and operational decision making','guidance','Assess weather, NOTAMs, airspace, fuel, weight and balance, performance and applicable local procedures.','required',true),

        jsonb_build_object('key','RPC-COMP-01','section','Pilot Certificate competency assessment','code','RPC-COMP-01','title','Flight preparation and ground operations','guidance','Assess documentation, aircraft inspection, start, taxi, checks, securing and post-flight administration at Pilot Certificate standard.','required',true),
        jsonb_build_object('key','RPC-COMP-02','section','Pilot Certificate competency assessment','code','RPC-COMP-02','title','Airmanship, operational human factors and decision making','guidance','Assess lookout, situational awareness, threat and error management, judgement, workload and safe command throughout.','required',true),
        jsonb_build_object('key','RPC-COMP-03','section','Pilot Certificate competency assessment','code','RPC-COMP-03','title','Radio equipment and procedures','guidance','Assess correct radio operation, standard calls, listening, readbacks and non-towered aerodrome procedures.','required',true),
        jsonb_build_object('key','RPC-COMP-04','section','Pilot Certificate competency assessment','code','RPC-COMP-04','title','Effects of controls and aircraft coordination','guidance','Assess primary and secondary effects, coordinated control use, trim, power, flap and balance.','required',true),
        jsonb_build_object('key','RPC-COMP-05','section','Pilot Certificate competency assessment','code','RPC-COMP-05','title','Straight and level flight','guidance','Assess accurate attitude, power, trim, lookout and altitude/airspeed control within the applicable Pilot Certificate tolerances.','required',true),
        jsonb_build_object('key','RPC-COMP-06','section','Pilot Certificate competency assessment','code','RPC-COMP-06','title','Climbing and descending','guidance','Assess entry, maintenance, level-off, lookout, engine handling and airspeed control.','required',true),
        jsonb_build_object('key','RPC-COMP-07','section','Pilot Certificate competency assessment','code','RPC-COMP-07','title','Turning, including advanced turns','guidance','Assess coordinated medium, climbing, descending and steep turns with safe lookout and height control.','required',true),
        jsonb_build_object('key','RPC-COMP-08','section','Pilot Certificate competency assessment','code','RPC-COMP-08','title','Slow flight, stall recognition and recovery','guidance','Assess approach-to-stall and stall recovery in relevant configurations, including wing-drop recognition and recovery where safe and applicable.','required',true),
        jsonb_build_object('key','RPC-COMP-09','section','Pilot Certificate competency assessment','code','RPC-COMP-09','title','Take-off, circuit, approach, landing and go-around','guidance','Assess normal take-off, circuit spacing and calls, stabilised approach, landing accuracy, crosswind considerations and go-around.','required',true),
        jsonb_build_object('key','RPC-COMP-10','section','Pilot Certificate competency assessment','code','RPC-COMP-10','title','Engine failure after take-off and engine failure in the circuit','guidance','Assess prompt control, landing-area selection, checks, calls and sound judgement in simulated EFATO and EFIC scenarios.','required',true),
        jsonb_build_object('key','RPC-COMP-11','section','Pilot Certificate competency assessment','code','RPC-COMP-11','title','Forced landing and precautionary search and landing','guidance','Assess field selection, planning, configuration, checks, calls, approach judgement and safe discontinuation.','required',true),
        jsonb_build_object('key','RPC-COMP-12','section','Pilot Certificate competency assessment','code','RPC-COMP-12','title','Operations in the training area','guidance','Assess departure, arrival, orientation, area boundaries, traffic separation and local operating procedures.','required',true),
        jsonb_build_object('key','RPC-COMP-13','section','Pilot Certificate competency assessment','code','RPC-COMP-13','title','Aircraft equipment, systems and limitations','guidance','Assess practical knowledge and correct use of aircraft systems, instruments, equipment and POH limitations.','required',true),
        jsonb_build_object('key','RPC-COMP-14','section','Pilot Certificate competency assessment','code','RPC-COMP-14','title','Abnormal situations, emergencies and undesired aircraft states','guidance','Assess recognition, prioritisation, aircraft control, checklist use, communication and recovery appropriate to the aircraft.','required',true),
        jsonb_build_object('key','RPC-COMP-15','section','Pilot Certificate competency assessment','code','RPC-COMP-15','title','Pilot Certificate flight tolerances and command standard','guidance','Confirm the candidate consistently controls the aircraft within the current RAAus Pilot Certificate tolerances and safely adapts to changing conditions without instructional assistance.','required',true),

        jsonb_build_object('key','RPC-CMP-01','section','Examiner completion','code','RPC-CMP-01','title','Record aircraft, flight duration and aeronautical experience on RPC001','guidance','Complete aircraft type, registration, flight duration, total command, total dual and total RAAus aircraft hours.','required',true),
        jsonb_build_object('key','RPC-CMP-02','section','Examiner completion','code','RPC-CMP-02','title','Record competency evidence and any limitations in the examiner notes','guidance','Summarise the test profile, standard demonstrated, significant observations and any limitations or retraining.','required',true),
        jsonb_build_object('key','RPC-CMP-03','section','Examiner completion','code','RPC-CMP-03','title','Complete and sign the candidate logbook entry','guidance','Verify the recorded hours are true and correct.','required',true),
        jsonb_build_object('key','RPC-CMP-04','section','Examiner completion','code','RPC-CMP-04','title','Complete examiner declaration and signed RPC001','guidance','The examiner certifies syllabus competency, examinations, experience, flight test result and compliant training. Upload the completed current RPC001.','required',true),
        jsonb_build_object('key','RPC-CMP-05','section','Examiner completion','code','RPC-CMP-05','title','Submit the Pilot Certificate issue recommendation to RAAus','guidance','Confirm the completed application and supporting evidence have been supplied to RAAus for processing.','required',true)
      )
    ),
    last_updated = now()
WHERE lower(title) = lower('External Flight Test')
  AND course_purpose = 'flight_test';

-- Apply the richer completion requirements to future records without changing
-- any existing record snapshots.
CREATE OR REPLACE FUNCTION public.validate_flight_review_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  config jsonb := COALESCE(NEW.template_snapshot->'review_configuration', '{}'::jsonb);
  minimum_ground integer := COALESCE((config->>'minimum_ground_minutes')::integer, 0);
  minimum_flight integer := COALESCE((config->>'minimum_flight_minutes')::integer, 0);
  validity_months integer := COALESCE((config->>'validity_months')::integer, 0);
  missing_required integer;
  evidence_type text;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    SELECT count(*) INTO missing_required
    FROM public.flight_review_record_items item
    WHERE item.review_record_id = NEW.id
      AND item.required
      AND item.result <> 'satisfactory';

    IF missing_required > 0 THEN
      RAISE EXCEPTION '% required review items have not been assessed as satisfactory', missing_required;
    END IF;
    IF NEW.completion_date IS NULL THEN
      RAISE EXCEPTION 'Completion date is required';
    END IF;
    IF nullif(trim(NEW.reviewer_sign_name), '') IS NULL OR NEW.reviewer_sign_at IS NULL THEN
      RAISE EXCEPTION 'Reviewer signature is required';
    END IF;
    IF COALESCE((config->>'requires_reviewer_summary')::boolean, false)
       AND nullif(trim(NEW.reviewer_summary), '') IS NULL THEN
      RAISE EXCEPTION 'Examiner notes and outcome summary are required';
    END IF;
    IF (NEW.ground_minutes < minimum_ground OR NEW.flight_minutes < minimum_flight)
       AND nullif(trim(NEW.minimums_override_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Review duration is below the template minimum; record an override reason';
    END IF;
    IF (NEW.review_type = 'raaus_bfr'
        OR COALESCE((config->>'requires_logbook_confirmation')::boolean, false))
       AND NOT NEW.logbook_entry_confirmed THEN
      RAISE EXCEPTION 'The candidate logbook entry must be confirmed';
    END IF;
    IF (NEW.review_type = 'raaus_bfr'
        OR COALESCE((config->>'requires_authority_submission_confirmation')::boolean, false))
       AND NOT NEW.authority_submission_confirmed THEN
      RAISE EXCEPTION 'The RAAus form submission must be confirmed';
    END IF;

    FOR evidence_type IN
      SELECT jsonb_array_elements_text(COALESCE(config->'required_evidence', '[]'::jsonb))
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.flight_review_attachments attachment
        WHERE attachment.review_record_id = NEW.id
          AND attachment.category = evidence_type
      ) THEN
        RAISE EXCEPTION 'Required evidence is missing: %', evidence_type;
      END IF;
    END LOOP;

    IF validity_months > 0 AND NEW.next_review_due IS NULL THEN
      NEW.next_review_due := NEW.completion_date + make_interval(months => validity_months);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- A form owns exactly one operational purpose. This prevents a renewal being
-- accidentally stored as an S&P check or vice versa.
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
BEGIN
  IF NOT public.current_user_is_cfi() THEN
    RAISE EXCEPTION 'Only a CFI can manage instructor compliance records';
  END IF;

  IF NEW.examiner_cfi_id <> auth.uid() THEN
    RAISE EXCEPTION 'The signed-in CFI must be the examiner';
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
      IF NEW.check_type = 'renewal' THEN
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

DROP FUNCTION IF EXISTS public.save_instructor_compliance_template(
  uuid, text, text, text, jsonb, boolean, jsonb
);

CREATE FUNCTION public.save_instructor_compliance_template(
  p_course_id uuid,
  p_name text,
  p_description text,
  p_version text,
  p_source_documents jsonb,
  p_check_type text,
  p_is_active boolean,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_course_id uuid;
  v_item jsonb;
  v_position bigint;
  v_code text;
  v_levels text[];
  v_check_types text[];
  v_seen_codes text[] := ARRAY[]::text[];
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.current_user_is_cfi() THEN
    RAISE EXCEPTION 'CFI authority is required to edit instructor review forms';
  END IF;
  IF p_check_type NOT IN ('sp_check', 'renewal') THEN
    RAISE EXCEPTION 'Instructor review forms must be either S&P or renewal';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Form name is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one checklist item is required';
  END IF;
  IF p_source_documents IS NULL OR jsonb_typeof(p_source_documents) <> 'array' THEN
    RAISE EXCEPTION 'Source documents must be an array';
  END IF;

  IF p_course_id IS NULL THEN
    INSERT INTO public.instructor_compliance_courses (
      name, description, version, source_documents, check_type, is_active, updated_at
    ) VALUES (
      btrim(p_name), coalesce(btrim(p_description), ''),
      coalesce(nullif(btrim(p_version), ''), '1.0'), p_source_documents,
      p_check_type, coalesce(p_is_active, true), now()
    ) RETURNING id INTO v_course_id;
  ELSE
    UPDATE public.instructor_compliance_courses
    SET name = btrim(p_name),
        description = coalesce(btrim(p_description), ''),
        version = coalesce(nullif(btrim(p_version), ''), '1.0'),
        source_documents = p_source_documents,
        check_type = p_check_type,
        is_active = coalesce(p_is_active, true),
        updated_at = now()
    WHERE id = p_course_id
    RETURNING id INTO v_course_id;

    IF v_course_id IS NULL THEN
      RAISE EXCEPTION 'Instructor review form was not found';
    END IF;
    DELETE FROM public.instructor_compliance_course_items WHERE course_id = v_course_id;
  END IF;

  FOR v_item, v_position IN
    SELECT entry.value, entry.ordinality
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinality)
  LOOP
    v_code := upper(btrim(coalesce(v_item->>'code', '')));
    IF v_code = '' THEN RAISE EXCEPTION 'Every checklist item requires a code'; END IF;
    IF nullif(btrim(coalesce(v_item->>'section', '')), '') IS NULL
       OR nullif(btrim(coalesce(v_item->>'title', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Every checklist item requires a section and title';
    END IF;
    IF v_code = ANY(v_seen_codes) THEN
      RAISE EXCEPTION 'Checklist item code % is duplicated', v_code;
    END IF;

    SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO v_levels
    FROM jsonb_array_elements_text(coalesce(v_item->'applicable_levels', '[]'::jsonb));
    SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO v_check_types
    FROM jsonb_array_elements_text(coalesce(v_item->'applicable_check_types', '[]'::jsonb));

    IF cardinality(v_levels) = 0 OR NOT (v_levels <@ ARRAY['instructor', 'senior_instructor']::text[]) THEN
      RAISE EXCEPTION 'Checklist item % has invalid instructor applicability', v_code;
    END IF;
    IF v_check_types <> ARRAY[p_check_type]::text[] THEN
      RAISE EXCEPTION 'Checklist item % must match the form purpose', v_code;
    END IF;

    INSERT INTO public.instructor_compliance_course_items (
      course_id, section, code, title, guidance, sort_order, required,
      applicable_levels, applicable_check_types
    ) VALUES (
      v_course_id, btrim(v_item->>'section'), v_code, btrim(v_item->>'title'),
      coalesce(btrim(v_item->>'guidance'), ''), ((v_position - 1) * 10)::integer,
      coalesce((v_item->>'required')::boolean, true), v_levels, v_check_types
    );
    v_seen_codes := array_append(v_seen_codes, v_code);
  END LOOP;

  RETURN v_course_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_instructor_compliance_template(
  uuid, text, text, text, jsonb, text, boolean, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_instructor_compliance_template(
  uuid, text, text, text, jsonb, text, boolean, jsonb
) TO authenticated, service_role;
