-- CFI is an additive authority role. It deliberately does not become the
-- primary portal role, so a CFI retains their normal admin/instructor UI.
ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_check;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role = ANY (ARRAY[
    'admin'::text,
    'cfi'::text,
    'senior_instructor'::text,
    'instructor'::text,
    'pilot'::text,
    'student'::text
  ]));

CREATE OR REPLACE FUNCTION public.current_user_is_cfi()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'cfi'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_cfi() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_cfi() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_cfi() TO service_role;

CREATE TABLE public.instructor_compliance_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  version text NOT NULL DEFAULT '1.0',
  source_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.instructor_compliance_course_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.instructor_compliance_courses(id) ON DELETE CASCADE,
  section text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  guidance text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,
  applicable_levels text[] NOT NULL DEFAULT ARRAY['instructor', 'senior_instructor']::text[],
  applicable_check_types text[] NOT NULL DEFAULT ARRAY['sp_check', 'renewal']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instructor_compliance_item_levels_check CHECK (
    applicable_levels <@ ARRAY['instructor', 'senior_instructor']::text[]
  ),
  CONSTRAINT instructor_compliance_item_types_check CHECK (
    applicable_check_types <@ ARRAY['initial_issue', 'sp_check', 'renewal']::text[]
  ),
  UNIQUE (course_id, code)
);

CREATE TABLE public.instructor_compliance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.instructor_compliance_courses(id),
  candidate_instructor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  examiner_cfi_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  flight_log_id uuid REFERENCES public.flight_logs(id) ON DELETE SET NULL,
  check_type text NOT NULL,
  instructor_level text NOT NULL,
  check_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  outcome text NOT NULL DEFAULT 'not_assessed',
  ground_minutes integer NOT NULL DEFAULT 0,
  flight_minutes integer NOT NULL DEFAULT 0,
  briefing_lesson text NOT NULL DEFAULT '',
  emergency_control_plan_confirmed boolean NOT NULL DEFAULT false,
  medical_sighted boolean NOT NULL DEFAULT false,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  strengths text NOT NULL DEFAULT '',
  deficiencies text NOT NULL DEFAULT '',
  development_plan text NOT NULL DEFAULT '',
  cfi_comments text NOT NULL DEFAULT '',
  raap6_version text NOT NULL DEFAULT 'RAAP 6',
  raap7_version text NOT NULL DEFAULT 'RAAP 7',
  raaus_form_path text,
  raaus_form_name text,
  completed_at timestamptz,
  next_sp_check_due date,
  next_renewal_due date,
  voided_at timestamptz,
  voided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instructor_compliance_check_type_check CHECK (
    check_type = ANY (ARRAY['initial_issue', 'sp_check', 'renewal']::text[])
  ),
  CONSTRAINT instructor_compliance_level_check CHECK (
    instructor_level = ANY (ARRAY['instructor', 'senior_instructor']::text[])
  ),
  CONSTRAINT instructor_compliance_status_check CHECK (
    status = ANY (ARRAY['draft', 'completed', 'remedial_required', 'voided']::text[])
  ),
  CONSTRAINT instructor_compliance_outcome_check CHECK (
    outcome = ANY (ARRAY['not_assessed', 'satisfactory', 'unsatisfactory']::text[])
  ),
  CONSTRAINT instructor_compliance_duration_check CHECK (
    ground_minutes >= 0 AND flight_minutes >= 0
  ),
  CONSTRAINT instructor_compliance_renewal_form_check CHECK (
    check_type <> 'renewal'
    OR status NOT IN ('completed', 'remedial_required')
    OR raaus_form_path IS NOT NULL
  ),
  CONSTRAINT instructor_compliance_examiner_distinct_check CHECK (
    candidate_instructor_id <> examiner_cfi_id
  )
);

CREATE INDEX instructor_compliance_records_candidate_date_idx
  ON public.instructor_compliance_records(candidate_instructor_id, check_date DESC)
  WHERE voided_at IS NULL;

CREATE INDEX instructor_compliance_records_examiner_idx
  ON public.instructor_compliance_records(examiner_cfi_id, created_at DESC);

