-- A passed course flight test is the final competency decision. Complete the
-- enrolment and issue the resulting status in the same transaction as the
-- submitted/locked training record so the outcome never depends on opening a UI.

ALTER TABLE public.student_course_enrolments
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_source_training_record_id uuid
    REFERENCES public.training_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS student_course_enrolments_completion_source_idx
  ON public.student_course_enrolments(completion_source_training_record_id)
  WHERE completion_source_training_record_id IS NOT NULL;

UPDATE public.student_course_enrolments
SET completed_at = coalesce(completed_at, updated_at, enrolled_at)
WHERE status = 'completed'
  AND completed_at IS NULL;

COMMENT ON COLUMN public.student_course_enrolments.completed_at IS
  'Timestamp at which the course was completed.';
COMMENT ON COLUMN public.student_course_enrolments.completion_source_training_record_id IS
  'Passed course flight-test record that caused automatic course completion.';
COMMENT ON COLUMN public.training_records.pilot_role_granted IS
  'True when this submitted/locked record is a passed course-defined flight test that grants Pilot status.';
COMMENT ON COLUMN public.licences.verification_status IS
  'Member submissions remain pending until staff verify them. Verified licences grant credential-based Pilot status and aircraft access; passed course flight tests separately grant Pilot status.';
COMMENT ON COLUMN public.training_syllabus_settings.pilot_status_endorsement_types IS
  'Deprecated. Endorsements do not grant Pilot status; verified current licences and passed course flight tests do.';

-- Pilot status can come from a verified current licence or from a passed,
-- submitted/locked course flight test. Keep the existing function name because
-- licence-change triggers already use it to reconcile the complete rule.
CREATE OR REPLACE FUNCTION public.sync_member_role_from_licences(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  should_be_pilot boolean := false;
  has_staff_role boolean := false;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.licences licence
      WHERE licence.student_id = target_user_id
        AND licence.verification_status = 'verified'
        AND licence.is_active
        AND (licence.expiry_date IS NULL OR licence.expiry_date >= CURRENT_DATE)
    )
    OR EXISTS (
      SELECT 1
      FROM public.training_records training_record
      JOIN public.training_lessons lesson
        ON lesson.id = training_record.lesson_id
       AND lesson.course_id = training_record.course_id
       AND lesson.is_flight_test
      WHERE training_record.student_id = target_user_id
        AND training_record.status <> 'draft'
        AND training_record.flight_review_result = 'pass'
    )
  INTO should_be_pilot;

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
    WHERE user_id = target_user_id
      AND role = 'student';
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = target_user_id
      AND role = 'pilot';

    IF NOT has_staff_role THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (target_user_id, 'student')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_member_role_from_licences(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_member_role_from_licences(uuid) TO service_role;

COMMENT ON FUNCTION public.sync_member_role_from_licences(uuid) IS
  'Reconciles Student/Pilot status from verified current licences and passed course flight tests.';

-- Store an explicit marker on the training record as well as reconciling the
-- durable user role in the AFTER trigger below.
CREATE OR REPLACE FUNCTION public.promote_pilot_after_passed_flight_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_course_flight_test boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.training_lessons lesson
    WHERE lesson.id = NEW.lesson_id
      AND lesson.course_id = NEW.course_id
      AND lesson.is_flight_test
  ) INTO is_course_flight_test;

  NEW.pilot_role_granted := (
    NEW.status <> 'draft'
    AND NEW.flight_review_result = 'pass'
    AND is_course_flight_test
  );

  IF NEW.status <> 'draft'
     AND NEW.flight_review_result = 'pass'
     AND (NEW.is_flight_review IS TRUE OR is_course_flight_test) THEN
    UPDATE public.students
    SET last_flight_review = coalesce(NEW.date, CURRENT_DATE),
        updated_at = now()
    WHERE id = NEW.student_id
      AND (
        last_flight_review IS NULL
        OR last_flight_review < coalesce(NEW.date, CURRENT_DATE)
      );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_pilot_after_passed_flight_review()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.promote_pilot_after_passed_flight_review() IS
  'Advances flight-review currency and marks submitted/locked passed course flight tests for Pilot status.';

DROP TRIGGER IF EXISTS promote_pilot_after_passed_flight_review_trigger
  ON public.training_records;
CREATE TRIGGER promote_pilot_after_passed_flight_review_trigger
BEFORE INSERT OR UPDATE OF is_flight_review, flight_review_result, student_id,
  date, status, course_id, lesson_id
ON public.training_records
FOR EACH ROW
EXECUTE FUNCTION public.promote_pilot_after_passed_flight_review();

CREATE OR REPLACE FUNCTION private.complete_course_after_passed_flight_test()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  course_row public.training_courses%rowtype;
  completion_timestamp timestamptz;
