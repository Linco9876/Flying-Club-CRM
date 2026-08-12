-- RAAus Group A/B instructor standardisation and renewal records.
-- Sources current at 7 August 2026:
--   Flight Operations Manual issue 7.1.2, sections 2.08 and 2.09
--   RAAP 7 v2.0, February 2022
--   Instructor Renewal INS002 v3.0, July 2023

ALTER TABLE public.instructor_compliance_records
  ADD COLUMN IF NOT EXISTS logbook_entries_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS authority_submission_confirmed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.instructor_compliance_records.logbook_entries_confirmed IS
  'Confirms the result was entered in both the candidate and CFI/DCFI logbooks as required by RAAP 7.';
COMMENT ON COLUMN public.instructor_compliance_records.authority_submission_confirmed IS
  'For a satisfactory renewal, confirms the completed current RAAus renewal form was supplied to RAAus for processing.';

DO $$
DECLARE
  v_sp_course_id uuid;
  v_renewal_course_id uuid;
  v_sources jsonb := jsonb_build_array(
    jsonb_build_object(
      'name', 'RAAus Flight Operations Manual issue 7.1.2 - sections 2.08 and 2.09',
      'purpose', 'Instructor and Senior Instructor privileges, S&P cadence, two-year rating validity and BFR renewal effect',
      'url', 'https://raaus.com.au/wp-content/uploads/2024/07/RAAus-Flight-Operations-Manual.pdf'
    ),
    jsonb_build_object(
      'name', 'RAAP 7 v2.0 - February 2022',
      'purpose', 'Conduct, content, tolerances, examiner authority and consequences for S&P checks and renewals',
      'url', 'https://raaus.com.au/wp-content/uploads/2023/10/raap-7-conduct-of-initial-issue-sandp-check-or-renewal-for-a-rating-or-higher-approval-holder.pdf'
    ),
    jsonb_build_object(
      'name', 'Instructor Renewal INS002 v3.0 - July 2023',
      'purpose', 'Current RAAus instructor renewal declarations, flight assessment and examiner checklist',
      'url', 'https://raaus.com.au/wp-content/uploads/2023/02/ins002-instructor-renewal-1-1.pdf'
    )
  );
