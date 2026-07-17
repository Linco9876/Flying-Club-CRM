ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS course_purpose text NOT NULL DEFAULT 'training',
  ADD COLUMN IF NOT EXISTS review_configuration jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.training_courses
  DROP CONSTRAINT IF EXISTS training_courses_course_purpose_check;

ALTER TABLE public.training_courses
  ADD CONSTRAINT training_courses_course_purpose_check
  CHECK (course_purpose IN ('training', 'flight_review', 'flight_test', 'proficiency_check', 'instructor_compliance'));

COMMENT ON COLUMN public.training_courses.course_purpose IS
  'Separates ordinary training syllabuses from reusable review, test and protected instructor-compliance templates.';
COMMENT ON COLUMN public.training_courses.review_configuration IS
  'Versioned review/test workflow rules and checklist definition. Each started record stores an immutable snapshot.';

CREATE TABLE IF NOT EXISTS public.flight_review_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_course_id uuid REFERENCES public.training_courses(id) ON DELETE SET NULL,
  template_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_training_record_id uuid UNIQUE REFERENCES public.training_records(id) ON DELETE SET NULL,
  candidate_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reviewer_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  external_examiner_name text,
  external_examiner_identifier text,
  external_examiner_organisation text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  flight_log_id uuid REFERENCES public.flight_logs(id) ON DELETE SET NULL,
  review_type text NOT NULL,
  authority text NOT NULL DEFAULT 'club',
  status text NOT NULL DEFAULT 'draft',
  review_date date NOT NULL DEFAULT CURRENT_DATE,
  completion_date date,
  aircraft_id uuid REFERENCES public.aircraft(id) ON DELETE SET NULL,
  aircraft_type text NOT NULL DEFAULT '',
  registration text NOT NULL DEFAULT '',
  aircraft_group text,
  previous_review_date date,
  previous_aircraft_group text,
  ground_minutes integer NOT NULL DEFAULT 0,
  flight_minutes integer NOT NULL DEFAULT 0,
  candidate_objectives text NOT NULL DEFAULT '',
  emergency_plan_confirmed boolean NOT NULL DEFAULT false,
  reviewer_summary text NOT NULL DEFAULT '',
  remedial_plan text NOT NULL DEFAULT '',
  minimums_override_reason text NOT NULL DEFAULT '',
  logbook_entry_confirmed boolean NOT NULL DEFAULT false,
  authority_submission_confirmed boolean NOT NULL DEFAULT false,
  candidate_ack boolean NOT NULL DEFAULT false,
  candidate_ack_name text,
  candidate_ack_at timestamptz,
  reviewer_sign_name text,
  reviewer_sign_at timestamptz,
  next_review_due date,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT flight_review_records_authority_check
    CHECK (authority IN ('raaus', 'casa', 'club', 'other')),
  CONSTRAINT flight_review_records_status_check
    CHECK (status IN ('draft', 'in_progress', 'further_training_required', 'completed', 'cancelled')),
  CONSTRAINT flight_review_records_minutes_check
    CHECK (ground_minutes >= 0 AND flight_minutes >= 0),
  CONSTRAINT flight_review_records_external_examiner_check
    CHECK (reviewer_user_id IS NOT NULL OR nullif(trim(external_examiner_name), '') IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.flight_review_record_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_record_id uuid NOT NULL REFERENCES public.flight_review_records(id) ON DELETE CASCADE,
  template_item_key text NOT NULL,
  section text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  guidance text NOT NULL DEFAULT '',
  required boolean NOT NULL DEFAULT true,
  result text NOT NULL DEFAULT 'not_assessed',
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_record_id, template_item_key),
  CONSTRAINT flight_review_record_items_result_check
    CHECK (result IN ('not_assessed', 'satisfactory', 'further_training', 'not_applicable'))
);

CREATE TABLE IF NOT EXISTS public.flight_review_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_record_id uuid NOT NULL REFERENCES public.flight_review_records(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE RESTRICT,
  category text NOT NULL DEFAULT 'other',
  file_name text NOT NULL,
  file_path text NOT NULL UNIQUE,
  mime_type text,
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flight_review_attachments_category_check
    CHECK (category IN ('logbook_entry', 'authority_form', 'external_test_report', 'certificate', 'other'))
);