CREATE UNIQUE INDEX instructor_compliance_records_flight_log_idx
  ON public.instructor_compliance_records(flight_log_id)
  WHERE flight_log_id IS NOT NULL AND voided_at IS NULL;

CREATE TABLE public.instructor_compliance_record_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid REFERENCES public.instructor_compliance_records(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX instructor_compliance_audit_record_idx
  ON public.instructor_compliance_record_audit(record_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prepare_instructor_compliance_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_senior boolean;
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

REVOKE ALL ON FUNCTION public.prepare_instructor_compliance_record() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_instructor_compliance_record() TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_instructor_compliance_record() TO service_role;

CREATE OR REPLACE FUNCTION public.audit_instructor_compliance_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.instructor_compliance_record_audit (
    record_id,
    actor_id,
    action,
    old_data,
    new_data
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_instructor_compliance_record() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_instructor_compliance_record() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_instructor_compliance_record() TO service_role;

CREATE TRIGGER prepare_instructor_compliance_record_trigger
BEFORE INSERT OR UPDATE ON public.instructor_compliance_records
FOR EACH ROW EXECUTE FUNCTION public.prepare_instructor_compliance_record();

CREATE TRIGGER audit_instructor_compliance_record_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.instructor_compliance_records
FOR EACH ROW EXECUTE FUNCTION public.audit_instructor_compliance_record();

CREATE OR REPLACE FUNCTION public.notify_instructor_compliance_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        WHEN NEW.outcome = 'satisfactory' THEN
          'Your ' || CASE WHEN NEW.check_type = 'renewal' THEN 'instructor renewal' ELSE 'Standards & Proficiency check' END
          || ' was completed. Your next S&P check is due '
          || COALESCE(to_char(NEW.next_sp_check_due, 'DD Mon YYYY'), 'as advised by your CFI') || '.'
        ELSE
          'Your Standards & Proficiency check requires remedial action. Contact your CFI before conducting further instructional duties.'
      END,
      jsonb_build_object(
        'check_type', NEW.check_type,
        'outcome', NEW.outcome,
        'next_sp_check_due', NEW.next_sp_check_due,
        'next_renewal_due', NEW.next_renewal_due
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_instructor_compliance_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_instructor_compliance_result() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_instructor_compliance_result() TO service_role;

CREATE TRIGGER notify_instructor_compliance_result_trigger
AFTER INSERT OR UPDATE ON public.instructor_compliance_records
FOR EACH ROW EXECUTE FUNCTION public.notify_instructor_compliance_result();

ALTER TABLE public.instructor_compliance_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_compliance_course_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_compliance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_compliance_record_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CFIs can read instructor compliance courses"
ON public.instructor_compliance_courses FOR SELECT TO authenticated
USING (public.current_user_is_cfi());

CREATE POLICY "CFIs can manage instructor compliance courses"
ON public.instructor_compliance_courses FOR ALL TO authenticated
USING (public.current_user_is_cfi())
WITH CHECK (public.current_user_is_cfi());

CREATE POLICY "CFIs can read instructor compliance course items"
ON public.instructor_compliance_course_items FOR SELECT TO authenticated
USING (public.current_user_is_cfi());

CREATE POLICY "CFIs can manage instructor compliance course items"
ON public.instructor_compliance_course_items FOR ALL TO authenticated
USING (public.current_user_is_cfi())
WITH CHECK (public.current_user_is_cfi());

CREATE POLICY "CFIs can read instructor compliance records"
ON public.instructor_compliance_records FOR SELECT TO authenticated
USING (public.current_user_is_cfi());

CREATE POLICY "CFIs can insert own instructor compliance records"
ON public.instructor_compliance_records FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_is_cfi()
  AND examiner_cfi_id = auth.uid()
);

CREATE POLICY "Examining CFIs can update instructor compliance records"
ON public.instructor_compliance_records FOR UPDATE TO authenticated
USING (
  public.current_user_is_cfi()
  AND examiner_cfi_id = auth.uid()
)
WITH CHECK (
  public.current_user_is_cfi()
  AND examiner_cfi_id = auth.uid()
);

CREATE POLICY "CFIs can read instructor compliance audit"
ON public.instructor_compliance_record_audit FOR SELECT TO authenticated
USING (public.current_user_is_cfi());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('instructor-compliance-forms', 'instructor-compliance-forms', false, 26214400, null)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "CFIs can read instructor compliance forms"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'instructor-compliance-forms' AND public.current_user_is_cfi());

CREATE POLICY "CFIs can upload instructor compliance forms"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'instructor-compliance-forms' AND public.current_user_is_cfi());

CREATE POLICY "CFIs can update instructor compliance forms"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'instructor-compliance-forms' AND public.current_user_is_cfi())
WITH CHECK (bucket_id = 'instructor-compliance-forms' AND public.current_user_is_cfi());

