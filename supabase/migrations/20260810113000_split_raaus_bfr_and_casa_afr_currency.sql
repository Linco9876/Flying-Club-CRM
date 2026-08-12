-- Keep RAAus BFR and CASA AFR currency as separate facts. A CASA aeroplane
-- flight review also satisfies the RAAus BFR date, while a RAAus-only review
-- must never advance CASA currency.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS last_raaus_bfr_date date,
  ADD COLUMN IF NOT EXISTS last_casa_afr_date date;

COMMENT ON COLUMN public.students.last_raaus_bfr_date IS
  'Date of the member''s latest RAAus biennial flight review. CASA AFR completion also advances this date.';
COMMENT ON COLUMN public.students.last_casa_afr_date IS
  'Date of the member''s latest CASA aeroplane flight review. RAAus-only reviews do not advance this date.';
COMMENT ON COLUMN public.students.last_flight_review IS
  'Deprecated compatibility alias for last_raaus_bfr_date.';

UPDATE public.students
SET last_raaus_bfr_date = greatest(last_raaus_bfr_date, last_flight_review)
WHERE last_flight_review IS NOT NULL;

CREATE OR REPLACE FUNCTION public.flight_review_authority(
  explicit_authority text,
  review_type text DEFAULT NULL,
  template_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN lower(coalesce(nullif(explicit_authority, ''), template_snapshot->'review_configuration'->>'authority', '')) = 'casa'
      OR concat_ws(' ', review_type, template_snapshot->>'title') ~* '(CASA|\mAFR\M|RPL|PPL|CPL|ATPL)'
      THEN 'casa'
    WHEN lower(coalesce(nullif(explicit_authority, ''), template_snapshot->'review_configuration'->>'authority', '')) = 'raaus'
      OR concat_ws(' ', review_type, template_snapshot->>'title') ~* '(RAAus|\mBFR\M|RPC|Pilot Certificate)'
      THEN 'raaus'
    ELSE 'club'
  END;
$$;

REVOKE ALL ON FUNCTION public.flight_review_authority(text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flight_review_authority(text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.normalise_student_review_currency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_raaus_bfr_date := coalesce(NEW.last_raaus_bfr_date, NEW.last_flight_review);
  ELSIF NEW.last_raaus_bfr_date IS NOT DISTINCT FROM OLD.last_raaus_bfr_date
        AND NEW.last_flight_review IS DISTINCT FROM OLD.last_flight_review THEN
    -- Maintain compatibility with older staff clients until every surface has
    -- moved away from last_flight_review.
    NEW.last_raaus_bfr_date := NEW.last_flight_review;
  END IF;

  -- A CASA AFR is also accepted as the RAAus review date. The reverse is not true.
  NEW.last_raaus_bfr_date := greatest(NEW.last_raaus_bfr_date, NEW.last_casa_afr_date);
  NEW.last_flight_review := NEW.last_raaus_bfr_date;

  IF NEW.last_raaus_bfr_date > CURRENT_DATE OR NEW.last_casa_afr_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Flight review dates cannot be in the future';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalise_student_review_currency()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS normalise_student_review_currency ON public.students;
CREATE TRIGGER normalise_student_review_currency
BEFORE INSERT OR UPDATE OF last_flight_review, last_raaus_bfr_date, last_casa_afr_date
ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.normalise_student_review_currency();

-- Self-service dates are deliberately allowed, audited by the existing member
-- profile audit trigger, and normalised by the trigger above.
DROP POLICY IF EXISTS "Users can insert own safe student profile row" ON public.students;
CREATE POLICY "Users can insert own safe student profile row"
ON public.students
FOR INSERT TO authenticated
WITH CHECK (
  id = auth.uid()
  AND coalesce(prepaid_balance, 0) = 0
  AND last_flight_review IS NOT DISTINCT FROM last_raaus_bfr_date
);

CREATE OR REPLACE FUNCTION public.sync_member_flight_review_from_endorsements(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raaus_date date;
  v_casa_date date;
  v_event record;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT greatest(student.last_raaus_bfr_date, student.last_flight_review),
         student.last_casa_afr_date
  INTO v_raaus_date, v_casa_date
  FROM public.students student
  WHERE student.id = target_user_id;

  FOR v_event IN
    SELECT
      coalesce(record.completion_date, record.review_date) AS event_date,
      public.flight_review_authority(record.authority, record.review_type, record.template_snapshot) AS authority
    FROM public.flight_review_records record
    WHERE record.candidate_id = target_user_id
      AND record.status = 'completed'
      AND coalesce(record.completion_date, record.review_date) <= CURRENT_DATE
      AND (
        coalesce((record.template_snapshot->'review_configuration'->>'resets_flight_review')::boolean, false)
        OR record.template_snapshot->>'course_purpose' = 'flight_test'
        OR lower(record.review_type) LIKE '%flight%test%'
      )

    UNION ALL

    SELECT training.date,
      public.flight_review_authority(
        NULL,
        training.flight_review_type,
        jsonb_build_object('title', concat_ws(' ', course.title, course.category, lesson.name))
      )
    FROM public.training_records training
    LEFT JOIN public.training_courses course ON course.id = training.course_id
    LEFT JOIN public.training_lessons lesson ON lesson.id = training.lesson_id
    WHERE training.student_id = target_user_id
      AND training.status <> 'draft'
      AND training.is_flight_review
      AND training.flight_review_result = 'pass'
      AND training.date <= CURRENT_DATE

    UNION ALL

    SELECT compliance.check_date, 'raaus'
    FROM public.instructor_compliance_records compliance
    WHERE compliance.candidate_instructor_id = target_user_id
      AND compliance.check_type = 'renewal'
      AND compliance.status = 'completed'
      AND compliance.outcome = 'satisfactory'
      AND compliance.voided_at IS NULL
      AND compliance.check_date <= CURRENT_DATE
  LOOP
    IF v_event.authority = 'casa' THEN
      v_casa_date := greatest(v_casa_date, v_event.event_date);
      v_raaus_date := greatest(v_raaus_date, v_event.event_date);
    ELSIF v_event.authority = 'raaus' THEN
      v_raaus_date := greatest(v_raaus_date, v_event.event_date);
    END IF;
  END LOOP;

  UPDATE public.students student
  SET last_raaus_bfr_date = v_raaus_date,
      last_casa_afr_date = v_casa_date,
      last_flight_review = v_raaus_date,
      updated_at = now()
  WHERE student.id = target_user_id
    AND (
      student.last_raaus_bfr_date IS DISTINCT FROM v_raaus_date
      OR student.last_casa_afr_date IS DISTINCT FROM v_casa_date
      OR student.last_flight_review IS DISTINCT FROM v_raaus_date
    );
END;
$$;

COMMENT ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid) IS
  'Advances separate RAAus BFR and CASA AFR dates from completed regulatory reviews. CASA advances both; RAAus advances only BFR.';

REVOKE ALL ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.promote_pilot_after_passed_flight_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_course_flight_test boolean := false;
  v_authority text := 'raaus';
  v_context text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.training_lessons lesson
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
    SELECT concat_ws(' ', course.title, course.category, lesson.name, NEW.flight_review_type)
    INTO v_context
    FROM public.training_courses course
    LEFT JOIN public.training_lessons lesson ON lesson.id = NEW.lesson_id
    WHERE course.id = NEW.course_id;

    v_authority := public.flight_review_authority(NULL, NEW.flight_review_type, jsonb_build_object('title', v_context));
    -- Historical unclassified lesson records have always represented the club's
    -- RAAus BFR workflow; preserve that behaviour without granting CASA AFR.
    IF v_authority = 'club' THEN v_authority := 'raaus'; END IF;

    UPDATE public.students
    SET last_raaus_bfr_date = greatest(last_raaus_bfr_date, coalesce(NEW.date, CURRENT_DATE)),
        last_casa_afr_date = CASE
          WHEN v_authority = 'casa' THEN greatest(last_casa_afr_date, coalesce(NEW.date, CURRENT_DATE))
          ELSE last_casa_afr_date
        END,
        last_flight_review = greatest(last_raaus_bfr_date, coalesce(NEW.date, CURRENT_DATE)),
        updated_at = now()
    WHERE id = NEW.student_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_pilot_after_passed_flight_review()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.promote_pilot_after_passed_flight_review() IS
  'Applies authority-specific review currency and marks passed course flight tests for Pilot status. CASA resets AFR and BFR; RAAus resets BFR only.';

-- Reclassify existing completed formal records now that the currencies are split.
DO $$
DECLARE
  v_student_id uuid;
BEGIN
  FOR v_student_id IN SELECT student.id FROM public.students student LOOP
    PERFORM public.sync_member_flight_review_from_endorsements(v_student_id);
  END LOOP;
END;
$$;

INSERT INTO private.function_permission_manifest (
  signature, function_name, classification, allowed_roles,
  security_definer, fixed_search_path, rationale, reviewed_at
) VALUES
  (
    'public.flight_review_authority(explicit_authority text, review_type text, template_snapshot jsonb)',
    'flight_review_authority', 'service_worker', ARRAY['service_role']::text[],
    false, true,
    'Internal authority classifier used by protected flight-review currency functions.',
    CURRENT_DATE
  ),
  (
    'public.normalise_student_review_currency()',
    'normalise_student_review_currency', 'trigger_internal', ARRAY[]::text[],
    false, true,
    'Invoked only by the student review-currency normalisation trigger; client EXECUTE is unnecessary.',
    CURRENT_DATE
  )
ON CONFLICT (signature) DO UPDATE
SET function_name = EXCLUDED.function_name,
    classification = EXCLUDED.classification,
    allowed_roles = EXCLUDED.allowed_roles,
    security_definer = EXCLUDED.security_definer,
    fixed_search_path = EXCLUDED.fixed_search_path,
    rationale = EXCLUDED.rationale,
    reviewed_at = EXCLUDED.reviewed_at;

SELECT private.assert_function_permission_manifest();
