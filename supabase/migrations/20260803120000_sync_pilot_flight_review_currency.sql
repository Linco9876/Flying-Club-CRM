-- Keep pilot flight-review currency aligned with every recognised source and
-- mirror course-defined flight tests into the formal Review / Tests register.

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
  'Advances a pilot flight-review date from passed reviews/tests and the most recent active endorsement or licence. The next due date is two years later in the portal.';

REVOKE ALL ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION private.sync_pilot_currency_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_member_flight_review_from_endorsements(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.student_id ELSE NEW.student_id END
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION private.sync_pilot_currency_source()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_pilot_currency_source() TO service_role;

DROP TRIGGER IF EXISTS sync_flight_review_after_licence_change ON public.licences;
CREATE TRIGGER sync_flight_review_after_licence_change
AFTER INSERT OR UPDATE OF student_id, date_obtained, expiry_date, is_active
ON public.licences
FOR EACH ROW
EXECUTE FUNCTION private.sync_pilot_currency_source();

CREATE OR REPLACE FUNCTION private.sync_flight_review_record_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_member_flight_review_from_endorsements(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.candidate_id ELSE NEW.candidate_id END
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION private.sync_flight_review_record_currency()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_flight_review_record_currency() TO service_role;

DROP TRIGGER IF EXISTS sync_flight_review_after_formal_record_change
  ON public.flight_review_records;
CREATE TRIGGER sync_flight_review_after_formal_record_change
AFTER INSERT OR UPDATE OF candidate_id, status, review_date, completion_date,
  review_type, template_snapshot
ON public.flight_review_records
FOR EACH ROW
EXECUTE FUNCTION private.sync_flight_review_record_currency();

CREATE OR REPLACE FUNCTION public.promote_pilot_after_passed_flight_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'draft'
     AND NEW.is_flight_review IS TRUE
     AND NEW.flight_review_result = 'pass' THEN
    UPDATE public.students
    SET last_flight_review = coalesce(NEW.date, CURRENT_DATE),
        updated_at = now()
    WHERE id = NEW.student_id
      AND (
        last_flight_review IS NULL
        OR last_flight_review < coalesce(NEW.date, CURRENT_DATE)
      );

    NEW.pilot_role_granted := false;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.promote_pilot_after_passed_flight_review() IS
  'Advances flight-review currency only for submitted or locked passed reviews/tests. Pilot status remains licence-based.';

CREATE OR REPLACE FUNCTION private.validate_course_flight_test_outcome()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'draft'
    AND EXISTS (
      SELECT 1
      FROM public.training_lessons lesson
      WHERE lesson.id = NEW.lesson_id
        AND lesson.course_id = NEW.course_id
        AND lesson.is_flight_test
    )
    AND coalesce(NEW.flight_review_result, 'not_assessed') NOT IN ('pass', 'fail') THEN
    RAISE EXCEPTION 'Select Pass or Further training required before submitting a course flight test';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_course_flight_test_outcome()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_course_flight_test_outcome() TO service_role;

DROP TRIGGER IF EXISTS validate_course_flight_test_outcome ON public.training_records;
CREATE TRIGGER validate_course_flight_test_outcome
BEFORE INSERT OR UPDATE OF course_id, lesson_id, status, flight_review_result
ON public.training_records
FOR EACH ROW
EXECUTE FUNCTION private.validate_course_flight_test_outcome();

CREATE OR REPLACE FUNCTION private.sync_course_flight_test_review_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_course public.training_courses%rowtype;
  v_lesson public.training_lessons%rowtype;
  v_reviewer_name text;
  v_authority text;
  v_review_type text;
  v_review_status text;
  v_snapshot jsonb;
BEGIN
  IF NEW.status = 'draft'
     OR NOT coalesce(NEW.is_flight_review, false)
     OR NEW.flight_review_result NOT IN ('pass', 'fail') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lesson
  FROM public.training_lessons lesson
  WHERE lesson.id = NEW.lesson_id
    AND lesson.course_id = NEW.course_id
    AND lesson.is_flight_test;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_course
  FROM public.training_courses course
  WHERE course.id = NEW.course_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT nullif(btrim(portal_user.name), '')
  INTO v_reviewer_name
  FROM public.users portal_user
  WHERE portal_user.id = NEW.instructor_id;

  v_authority := CASE
    WHEN concat_ws(' ', v_course.title, v_course.category, v_lesson.name, NEW.flight_review_type)
      ~* '(RAAus|RPC|Pilot Certificate)' THEN 'raaus'
    WHEN concat_ws(' ', v_course.title, v_course.category, v_lesson.name, NEW.flight_review_type)
      ~* '(CASA|RPL|PPL|CPL|ATPL)' THEN 'casa'
    ELSE 'club'
  END;
  v_review_type := CASE
    WHEN v_authority = 'raaus' THEN 'raaus_course_flight_test'
    WHEN v_authority = 'casa' THEN 'casa_course_flight_test'
    ELSE 'course_flight_test'
  END;
  v_review_status := CASE
    WHEN NEW.flight_review_result = 'pass' THEN 'completed'
    ELSE 'further_training_required'
  END;
  v_snapshot := jsonb_build_object(
    'title', concat(v_course.title, ' - ', v_lesson.name),
    'version', v_course.version,
    'course_purpose', 'flight_test',
    'record_origin', 'course_flight_test',
    'course_id', v_course.id,
    'lesson_id', v_lesson.id,
    'review_configuration', jsonb_build_object(
      'review_type', v_review_type,
      'authority', v_authority,
      'outcome_scheme', 'pass_fail',
      'validity_months', 24,
      'resets_flight_review', true,
      'candidate_ack_required', false,
      'allowed_reviewer_roles',
        jsonb_build_array('admin', 'cfi', 'senior_instructor', 'instructor'),
      'required_evidence', '[]'::jsonb,
      'checklist', '[]'::jsonb,
      'requires_reviewer_summary', false,
      'reviewer_summary_label', 'Formal findings or required follow-up'
    ),
    'captured_at', now()
  );

  INSERT INTO public.flight_review_records (
    template_course_id,
    template_snapshot,
    source_training_record_id,
    candidate_id,
    reviewer_user_id,
    booking_id,
    flight_log_id,
    review_type,
    authority,
    status,
    review_date,
    completion_date,
    aircraft_id,
    aircraft_type,
    registration,
    ground_minutes,
    flight_minutes,
    reviewer_summary,
    reviewer_sign_name,
    reviewer_sign_at,
    next_review_due,
    created_by,
    updated_by
  ) VALUES (
    v_course.id,
    v_snapshot,
    NEW.id,
    NEW.student_id,
    NEW.instructor_id,
    NEW.booking_id,
    NEW.flight_log_id,
    v_review_type,
    v_authority,
    v_review_status,
    NEW.date,
    CASE WHEN NEW.flight_review_result = 'pass' THEN NEW.date ELSE NULL END,
    NEW.aircraft_id,
    NEW.aircraft_type,
    NEW.registration,
    0,
    greatest(0, coalesce(NEW.dual_time_min, 0) + coalesce(NEW.solo_time_min, 0)),
    coalesce(NEW.flight_review_notes, ''),
    coalesce(v_reviewer_name, 'Instructor'),
    coalesce(NEW.instructor_sign_timestamp, now()),
    CASE
      WHEN NEW.flight_review_result = 'pass' THEN (NEW.date + interval '2 years')::date
      ELSE NULL
    END,
    NEW.instructor_id,
    NEW.instructor_id
  )
  ON CONFLICT (source_training_record_id) DO UPDATE
  SET template_course_id = EXCLUDED.template_course_id,
      template_snapshot = EXCLUDED.template_snapshot,
      candidate_id = EXCLUDED.candidate_id,
      reviewer_user_id = EXCLUDED.reviewer_user_id,
      booking_id = EXCLUDED.booking_id,
      flight_log_id = EXCLUDED.flight_log_id,
      review_type = EXCLUDED.review_type,
      authority = EXCLUDED.authority,
      status = EXCLUDED.status,
      review_date = EXCLUDED.review_date,
      completion_date = EXCLUDED.completion_date,
      aircraft_id = EXCLUDED.aircraft_id,
      aircraft_type = EXCLUDED.aircraft_type,
      registration = EXCLUDED.registration,
      flight_minutes = EXCLUDED.flight_minutes,
      reviewer_summary = EXCLUDED.reviewer_summary,
      reviewer_sign_name = EXCLUDED.reviewer_sign_name,
      reviewer_sign_at = EXCLUDED.reviewer_sign_at,
      next_review_due = EXCLUDED.next_review_due,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  WHERE flight_review_records.template_snapshot->>'record_origin' = 'course_flight_test';

  PERFORM public.sync_member_flight_review_from_endorsements(NEW.student_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_course_flight_test_review_record()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_course_flight_test_review_record() TO service_role;

DROP TRIGGER IF EXISTS sync_course_flight_test_review_record ON public.training_records;
CREATE TRIGGER sync_course_flight_test_review_record
AFTER INSERT OR UPDATE OF student_id, instructor_id, course_id, lesson_id, status,
  date, booking_id, flight_log_id, flight_review_result, flight_review_notes,
  aircraft_id, aircraft_type, registration, dual_time_min, solo_time_min
ON public.training_records
FOR EACH ROW
EXECUTE FUNCTION private.sync_course_flight_test_review_record();

-- Backfill existing completed course flight tests without creating duplicates.
UPDATE public.training_records training_record
SET updated_at = training_record.updated_at
WHERE training_record.status <> 'draft'
  AND training_record.is_flight_review
  AND training_record.flight_review_result IN ('pass', 'fail')
  AND EXISTS (
    SELECT 1
    FROM public.training_lessons lesson
    WHERE lesson.id = training_record.lesson_id
      AND lesson.course_id = training_record.course_id
      AND lesson.is_flight_test
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.flight_review_records review_record
    WHERE review_record.source_training_record_id = training_record.id
  );

-- Bring current profiles forward from all existing licences, endorsements and
-- completed review/test records. This only advances dates; it never shortens a
-- manually recorded currency period.
DO $$
DECLARE
  v_student_id uuid;
BEGIN
  FOR v_student_id IN SELECT student.id FROM public.students student
  LOOP
    PERFORM public.sync_member_flight_review_from_endorsements(v_student_id);
  END LOOP;
END;
$$;