CREATE TABLE IF NOT EXISTS public.flight_review_record_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_record_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flight_review_records_candidate_date
  ON public.flight_review_records(candidate_id, review_date DESC);
CREATE INDEX IF NOT EXISTS idx_flight_review_records_reviewer_date
  ON public.flight_review_records(reviewer_user_id, review_date DESC);
CREATE INDEX IF NOT EXISTS idx_flight_review_records_status
  ON public.flight_review_records(status, review_date DESC);
CREATE INDEX IF NOT EXISTS idx_flight_review_record_items_record
  ON public.flight_review_record_items(review_record_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_flight_review_attachments_record
  ON public.flight_review_attachments(review_record_id, created_at);
CREATE INDEX IF NOT EXISTS idx_flight_review_audit_record
  ON public.flight_review_record_audit(review_record_id, created_at DESC);

ALTER TABLE public.flight_review_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_review_record_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_review_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_review_record_audit ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flight_review_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flight_review_record_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flight_review_attachments TO authenticated;
GRANT SELECT ON public.flight_review_record_audit TO authenticated;
GRANT ALL ON public.flight_review_records, public.flight_review_record_items,
  public.flight_review_attachments, public.flight_review_record_audit TO service_role;

CREATE POLICY "Candidates and staff can read review records"
ON public.flight_review_records FOR SELECT TO authenticated
USING (
  candidate_id = (SELECT auth.uid())
  OR public.current_user_has_staff_role()
);

CREATE POLICY "Staff can create review records"
ON public.flight_review_records FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_staff_role());

CREATE POLICY "Staff can update review records"
ON public.flight_review_records FOR UPDATE TO authenticated
USING (public.current_user_has_staff_role())
WITH CHECK (public.current_user_has_staff_role());

CREATE POLICY "Candidates can acknowledge own review records"
ON public.flight_review_records FOR UPDATE TO authenticated
USING (candidate_id = (SELECT auth.uid()))
WITH CHECK (candidate_id = (SELECT auth.uid()));

CREATE POLICY "Admins can delete unfinished review records"
ON public.flight_review_records FOR DELETE TO authenticated
USING (
  status IN ('draft', 'cancelled')
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
  )
);

CREATE POLICY "Candidates and staff can read review items"
ON public.flight_review_record_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.flight_review_records record
    WHERE record.id = review_record_id
      AND (record.candidate_id = (SELECT auth.uid()) OR public.current_user_has_staff_role())
  )
);

CREATE POLICY "Staff can create review items"
ON public.flight_review_record_items FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_staff_role());

CREATE POLICY "Staff can update review items"
ON public.flight_review_record_items FOR UPDATE TO authenticated
USING (public.current_user_has_staff_role())
WITH CHECK (public.current_user_has_staff_role());

CREATE POLICY "Staff can delete review items"
ON public.flight_review_record_items FOR DELETE TO authenticated
USING (public.current_user_has_staff_role());

CREATE POLICY "Candidates and staff can read review attachments"
ON public.flight_review_attachments FOR SELECT TO authenticated
USING (candidate_id = (SELECT auth.uid()) OR public.current_user_has_staff_role());

CREATE POLICY "Candidates and staff can add review attachments"
ON public.flight_review_attachments FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_staff_role()
  OR (
    candidate_id = (SELECT auth.uid())
    AND uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.flight_review_records record
      WHERE record.id = review_record_id AND record.candidate_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "Uploaders and staff can delete review attachments"
ON public.flight_review_attachments FOR DELETE TO authenticated
USING (uploaded_by = (SELECT auth.uid()) OR public.current_user_has_staff_role());

CREATE POLICY "Candidates and staff can read review audit"
ON public.flight_review_record_audit FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.flight_review_records record
    WHERE record.id = review_record_id
      AND (record.candidate_id = (SELECT auth.uid()) OR public.current_user_has_staff_role())
  )
);

