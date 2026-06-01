/*
  Add the final Pilot Certificate Flight Test to the RAAus Ab-Initio RPC course
  and seed the theory exam requirements used by the student profile exam log.
*/

DO $$
DECLARE
  target_course_id uuid;
  next_sort_order integer;
  not_assessed jsonb := '{
    "flt-prep-ground-ops":"-",
    "airmanship-hf":"-",
    "effects-of-controls":"-",
    "straight-level":"-",
    "climbing":"-",
    "descending":"-",
    "basic-turning":"-",
    "slow-flight-stalls":"-",
    "take-off":"-",
    "landing":"-",
    "efic-efato":"-",
    "advanced-turning":"-",
    "scenario-based-stalling":"-",
    "aircraft-equipment":"-",
    "forced-landings":"-",
    "operation-in-ta":"-",
    "unexpected-undesired-states":"-",
    "practice-flight-test":"-",
    "consolidation":"-",
    "flight-test":"-"
  }'::jsonb;
  flight_test_pass_marks jsonb := not_assessed || '{
    "flt-prep-ground-ops":"C",
    "airmanship-hf":"C",
    "effects-of-controls":"C",
    "straight-level":"C",
    "climbing":"C",
    "descending":"C",
    "basic-turning":"C",
    "slow-flight-stalls":"C",
    "take-off":"C",
    "landing":"C",
    "efic-efato":"C",
    "advanced-turning":"C",
    "scenario-based-stalling":"C",
    "aircraft-equipment":"C",
    "forced-landings":"C",
    "operation-in-ta":"C",
    "unexpected-undesired-states":"C",
    "practice-flight-test":"C",
    "consolidation":"C",
    "flight-test":"C"
  }'::jsonb;
  course_exam jsonb;
BEGIN
  SELECT id INTO target_course_id
  FROM public.training_courses
  WHERE title IN ('RAAus Ab-Initio RPC', 'RAAus Ab-Initio RPC - Group A (3-Axis)')
  ORDER BY created_at DESC
  LIMIT 1;

  IF target_course_id IS NULL THEN
    RAISE NOTICE 'RAAus ab-initio course not found; skipping Pilot Certificate Flight Test update.';
    RETURN;
  END IF;

  UPDATE public.training_courses
  SET
    objectives = CASE
      WHEN NOT ('Complete the RAAus Pilot Certificate Flight Test and record the result as a flight review outcome' = ANY(coalesce(objectives, ARRAY[]::text[])))
      THEN coalesce(objectives, ARRAY[]::text[]) || ARRAY['Complete the RAAus Pilot Certificate Flight Test and record the result as a flight review outcome']
      ELSE objectives
    END,
    evaluation_criteria = CASE
      WHEN NOT ('Pilot Certificate Flight Test requires C / Pilot Ready standard on all relevant certificate competencies' = ANY(coalesce(evaluation_criteria, ARRAY[]::text[])))
      THEN coalesce(evaluation_criteria, ARRAY[]::text[]) || ARRAY['Pilot Certificate Flight Test requires C / Pilot Ready standard on all relevant certificate competencies']
      ELSE evaluation_criteria
    END,
    last_updated = now()
  WHERE id = target_course_id;

  FOREACH course_exam IN ARRAY ARRAY[
    '{"id":"presolo-exam","name":"Presolo Exam","passMark":80}'::jsonb,
    '{"id":"radio-exam","name":"Radio Exam","passMark":80}'::jsonb,
    '{"id":"bak-exam","name":"BAK Exam","passMark":80}'::jsonb,
    '{"id":"pre-certificate-airlaw-exam","name":"Pre Certificate Airlaw Exam","passMark":80}'::jsonb
  ]
  LOOP
    UPDATE public.training_courses
    SET exam_requirements = coalesce(exam_requirements, '[]'::jsonb) || jsonb_build_array(course_exam)
    WHERE id = target_course_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(exam_requirements, '[]'::jsonb)) AS existing_exam
        WHERE existing_exam->>'id' = course_exam->>'id'
      );
  END LOOP;

  SELECT coalesce(max(sort_order), -1) + 1 INTO next_sort_order
  FROM public.training_lessons
  WHERE course_id = target_course_id;

  UPDATE public.training_lessons
  SET
    sort_order = CASE WHEN sort_order < next_sort_order THEN sort_order ELSE next_sort_order END,
    name = 'Pilot Certificate Flight Test',
    objective = 'Complete the RAAus Pilot Certificate Flight Test and record the result against the student file as the certificate flight review / test outcome.',
    flight_exercises = '<ul><li>Pre-flight planning, aircraft documents and operational decision making.</li><li>Normal and abnormal handling across the RPC flight test profile.</li><li>Circuit, forced landing, training area, emergency and undesired-state management.</li><li>Post-flight debrief, result, limitations and next actions.</li></ul>',
    theory = '<p>Confirm Presolo, Radio, BAK and Pre Certificate Airlaw exam results are recorded before the certificate test result is finalised.</p>',
    sequence_id = 'raaus-abinitio-19',
    sequence_code = 'RPC-FLT-TEST',
    sequence_title = 'Pilot Certificate Flight Test',
    stage = 'flight',
    duration_minutes = 120,
    min_competency = 'Assess',
    key_exercises = ARRAY['Pilot certificate flight test profile', 'Operational decision making', 'Emergency and abnormal management', 'Certificate result and debrief'],
    student_preparation = 'Bring logbook, membership details, completed exam evidence and any required RAAus or club documentation. Prepare as for a certificate flight test.',
    instructor_notes = 'If passed, log the training record as a Flight Review / Flight Test with a pass result so the student is promoted to pilot status automatically.',
    pass_marks = flight_test_pass_marks
  WHERE course_id = target_course_id
    AND (sequence_id = 'raaus-abinitio-19' OR name = 'Pilot Certificate Flight Test');

  IF NOT FOUND THEN
    INSERT INTO public.training_lessons (
      course_id,
      sort_order,
      name,
      objective,
      flight_exercises,
      theory,
      sequence_id,
      sequence_code,
      sequence_title,
      stage,
      duration_minutes,
      min_competency,
      key_exercises,
      student_preparation,
      instructor_notes,
      pass_marks
    )
    VALUES (
      target_course_id,
      next_sort_order,
      'Pilot Certificate Flight Test',
      'Complete the RAAus Pilot Certificate Flight Test and record the result against the student file as the certificate flight review / test outcome.',
      '<ul><li>Pre-flight planning, aircraft documents and operational decision making.</li><li>Normal and abnormal handling across the RPC flight test profile.</li><li>Circuit, forced landing, training area, emergency and undesired-state management.</li><li>Post-flight debrief, result, limitations and next actions.</li></ul>',
      '<p>Confirm Presolo, Radio, BAK and Pre Certificate Airlaw exam results are recorded before the certificate test result is finalised.</p>',
      'raaus-abinitio-19',
      'RPC-FLT-TEST',
      'Pilot Certificate Flight Test',
      'flight',
      120,
      'Assess',
      ARRAY['Pilot certificate flight test profile', 'Operational decision making', 'Emergency and abnormal management', 'Certificate result and debrief'],
      'Bring logbook, membership details, completed exam evidence and any required RAAus or club documentation. Prepare as for a certificate flight test.',
      'If passed, log the training record as a Flight Review / Flight Test with a pass result so the student is promoted to pilot status automatically.',
      flight_test_pass_marks
    );
  END IF;
END $$;