BEGIN
  -- Keep old versions and their checklist rows intact for historical records.
  UPDATE public.instructor_compliance_courses
  SET is_active = false,
      updated_at = now()
  WHERE name IN (
      'RAAus Instructor Standards & Proficiency Check',
      'RAAus Instructor Rating Renewal'
    )
    AND version <> '2026.3';

  SELECT id INTO v_sp_course_id
  FROM public.instructor_compliance_courses
  WHERE name = 'RAAus Instructor Standards & Proficiency Check'
    AND version = '2026.3'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_sp_course_id IS NULL THEN
    INSERT INTO public.instructor_compliance_courses (
      name, description, version, source_documents, check_type, is_active
    ) VALUES (
      'RAAus Instructor Standards & Proficiency Check',
      'Protected Group A/B standardisation check completed by an authorised CFI or DCFI. A satisfactory result gives an Instructor 90 days of S&P currency and a Senior Instructor 12 months.',
      '2026.3', v_sources, 'sp_check', true
    ) RETURNING id INTO v_sp_course_id;
  ELSE
    UPDATE public.instructor_compliance_courses
    SET description = 'Protected Group A/B standardisation check completed by an authorised CFI or DCFI. A satisfactory result gives an Instructor 90 days of S&P currency and a Senior Instructor 12 months.',
        source_documents = v_sources,
        check_type = 'sp_check',
        is_active = true,
        updated_at = now()
    WHERE id = v_sp_course_id;
  END IF;

  SELECT id INTO v_renewal_course_id
  FROM public.instructor_compliance_courses
  WHERE name = 'RAAus Instructor Rating Renewal'
    AND version = '2026.3'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_renewal_course_id IS NULL THEN
    INSERT INTO public.instructor_compliance_courses (
      name, description, version, source_documents, check_type, is_active
    ) VALUES (
      'RAAus Instructor Rating Renewal',
      'Protected two-year Group A/B Instructor or Senior Instructor rating renewal completed by an authorised CFI or DCFI, with INS002 evidence and RAAus submission confirmation. A satisfactory renewal also resets BFR and S&P currency.',
      '2026.3', v_sources, 'renewal', true
    ) RETURNING id INTO v_renewal_course_id;
  ELSE
    UPDATE public.instructor_compliance_courses
    SET description = 'Protected two-year Group A/B Instructor or Senior Instructor rating renewal completed by an authorised CFI or DCFI, with INS002 evidence and RAAus submission confirmation. A satisfactory renewal also resets BFR and S&P currency.',
        source_documents = v_sources,
        check_type = 'renewal',
        is_active = true,
        updated_at = now()
    WHERE id = v_renewal_course_id;
  END IF;

  DELETE FROM public.instructor_compliance_course_items
  WHERE course_id IN (v_sp_course_id, v_renewal_course_id);

  -- Items common to both the recurring S&P check and two-year renewal.
  INSERT INTO public.instructor_compliance_course_items (
    course_id, section, code, title, guidance, sort_order, required,
    applicable_levels, applicable_check_types
  )
  SELECT
    course.id, item.section, item.code, item.title, item.guidance,
    item.sort_order, true, item.levels, ARRAY[course.check_type]::text[]
  FROM (VALUES
    (v_sp_course_id, 'sp_check'),
    (v_renewal_course_id, 'renewal')
  ) AS course(id, check_type)
  CROSS JOIN (VALUES
    ('Eligibility and administration', 'ADM-01', 'Confirm membership, rating, aircraft group and endorsements', 'Sight current RAAus membership, the Instructor or Senior Instructor rating, the applicable Group A/B authority and every endorsement needed for the training being conducted.', 10, ARRAY['instructor','senior_instructor']::text[]),
    ('Eligibility and administration', 'ADM-02', 'Sight a current approved instructor medical', 'Confirm a CASA Class 2 medical (not Class 2 Basic) or RAAus Instructor Medical MED003 using the document or Instructor Portal.', 20, ARRAY['instructor','senior_instructor']::text[]),
    ('Eligibility and administration', 'ADM-03', 'Review logbook, recent activity and Instructor Portal compliance', 'Confirm the candidate has reviewed current requirements and uses the Instructor Portal to check student, pilot and aircraft compliance.', 30, ARRAY['instructor','senior_instructor']::text[]),
    ('Eligibility and administration', 'ADM-04', 'Confirm aircraft registration, airworthiness and current POH', 'Confirm the assessment aircraft is suitable and the candidate can explain school airworthiness minimums, limitations and the controlling POH or flight manual.', 40, ARRAY['instructor','senior_instructor']::text[]),

    ('Ground standardisation', 'GND-01', 'Deliver the examiner-nominated pre-flight briefing using FIRM', 'The examiner acts as a student. Give the candidate a realistic place in training, connect preceding lessons, confirm prior knowledge and deliver the briefing to the FIRM standard.', 100, ARRAY['instructor','senior_instructor']::text[]),
    ('Ground standardisation', 'GND-02', 'Demonstrate in-depth aerodynamic and systems knowledge', 'Question beyond student lesson level and confirm the candidate can accurately relate the theory to aircraft handling, limitations and instructional risk.', 110, ARRAY['instructor','senior_instructor']::text[]),
    ('Ground standardisation', 'GND-03', 'Explain privileges, supervision limits and permitted training', 'Confirm the candidate knows what training they may conduct, when direct or indirect supervision applies and when the CFI/DCFI must be consulted.', 120, ARRAY['instructor','senior_instructor']::text[]),
    ('Ground standardisation', 'GND-04', 'Apply Bendigo FTS lesson and operating standards', 'Confirm the expected lesson sequence, local operating area, school aircraft procedures, personal weather minima and the CFI/DCFI standard for the nominated lesson.', 130, ARRAY['instructor','senior_instructor']::text[]),

    ('Flight assessment', 'FLT-01', 'Nominate real-emergency control responsibility and positive handover', 'Before flight, agree who takes control in a real emergency and use unambiguous handover and takeover wording throughout the assessment.', 200, ARRAY['instructor','senior_instructor']::text[]),
    ('Flight assessment', 'FLT-02', 'Deliver an effective pre-take-off safety briefing', 'Cover emergency actions, communication, responsibilities and positive transfer of control.', 210, ARRAY['instructor','senior_instructor']::text[]),
    ('Flight assessment', 'FLT-03', 'Deliver accurate demonstrations and coordinated instructional patter', 'Manage aircraft and student workload, explain clearly, identify simulated student errors and correct them without compromising safety.', 220, ARRAY['instructor','senior_instructor']::text[]),
    ('Flight assessment', 'FLT-04', 'Operate within the RAAP 7 flight tolerances', 'Use the RAAP 7 tolerances for taxi, heading, altitude, airspeed, turns, final approach, touchdown and centreline tracking.', 230, ARRAY['instructor','senior_instructor']::text[]),
    ('Flight assessment', 'FLT-05', 'Teach and demonstrate medium and steep turns', 'Assess lookout, coordination, bank control, height control, nominated-heading accuracy and recovery.', 240, ARRAY['instructor','senior_instructor']::text[]),
    ('Flight assessment', 'FLT-06', 'Teach stall entry and recovery with and without power', 'Assess safe setup, lookout, recognition, recovery, patter and management of common student errors in the applicable aircraft.', 250, ARRAY['instructor','senior_instructor']::text[]),
    ('Flight assessment', 'FLT-07', 'Conduct a successful forced landing exercise to no lower than 500 ft AGL', 'Assess field selection, planning, checks, calls, approach management, patter and safe discontinuation at the agreed minimum height.', 260, ARRAY['instructor','senior_instructor']::text[]),
    ('Flight assessment', 'FLT-08', 'Teach standard and non-standard circuits and simulated failures', 'Include normal circuit work plus examiner-selected partial or full engine failure and an appropriate simulated system failure such as flap, trim or electrical failure.', 270, ARRAY['instructor','senior_instructor']::text[]),
    ('Flight assessment', 'FLT-09', 'Maintain airmanship, radio, lookout, CRM and threat-and-error management', 'Assess safe command, situational awareness, workload, decision making and communication throughout, not only during nominated sequences.', 280, ARRAY['instructor','senior_instructor']::text[]),

    ('Senior Instructor standard', 'SEN-01', 'Assess a candidate for first solo', 'Explain and demonstrate how competency, consistency, conditions, aircraft, authorisations and local requirements are assessed before solo release.', 300, ARRAY['senior_instructor']::text[]),
    ('Senior Instructor standard', 'SEN-02', 'Explain conduct of BFRs and endorsement training or issue', 'Demonstrate the higher standard and administration required for BFRs, endorsements and any privileges actually held.', 310, ARRAY['senior_instructor']::text[]),
    ('Senior Instructor standard', 'SEN-03', 'Operate to the CFI standard under indirect supervision', 'Explain expectations when the CFI is absent, supervision or mentoring of Instructors, escalation thresholds and maintenance of school standardisation.', 320, ARRAY['senior_instructor']::text[]),

    ('Debrief and records', 'DBR-01', 'Candidate completes an honest self-assessment', 'Have the candidate identify strengths, deficiencies and opportunities for improvement before receiving the examiner debrief.', 400, ARRAY['instructor','senior_instructor']::text[]),
    ('Debrief and records', 'DBR-02', 'Give an evidence-based debrief and development plan', 'Record observed evidence, strengths, deficiencies and specific remedial or development actions. Any below-standard component makes the overall result unsatisfactory.', 410, ARRAY['instructor','senior_instructor']::text[]),
    ('Debrief and records', 'DBR-03', 'Complete candidate and CFI/DCFI logbook entries', 'Enter the check date, scope and result in both logbooks. A failed check prevents further instructional operation until satisfactory remediation is recorded.', 420, ARRAY['instructor','senior_instructor']::text[])
  ) AS item(section, code, title, guidance, sort_order, levels);

  -- Additional INS002 and renewal-only assessment requirements.
  INSERT INTO public.instructor_compliance_course_items (
    course_id, section, code, title, guidance, sort_order, required,
    applicable_levels, applicable_check_types
  ) VALUES
    (v_renewal_course_id, 'Renewal knowledge and evidence', 'REN-01', 'Confirm the renewal timing, rating privileges and any extension basis', 'Check the current rating expiry or anniversary. Record whether the assessment is in the normal early-renewal window or supported by an approved extension.', 500, true, ARRAY['instructor','senior_instructor'], ARRAY['renewal']),
    (v_renewal_course_id, 'Renewal knowledge and evidence', 'REN-02', 'Review current aviation legislation, manuals and RAAus changes', 'Assess relevant changes to the Flight Operations and Technical Manuals, legislation, procedures, radio calls and school requirements since the previous renewal.', 510, true, ARRAY['instructor','senior_instructor'], ARRAY['renewal']),
    (v_renewal_course_id, 'Renewal knowledge and evidence', 'REN-03', 'Assess flight planning, VMC, meteorology, radio and operational decisions', 'Use candidate-relevant scenarios to assess planning, weather, airspace, fuel, loading, performance, radio and conservative decision making.', 520, true, ARRAY['instructor','senior_instructor'], ARRAY['renewal']),
    (v_renewal_course_id, 'Renewal knowledge and evidence', 'REN-04', 'Assess ADM, CRM, TEM, situational awareness and human factors', 'Confirm the candidate can teach and apply human-factors principles, recognise threats and errors and manage workload and decision making.', 530, true, ARRAY['instructor','senior_instructor'], ARRAY['renewal']),
    (v_renewal_course_id, 'Renewal knowledge and evidence', 'REN-05', 'Assess student-error diagnosis and correction', 'Use simulated student errors in the briefing and flight to confirm timely diagnosis, safe intervention, constructive correction and appropriate follow-up training.', 540, true, ARRAY['instructor','senior_instructor'], ARRAY['renewal']),
    (v_renewal_course_id, 'Renewal knowledge and evidence', 'REN-06', 'Complete and sign the current RAAus INS002 form', 'Complete applicant and examiner declarations, aircraft and flight details, experience, checklist and signatures using INS002 or its current replacement.', 550, true, ARRAY['instructor','senior_instructor'], ARRAY['renewal']),
    (v_renewal_course_id, 'Renewal knowledge and evidence', 'REN-07', 'Supply the completed renewal to RAAus for processing', 'Attach the completed form to this protected record and confirm it was supplied to the RAAus office. CRM completion alone is not RAAus processing.', 560, true, ARRAY['instructor','senior_instructor'], ARRAY['renewal']);