CREATE OR REPLACE FUNCTION public.protect_candidate_flight_review_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) = OLD.candidate_id AND NOT public.current_user_has_staff_role() THEN
    IF (to_jsonb(NEW) - ARRAY['candidate_ack', 'candidate_ack_name', 'candidate_ack_at', 'updated_at', 'version'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['candidate_ack', 'candidate_ack_name', 'candidate_ack_at', 'updated_at', 'version']) THEN
      RAISE EXCEPTION 'Candidates can only acknowledge their own flight review record';
    END IF;
    IF NEW.candidate_ack AND (nullif(trim(NEW.candidate_ack_name), '') IS NULL OR NEW.candidate_ack_at IS NULL) THEN
      RAISE EXCEPTION 'Acknowledgement name and timestamp are required';
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_candidate_flight_review_update
BEFORE UPDATE ON public.flight_review_records
FOR EACH ROW EXECUTE FUNCTION public.protect_candidate_flight_review_update();

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
    IF (NEW.ground_minutes < minimum_ground OR NEW.flight_minutes < minimum_flight)
       AND nullif(trim(NEW.minimums_override_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Review duration is below the template minimum; record an override reason';
    END IF;
    IF NEW.review_type = 'raaus_bfr' AND (NOT NEW.logbook_entry_confirmed OR NOT NEW.authority_submission_confirmed) THEN
      RAISE EXCEPTION 'RAAus BFR completion requires the logbook entry and RAAus submission confirmations';
    END IF;

    FOR evidence_type IN
      SELECT jsonb_array_elements_text(COALESCE(config->'required_evidence', '[]'::jsonb))
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.flight_review_attachments attachment
        WHERE attachment.review_record_id = NEW.id AND attachment.category = evidence_type
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

CREATE TRIGGER validate_flight_review_completion
BEFORE UPDATE ON public.flight_review_records
FOR EACH ROW EXECUTE FUNCTION public.validate_flight_review_completion();

CREATE OR REPLACE FUNCTION public.apply_flight_review_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND COALESCE((NEW.template_snapshot->'review_configuration'->>'resets_flight_review')::boolean, false) THEN
    UPDATE public.students
    SET last_flight_review = NEW.completion_date
    WHERE id = NEW.candidate_id
      AND (last_flight_review IS NULL OR last_flight_review <= NEW.completion_date);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER apply_flight_review_completion
AFTER UPDATE ON public.flight_review_records
FOR EACH ROW EXECUTE FUNCTION public.apply_flight_review_completion();

CREATE OR REPLACE FUNCTION public.audit_flight_review_record_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.flight_review_record_audit (
    review_record_id, actor_id, action, old_data, new_data
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    (SELECT auth.uid()),
    lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_flight_review_record_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_flight_review_record_change
AFTER INSERT OR UPDATE OR DELETE ON public.flight_review_records
FOR EACH ROW EXECUTE FUNCTION public.audit_flight_review_record_change();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('flight-review-evidence', 'flight-review-evidence', false, 26214400, null)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit;

CREATE POLICY "Candidates and staff can read review evidence files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'flight-review-evidence'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR public.current_user_has_staff_role()
  )
);

CREATE POLICY "Candidates and staff can upload review evidence files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'flight-review-evidence'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR public.current_user_has_staff_role()
  )
);

CREATE POLICY "Upload owners and staff can update review evidence files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'flight-review-evidence'
  AND (owner_id = (SELECT auth.uid())::text OR public.current_user_has_staff_role())
)
WITH CHECK (
  bucket_id = 'flight-review-evidence'
  AND (owner_id = (SELECT auth.uid())::text OR public.current_user_has_staff_role())
);

CREATE POLICY "Upload owners and staff can delete review evidence files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'flight-review-evidence'
  AND (owner_id = (SELECT auth.uid())::text OR public.current_user_has_staff_role())
);