CREATE POLICY "CFIs can delete instructor compliance forms"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'instructor-compliance-forms' AND public.current_user_is_cfi());

DO $$
DECLARE
  v_course_id uuid;
BEGIN
  SELECT id INTO v_course_id
  FROM public.instructor_compliance_courses
  WHERE name = 'RAAus Instructor Standards & Proficiency / Renewal'
  LIMIT 1;

  IF v_course_id IS NULL THEN
    INSERT INTO public.instructor_compliance_courses (
      name,
      description,
      version,
      source_documents
    ) VALUES (
      'RAAus Instructor Standards & Proficiency / Renewal',
      'CFI-only course for Instructor and Senior Instructor standards and proficiency checks, initial issue evidence, and two-year rating renewals.',
      '2026.1',
      '[{"name":"RAAP 7","purpose":"Initial issue, S&P and renewal for rating or higher approval holders"},{"name":"RAAP 6","purpose":"Conduct of biennial flight reviews by instructors"}]'::jsonb
    ) RETURNING id INTO v_course_id;
  END IF;

  INSERT INTO public.instructor_compliance_course_items
    (course_id, section, code, title, guidance, sort_order, applicable_levels, applicable_check_types)
  VALUES
    (v_course_id, 'Eligibility and administration', 'ADM-01', 'Confirm membership, instructor rating and approval are current', 'Sight current membership and rating details before the check.', 10, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Eligibility and administration', 'ADM-02', 'Sight an acceptable current medical', 'CASA Class 2 or RAAus Instructor Medical MED003. A Basic Class 2 is not sufficient for instructor privileges.', 20, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Eligibility and administration', 'ADM-03', 'Review logbook, recent activity and Instructor Portal compliance', 'Confirm recency, required reviews, revisions and portal currency.', 30, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Eligibility and administration', 'ADM-04', 'Confirm aircraft registration, airworthiness and POH availability', 'Review minimum airworthiness requirements and relevant aircraft limitations.', 40, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Eligibility and administration', 'ADM-05', 'Confirm examiner eligibility and renewal window', 'Confirm the check is being conducted by an authorised person and record any early-renewal or extension basis.', 50, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','renewal']),

    (v_course_id, 'Ground and pre-flight briefing', 'BRF-01', 'Deliver an examiner-nominated lesson briefing using FIRM', 'The examiner acts as the student. Include training context, learning outcomes, readiness and formative assessment.', 100, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Ground and pre-flight briefing', 'BRF-02', 'Demonstrate deeper aerodynamics and aircraft systems knowledge', 'Answer questions beyond the student lesson level and connect theory to practical instruction.', 110, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Ground and pre-flight briefing', 'BRF-03', 'Explain privileges, supervision limits and permitted training', 'Cover direct or indirect supervision requirements, permitted training and escalation to the CFI.', 120, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Ground and pre-flight briefing', 'BRF-04', 'Explain aircraft airworthiness minimums, POH use and personal minima', 'Demonstrate sound operational judgement before flight.', 130, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Ground and pre-flight briefing', 'BFR-01', 'Plan a candidate-specific BFR', 'Use history, recent flying, future operations and candidate objectives to design the review.', 140, ARRAY['senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Ground and pre-flight briefing', 'BFR-02', 'Demonstrate BFR ground knowledge and administration', 'Cover air law, regulatory changes, human factors, weather, fuel, W&B, CTAF, airspace and required forms.', 150, ARRAY['senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),

    (v_course_id, 'Flight assessment', 'FLT-01', 'Nominate and brief control responsibility for a real emergency', 'Before flight, agree who takes control and the handover/takeover wording.', 200, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-02', 'Deliver a clear pre-take-off safety briefing', 'Include emergency actions, communication and positive transfer of control.', 210, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-03', 'Demonstrate effective instructional patter and demonstrations', 'Maintain a suitable student workload, clear explanations and timely correction.', 220, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-04', 'Operate within the RAAP 7 flight tolerances', 'Assess taxi, heading, altitude, airspeed, turns, final approach and landing tolerances.', 230, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-05', 'Teach and demonstrate medium and steep turns', 'Include lookout, balance, altitude control and recovery.', 240, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-06', 'Teach and demonstrate power-on and power-off stalls', 'Include recognition, prevention, recovery and human factors.', 250, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-07', 'Teach a forced landing to no lower than 500 feet AGL', 'Include instructional patter, field selection, planning and go-around decision.', 260, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-08', 'Teach normal and non-standard circuits and go-arounds', 'Assess circuit judgement, flap variation, clean landing, crosswind and go-around competence.', 270, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-09', 'Manage simulated engine and aircraft-system failures', 'Use safe scenarios, sound judgement and suitable student intervention.', 280, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'FLT-10', 'Maintain lookout, radio, situational awareness and threat management', 'Demonstrate human factors, non-technical skills and airmanship throughout.', 290, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'SEN-01', 'Assess whether a student is ready for first solo', 'Apply the school standard and explain the evidence used for the decision.', 300, ARRAY['senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'SEN-02', 'Demonstrate BFR flight content and assessment decisions', 'Include at least three landings with flap variations, go-around, stalls, PFL, radio and circuit competence.', 310, ARRAY['senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Flight assessment', 'SEN-03', 'Demonstrate endorsement-training and issue standards', 'Explain the applicable syllabus, evidence, authorisation and record requirements.', 320, ARRAY['senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),

    (v_course_id, 'Debrief, outcome and records', 'DBR-01', 'Candidate completes an accurate self-debrief', 'Candidate identifies strengths, deficiencies and practical improvements.', 400, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Debrief, outcome and records', 'DBR-02', 'CFI provides an evidence-based debrief', 'Link the outcome to observed evidence and the required standard.', 410, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Debrief, outcome and records', 'DBR-03', 'Record remedial training and a development plan where needed', 'A failed ground component stops the flight. An unsafe flight component is ended as soon as practicable.', 420, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Debrief, outcome and records', 'DBR-04', 'Complete both instructor and CFI logbook entries', 'Record a satisfactory S&P or renewal in both relevant logbooks.', 430, ARRAY['instructor','senior_instructor'], ARRAY['initial_issue','sp_check','renewal']),
    (v_course_id, 'Debrief, outcome and records', 'REN-01', 'Complete and attach the applicable RAAus renewal form', 'Attach the signed INS002 or current RAAus replacement form before finalising a renewal.', 440, ARRAY['instructor','senior_instructor'], ARRAY['renewal'])
  ON CONFLICT (course_id, code) DO UPDATE SET
    section = EXCLUDED.section,
    title = EXCLUDED.title,
    guidance = EXCLUDED.guidance,
    sort_order = EXCLUDED.sort_order,
    required = EXCLUDED.required,
    applicable_levels = EXCLUDED.applicable_levels,
    applicable_check_types = EXCLUDED.applicable_check_types;
END $$;

COMMENT ON TABLE public.instructor_compliance_records IS
  'CFI-only S&P, initial issue and instructor renewal evidence. Admin access is intentionally excluded unless the admin also holds the CFI role.';

COMMENT ON COLUMN public.instructor_compliance_records.raaus_form_path IS
  'Private storage path for the applicable RAAus renewal form. Required before a renewal can be completed.';