END;
$$;

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

        -- RAAus preserves the fixed anniversary when renewal is completed in
        -- the 90-day early window (or the documented extension window).
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

REVOKE ALL ON FUNCTION public.prepare_instructor_compliance_record()
  FROM PUBLIC, anon, authenticated, service_role;

-- Include successful instructor rating renewals among recognised BFR-reset
-- events. This keeps the pilot file and safety checks aligned automatically.
CREATE OR REPLACE FUNCTION public.sync_member_flight_review_from_endorsements(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest_review_date date;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT max(currency_event.event_date)
  INTO v_latest_review_date
  FROM (
    SELECT endorsement.date_obtained AS event_date
    FROM public.endorsements endorsement
    WHERE endorsement.student_id = target_user_id
      AND endorsement.date_obtained IS NOT NULL
      AND coalesce(endorsement.is_active, true)

    UNION ALL

    SELECT licence.date_obtained
    FROM public.licences licence
    WHERE licence.student_id = target_user_id
      AND licence.date_obtained IS NOT NULL
      AND coalesce(licence.is_active, true)

    UNION ALL

    SELECT coalesce(review_record.completion_date, review_record.review_date)
    FROM public.flight_review_records review_record
    WHERE review_record.candidate_id = target_user_id
      AND review_record.status = 'completed'
      AND (
        coalesce(
          (review_record.template_snapshot->'review_configuration'->>'resets_flight_review')::boolean,
          false
        )
        OR review_record.template_snapshot->>'course_purpose' = 'flight_test'
        OR lower(review_record.review_type) LIKE '%flight%test%'
      )

    UNION ALL

    SELECT training_record.date
    FROM public.training_records training_record
    WHERE training_record.student_id = target_user_id
      AND training_record.status <> 'draft'
      AND training_record.is_flight_review
      AND training_record.flight_review_result = 'pass'

    UNION ALL

    SELECT compliance.check_date
    FROM public.instructor_compliance_records compliance
    WHERE compliance.candidate_instructor_id = target_user_id
      AND compliance.check_type = 'renewal'
      AND compliance.status = 'completed'
      AND compliance.outcome = 'satisfactory'
      AND compliance.voided_at IS NULL
  ) currency_event
  WHERE currency_event.event_date IS NOT NULL
    AND currency_event.event_date <= CURRENT_DATE;

  IF v_latest_review_date IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.students student
  SET last_flight_review = v_latest_review_date,
      updated_at = now()
  WHERE student.id = target_user_id
    AND (
      student.last_flight_review IS NULL
      OR student.last_flight_review < v_latest_review_date
    );
END;
$$;

COMMENT ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid) IS
  'Advances pilot flight-review currency from passed reviews/tests, active credentials and satisfactory instructor rating renewals.';