-- Preserve the existing thin flight-review records as historical snapshots.
INSERT INTO public.flight_review_records (
  template_course_id, template_snapshot, source_training_record_id, candidate_id,
  reviewer_user_id, booking_id, flight_log_id, review_type, authority, status,
  review_date, completion_date, aircraft_id, aircraft_type, registration,
  ground_minutes, flight_minutes, reviewer_summary, reviewer_sign_name,
  reviewer_sign_at, next_review_due, created_by, updated_by, created_at, updated_at
)
SELECT
  record.course_id,
  jsonb_build_object(
    'title', COALESCE(course.title, record.flight_review_type, 'Legacy flight review'),
    'version', COALESCE(course.version, 'legacy'),
    'review_configuration', jsonb_build_object(
      'legacy_import', true,
      'resets_flight_review', record.flight_review_result = 'pass',
      'validity_months', 24
    )
  ),
  record.id,
  record.student_id,
  record.instructor_id,
  record.booking_id,
  record.flight_log_id,
  CASE WHEN lower(COALESCE(record.flight_review_type, '')) LIKE '%test%' THEN 'external_flight_test' ELSE 'legacy_flight_review' END,
  'other',
  CASE record.flight_review_result
    WHEN 'pass' THEN 'completed'
    WHEN 'fail' THEN 'further_training_required'
    ELSE 'in_progress'
  END,
  record.date,
  CASE WHEN record.flight_review_result = 'pass' THEN record.date ELSE NULL END,
  record.aircraft_id,
  record.aircraft_type,
  record.registration,
  CASE WHEN record.formal_briefing THEN 60 ELSE 0 END,
  COALESCE(record.dual_time_min, 0) + COALESCE(record.solo_time_min, 0),
  concat_ws(E'\n\n', nullif(record.flight_review_notes, ''), nullif(record.comments, '')),
  COALESCE(instructor.name, 'Legacy instructor'),
  record.instructor_sign_timestamp,
  CASE WHEN record.flight_review_result = 'pass' THEN record.date + INTERVAL '24 months' ELSE NULL END,
  record.instructor_id,
  record.instructor_id,
  record.created_at,
  record.updated_at
FROM public.training_records record
LEFT JOIN public.training_courses course ON course.id = record.course_id
LEFT JOIN public.users instructor ON instructor.id = record.instructor_id
WHERE record.is_flight_review
ON CONFLICT (source_training_record_id) DO NOTHING;