BEGIN
  IF NEW.status = 'draft'
     OR NEW.flight_review_result IS DISTINCT FROM 'pass'
     OR NEW.course_id IS NULL
     OR NEW.lesson_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.training_lessons lesson
       WHERE lesson.id = NEW.lesson_id
         AND lesson.course_id = NEW.course_id
         AND lesson.is_flight_test
     ) THEN
    -- A corrected result must immediately reconcile Pilot status against the
    -- remaining verified licences and passed course tests.
    IF TG_OP = 'UPDATE' THEN
      IF OLD.pilot_role_granted IS TRUE THEN
        PERFORM public.sync_member_role_from_licences(OLD.student_id);
        IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
          PERFORM public.sync_member_role_from_licences(NEW.student_id);
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO course_row
  FROM public.training_courses course
  WHERE course.id = NEW.course_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  completion_timestamp := coalesce(
    NEW.instructor_sign_timestamp,
    NEW.updated_at,
    NEW.created_at,
    now()
  );

  INSERT INTO public.student_course_enrolments (
    student_id,
    course_id,
    enrolled_by,
    status,
    enrolled_at,
    updated_at,
    completed_at,
    completion_source_training_record_id
  ) VALUES (
    NEW.student_id,
    NEW.course_id,
    NEW.instructor_id,
    'completed',
    completion_timestamp,
    completion_timestamp,
    completion_timestamp,
    NEW.id
  )
  ON CONFLICT (student_id, course_id) DO UPDATE
  SET status = 'completed',
      completed_at = coalesce(
        student_course_enrolments.completed_at,
        EXCLUDED.completed_at
      ),
      completion_source_training_record_id = coalesce(
        student_course_enrolments.completion_source_training_record_id,
        EXCLUDED.completion_source_training_record_id
      ),
      updated_at = now();

  IF course_row.completion_endorsement_enabled
     AND nullif(btrim(course_row.completion_endorsement_type), '') IS NOT NULL THEN
    UPDATE public.endorsements
    SET is_active = false
    WHERE student_id = NEW.student_id
      AND is_active
      AND lower(btrim(type)) = lower(btrim(course_row.completion_endorsement_type))
      AND expiry_date IS NOT NULL
      AND expiry_date < NEW.date;

    INSERT INTO public.endorsements (
      student_id,
      type,
      date_obtained,
      expiry_date,
      instructor_id,
      is_active
    )
    SELECT
      NEW.student_id,
      btrim(course_row.completion_endorsement_type),
      NEW.date,
      CASE
        WHEN course_row.completion_endorsement_expiry_months IS NULL THEN NULL
        ELSE (NEW.date + make_interval(months => course_row.completion_endorsement_expiry_months))::date
      END,
      NEW.instructor_id,
      true
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.endorsements endorsement
      WHERE endorsement.student_id = NEW.student_id
        AND endorsement.is_active
        AND lower(btrim(endorsement.type)) = lower(btrim(course_row.completion_endorsement_type))
    );
  END IF;

  IF course_row.completion_licence_enabled
     AND nullif(btrim(course_row.completion_licence_type), '') IS NOT NULL THEN
    UPDATE public.licences
    SET is_active = false,
        updated_at = now()
    WHERE student_id = NEW.student_id
      AND is_active
      AND lower(btrim(type)) = lower(btrim(course_row.completion_licence_type))
      AND expiry_date IS NOT NULL
      AND expiry_date < NEW.date;

    INSERT INTO public.licences (
      student_id,
      type,
      date_obtained,
      expiry_date,
      instructor_id,
      source_course_id,
      is_active,
      verification_status,
      verified_by,
      verified_at
    )
    SELECT
      NEW.student_id,
      btrim(course_row.completion_licence_type),
      NEW.date,
      CASE
        WHEN course_row.completion_licence_expiry_months IS NULL THEN NULL
        ELSE (NEW.date + make_interval(months => course_row.completion_licence_expiry_months))::date
      END,
      NEW.instructor_id,
      NEW.course_id,
      true,
      'verified',
      NEW.instructor_id,
      completion_timestamp
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.licences licence
      WHERE licence.student_id = NEW.student_id
        AND licence.is_active
        AND lower(btrim(licence.type)) = lower(btrim(course_row.completion_licence_type))
    )
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM public.sync_member_role_from_licences(NEW.student_id);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      PERFORM public.sync_member_role_from_licences(OLD.student_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.complete_course_after_passed_flight_test()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.complete_course_after_passed_flight_test() IS
  'Atomically completes a course, issues configured awards and reconciles Pilot status after a passed course flight test.';

DROP TRIGGER IF EXISTS complete_course_after_passed_flight_test
  ON public.training_records;
CREATE TRIGGER complete_course_after_passed_flight_test
AFTER INSERT OR UPDATE OF student_id, instructor_id, course_id, lesson_id, status,
  date, flight_review_result, instructor_sign_timestamp
ON public.training_records
FOR EACH ROW
EXECUTE FUNCTION private.complete_course_after_passed_flight_test();

-- Apply the rule to historical submitted/locked course flight-test passes. The
-- upsert and award checks make this safe to rerun.
UPDATE public.training_records training_record
SET flight_review_result = training_record.flight_review_result
WHERE training_record.status <> 'draft'
  AND training_record.flight_review_result = 'pass'
  AND EXISTS (
    SELECT 1
    FROM public.training_lessons lesson
    WHERE lesson.id = training_record.lesson_id
      AND lesson.course_id = training_record.course_id
      AND lesson.is_flight_test
  );

SELECT private.assert_function_permission_manifest();