REVOKE ALL ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.audit_instructor_compliance_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.instructor_compliance_record_audit (
    record_id, actor_id, action, old_data, new_data
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  IF TG_OP = 'UPDATE' AND OLD.candidate_instructor_id IS DISTINCT FROM NEW.candidate_instructor_id THEN
    PERFORM public.sync_member_flight_review_from_endorsements(OLD.candidate_instructor_id);
  END IF;
  PERFORM public.sync_member_flight_review_from_endorsements(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.candidate_instructor_id ELSE NEW.candidate_instructor_id END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_instructor_compliance_record()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_instructor_compliance_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('completed', 'remedial_required')
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    INSERT INTO public.notifications (user_id, type, title, message, metadata)
    VALUES (
      NEW.candidate_instructor_id,
      'instructor_compliance',
      CASE
        WHEN NEW.outcome = 'satisfactory' THEN 'Your instructor check is complete'
        ELSE 'Your instructor check needs follow-up'
      END,
      CASE
        WHEN NEW.outcome = 'satisfactory' AND NEW.check_type = 'renewal' THEN
          'Your instructor rating renewal was completed and your BFR was reset to '
          || to_char(NEW.check_date, 'DD Mon YYYY') || '. Your next S&P check is due '
          || to_char(NEW.next_sp_check_due, 'DD Mon YYYY') || ' and your rating renewal is due '
          || to_char(NEW.next_renewal_due, 'DD Mon YYYY') || '.'
        WHEN NEW.outcome = 'satisfactory' THEN
          'Your Standards & Proficiency check was completed. Your next S&P check is due '
          || to_char(NEW.next_sp_check_due, 'DD Mon YYYY') || '.'
        ELSE
          'Your instructor check requires remedial action. You must not conduct instructional duties until a CFI/DCFI reviewer records a satisfactory result.'
      END,
      jsonb_build_object(
        'check_type', NEW.check_type,
        'outcome', NEW.outcome,
        'next_sp_check_due', NEW.next_sp_check_due,
        'next_renewal_due', NEW.next_renewal_due,
        'bfr_reset_date', CASE WHEN NEW.check_type = 'renewal' AND NEW.outcome = 'satisfactory' THEN NEW.check_date ELSE NULL END
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_instructor_compliance_result()
  FROM PUBLIC, anon, authenticated, service_role;

-- Bring existing satisfactory renewal records into the pilot BFR date now.
DO $$
DECLARE
  v_candidate_id uuid;
BEGIN
  FOR v_candidate_id IN
    SELECT DISTINCT candidate_instructor_id
    FROM public.instructor_compliance_records
    WHERE check_type = 'renewal'
      AND status = 'completed'
      AND outcome = 'satisfactory'
      AND voided_at IS NULL
  LOOP
    PERFORM public.sync_member_flight_review_from_endorsements(v_candidate_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_cfi_instructor_dependency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.role = 'cfi' AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = NEW.user_id
      AND role = 'instructor'
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'CFI/DCFI review authority requires the Instructor role';
  END IF;

  IF TG_OP IN ('DELETE', 'UPDATE')
    AND OLD.role = 'instructor'
    AND (TG_OP = 'DELETE' OR NEW.role <> 'instructor')
    AND EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = v_user_id
        AND role = 'cfi'
    )
  THEN
    RAISE EXCEPTION 'Remove CFI/DCFI review authority before removing the Instructor role';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cfi_instructor_dependency()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.assert_function_permission_manifest();