-- Seed editable review/test templates. They deliberately use completion language
-- instead of pass/fail for RAAus BFRs.
WITH templates(title, description, category, version, purpose, tags, config) AS (
  VALUES
  (
    'RAAus Biennial Flight Review',
    'Individually tailored RAAus Pilot Certificate competency review based on RAAP 6 and Flight Operations Manual section 2.07.',
    'Flight Reviews', '2.0', 'flight_review', ARRAY['RAAus', 'BFR', 'currency'],
    jsonb_build_object(
      'review_type', 'raaus_bfr', 'authority', 'raaus', 'outcome_scheme', 'completion',
      'minimum_ground_minutes', 60, 'minimum_flight_minutes', 60,
      'validity_months', 24, 'resets_flight_review', true,
      'candidate_ack_required', true, 'aircraft_group_alternation_warning', true,
      'allowed_reviewer_roles', jsonb_build_array('senior_instructor', 'cfi', 'pilot_examiner'),
      'required_evidence', jsonb_build_array('authority_form'),
      'source_documents', jsonb_build_array('RAAP 6 v2.0', 'RAAus Flight Operations Manual section 2.07'),
      'checklist', jsonb_build_array(
        jsonb_build_object('key','ADM-01','section','Administration','code','ADM-01','title','Confirm current RAAus membership','guidance','Sight current membership and member number.','required',true),
        jsonb_build_object('key','ADM-02','section','Administration','code','ADM-02','title','Review logbook, recent activity and currency','guidance','Discuss recent and planned flying and tailor the review accordingly.','required',true),
        jsonb_build_object('key','ADM-03','section','Administration','code','ADM-03','title','Confirm endorsements and aircraft eligibility','guidance','Check relevant endorsements and aircraft group privileges.','required',true),
        jsonb_build_object('key','ADM-04','section','Administration','code','ADM-04','title','Confirm aircraft registration and airworthiness','guidance','Review registration, maintenance status and applicable limitations.','required',true),
        jsonb_build_object('key','GRD-01','section','Ground review','code','GRD-01','title','Review current operating procedures, regulations and flight rules','guidance','Include material changes since the previous review.','required',true),
        jsonb_build_object('key','GRD-02','section','Ground review','code','GRD-02','title','Review human factors, IMSAFE and personal minimums','guidance','Discuss fatigue, medical fitness, risk management and decision making.','required',true),
        jsonb_build_object('key','GRD-03','section','Ground review','code','GRD-03','title','Review weather, NOTAMs, VMC and airspace planning','guidance','Use a flight relevant to the candidate where practical.','required',true),
        jsonb_build_object('key','GRD-04','section','Ground review','code','GRD-04','title','Review fuel, weight and balance and aircraft performance','guidance','Reference the POH and practical operating limitations.','required',true),
        jsonb_build_object('key','GRD-05','section','Ground review','code','GRD-05','title','Review non-towered aerodrome and radio procedures','guidance','Include CTAF calls, circuit entry and situational awareness.','required',true),
        jsonb_build_object('key','FLT-01','section','Flight assessment','code','FLT-01','title','Pre-flight inspection, passenger brief and pre-take-off safety brief','guidance','Assess preparation, aircraft knowledge and emergency planning.','required',true),
        jsonb_build_object('key','FLT-02','section','Flight assessment','code','FLT-02','title','Start, taxi, radio, lookout and take-off','guidance','Maintain centreline and apply sound radio and traffic procedures.','required',true),
        jsonb_build_object('key','FLT-03','section','Flight assessment','code','FLT-03','title','Climbing, descending and turning','guidance','Include medium and steep turns where appropriate.','required',true),
        jsonb_build_object('key','FLT-04','section','Flight assessment','code','FLT-04','title','Stall recognition and recovery','guidance','Include power-on, power-off or operationally relevant configurations.','required',true),
        jsonb_build_object('key','FLT-05','section','Flight assessment','code','FLT-05','title','Practice forced landing','guidance','Assess field selection, planning, checks, calls and go-around decision.','required',true),
        jsonb_build_object('key','FLT-06','section','Flight assessment','code','FLT-06','title','Complete three landings and a go-around','guidance','Combine partial/full flap where available and a clean landing.','required',true),
        jsonb_build_object('key','FLT-07','section','Flight assessment','code','FLT-07','title','Radio communication and circuit procedures','guidance','Demonstrate competent calls, spacing, lookout and circuit judgement.','required',true),
        jsonb_build_object('key','FLT-08','section','Flight assessment','code','FLT-08','title','Manage simulated emergencies and undesired states','guidance','Tailor scenarios to the aircraft and candidate experience.','required',false),
        jsonb_build_object('key','FLT-09','section','Flight assessment','code','FLT-09','title','Demonstrate airmanship, situational awareness and decision making','guidance','Assess continuously throughout the flight.','required',true),
        jsonb_build_object('key','DBR-01','section','Debrief and completion','code','DBR-01','title','Conduct a clear debrief and agree any further training','guidance','A BFR is complete only once the required competency is demonstrated.','required',true),
        jsonb_build_object('key','DBR-02','section','Debrief and completion','code','DBR-02','title','Complete logbook entry and RAAus submission','guidance','Confirm the successful logbook entry and BFR reporting process.','required',true)
      )
    )
  ),
  (
    'CASA Aircraft Class Rating Flight Review',
    'Configurable CASA class-rating flight review template for competency assessment, refresher training and evidence.',
    'Flight Reviews', '1.0', 'flight_review', ARRAY['CASA', 'class rating', 'flight review'],
    jsonb_build_object(
      'review_type','casa_class_review','authority','casa','outcome_scheme','pass_fail',
      'minimum_ground_minutes',0,'minimum_flight_minutes',0,'validity_months',24,
      'resets_flight_review',true,'candidate_ack_required',true,
      'allowed_reviewer_roles',jsonb_build_array('instructor','senior_instructor','cfi','flight_examiner'),
      'required_evidence',jsonb_build_array(),
      'source_documents',jsonb_build_array('CASR Part 61','Part 61 Manual of Standards'),
      'checklist',jsonb_build_array(
        jsonb_build_object('key','CASA-01','section','Preparation','code','CASA-01','title','Confirm rating, recency and review scope','guidance','Identify each rating covered by the review.','required',true),
        jsonb_build_object('key','CASA-02','section','Ground review','code','CASA-02','title','Assess applicable operational knowledge and planning','guidance','Tailor to the ratings and planned operation.','required',true),
        jsonb_build_object('key','CASA-03','section','Flight assessment','code','CASA-03','title','Demonstrate the applicable Part 61 MOS competencies','guidance','Record each activity selected for the review.','required',true),
        jsonb_build_object('key','CASA-04','section','Flight assessment','code','CASA-04','title','Demonstrate threat and error management and non-technical skills','guidance','Assess throughout the review.','required',true),
        jsonb_build_object('key','CASA-05','section','Completion','code','CASA-05','title','Record refresher training or additional flights where required','guidance','The review may be completed over multiple flights.','required',true),
        jsonb_build_object('key','CASA-06','section','Completion','code','CASA-06','title','Complete logbook and CASA notification requirements','guidance','Record the completion evidence applicable to the rating.','required',true)
      )
    )
  ),
  (
    'External Flight Test',
    'Record and verify a licence, rating or endorsement flight test conducted by an examiner outside the club CRM.',
    'Flight Tests', '1.0', 'flight_test', ARRAY['external', 'flight test', 'examiner'],
    jsonb_build_object(
      'review_type','external_flight_test','authority','other','outcome_scheme','pass_fail',
      'minimum_ground_minutes',0,'minimum_flight_minutes',0,'validity_months',0,
      'resets_flight_review',false,'candidate_ack_required',true,
      'allowed_reviewer_roles',jsonb_build_array('admin','cfi'),
      'required_evidence',jsonb_build_array('external_test_report'),
      'source_documents',jsonb_build_array(),
      'checklist',jsonb_build_array(
        jsonb_build_object('key','EXT-01','section','Examiner','code','EXT-01','title','Record examiner identity, authority and organisation','guidance','Use the ARN, member number or examiner authorisation where applicable.','required',true),
        jsonb_build_object('key','EXT-02','section','Test details','code','EXT-02','title','Record the licence, rating or endorsement tested','guidance','Include attempt number and any limitations.','required',true),
        jsonb_build_object('key','EXT-03','section','Test details','code','EXT-03','title','Record aircraft and test date','guidance','Confirm the aircraft was suitable for the test.','required',true),
        jsonb_build_object('key','EXT-04','section','Evidence','code','EXT-04','title','Upload the signed external test report','guidance','The report must be verified before privileges are updated.','required',true),
        jsonb_build_object('key','EXT-05','section','Verification','code','EXT-05','title','Verify result, limitations and completion evidence','guidance','An admin or CFI verifies the external evidence.','required',true)
      )
    )
  ),
  (
    'Club Check Flight',
    'Flexible club competency and recency check that does not replace a regulatory flight review unless explicitly configured.',
    'Proficiency Checks', '1.0', 'proficiency_check', ARRAY['club check', 'recency', 'proficiency'],
    jsonb_build_object(
      'review_type','club_check','authority','club','outcome_scheme','completion',
      'minimum_ground_minutes',0,'minimum_flight_minutes',0,'validity_months',0,
      'resets_flight_review',false,'candidate_ack_required',true,
      'allowed_reviewer_roles',jsonb_build_array('instructor','senior_instructor','cfi'),
      'required_evidence',jsonb_build_array(),
      'source_documents',jsonb_build_array('Club operating procedures'),
      'checklist',jsonb_build_array(
        jsonb_build_object('key','CLUB-01','section','Preparation','code','CLUB-01','title','Agree the purpose and scope of the check','guidance','Identify the recency or proficiency concern being addressed.','required',true),
        jsonb_build_object('key','CLUB-02','section','Flight assessment','code','CLUB-02','title','Demonstrate aircraft handling appropriate to the planned operation','guidance','Tailor exercises to the aircraft and intended privileges.','required',true),
        jsonb_build_object('key','CLUB-03','section','Flight assessment','code','CLUB-03','title','Demonstrate circuit, landing and go-around competence','guidance','Include the relevant wind and configuration considerations.','required',true),
        jsonb_build_object('key','CLUB-04','section','Flight assessment','code','CLUB-04','title','Demonstrate emergency handling and sound decision making','guidance','Use safe scenarios relevant to the candidate.','required',true),
        jsonb_build_object('key','CLUB-05','section','Debrief','code','CLUB-05','title','Record outcome and any operating limitations or further training','guidance','Do not imply a regulatory flight review unless the template is configured to do so.','required',true)
      )
    )
  )
)
INSERT INTO public.training_courses (
  title, description, category, version, status, estimated_duration_hours,
  tags, course_purpose, review_configuration, requires_student_acknowledgement,
  created_by, last_updated
)
SELECT
  template.title, template.description, template.category, template.version,
  'published', 2, template.tags, template.purpose, template.config, true,
  NULL, now()
FROM templates template
WHERE NOT EXISTS (
  SELECT 1 FROM public.training_courses existing
  WHERE lower(existing.title) = lower(template.title)
    AND existing.course_purpose = template.purpose
);
