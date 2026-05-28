/*
  Replace the RAAus ab-initio course assessment criteria with the Bendigo Flying
  Club lesson grading matrix. Each criterion uses the -, NC, S, C scale.
*/

DO $$
DECLARE
  target_course_id uuid;
  criteria jsonb := '[
    {"id":"flt-prep-ground-ops","name":"Flt. Prep & Ground Ops","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"airmanship-hf","name":"Airmanship & HF","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"effects-of-controls","name":"Effects of Controls","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"straight-level","name":"Straight & Level","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"climbing","name":"Climbing","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"descending","name":"Descending","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"basic-turning","name":"Basic Turning","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"slow-flight-stalls","name":"Slow Flight & Stalls","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"take-off","name":"Take-Off","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"landing","name":"Landing","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"efic-efato","name":"E.F.I.C & E.F.A.T.O","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"advanced-turning","name":"Advanced Turning","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"scenario-based-stalling","name":"Scenario Based Stalling","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"aircraft-equipment","name":"Aircraft Equipment","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"forced-landings","name":"Forced Landings","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"operation-in-ta","name":"Operation in TA","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"unexpected-undesired-states","name":"Unexpected / Undesired states","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"practice-flight-test","name":"Practice Flight Test","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"consolidation","name":"Consolidation","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"flight-test","name":"Flight Test","gradingSystem":"NC/S/C/-","passingGrade":"S"}
  ]'::jsonb;
BEGIN
  SELECT id INTO target_course_id
  FROM public.training_courses
  WHERE title = 'RAAus Ab-Initio RPC - Group A (3-Axis)'
  ORDER BY created_at DESC
  LIMIT 1;

  IF target_course_id IS NULL THEN
    RAISE NOTICE 'RAAus ab-initio course not found; skipping assessment criteria update.';
    RETURN;
  END IF;

  UPDATE public.training_courses
  SET
    assessment_criteria = criteria,
    evaluation_criteria = ARRAY[
      'Use the -, NC, S, C grading scale for each listed assessment criterion',
      'All relevant pre-solo items must be S or C before first solo',
      'Radio, BAK and pre-certificate Air Law exam requirements are tracked separately before RPC recommendation',
      'Practice Flight Test, Consolidation and Flight Test criteria must be S or C before CFI recommendation'
    ],
    last_updated = now()
  WHERE id = target_course_id;

  UPDATE public.training_lessons
  SET pass_marks = '{}'::jsonb
  WHERE course_id = target_course_id;

  UPDATE public.training_lessons
  SET pass_marks = '{
    "flt-prep-ground-ops":"S",
    "airmanship-hf":"S",
    "aircraft-equipment":"S"
  }'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Trial Instruction Flight';

  UPDATE public.training_lessons
  SET pass_marks = '{
    "flt-prep-ground-ops":"S",
    "airmanship-hf":"S",
    "effects-of-controls":"S",
    "aircraft-equipment":"S"
  }'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Effects of controls';

  UPDATE public.training_lessons
  SET pass_marks = '{"straight-level":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Straight and level';

  UPDATE public.training_lessons
  SET pass_marks = '{"climbing":"S","descending":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Climbing and descending';

  UPDATE public.training_lessons
  SET pass_marks = '{"basic-turning":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Medium turns, climbing turns and descending turns';

  UPDATE public.training_lessons
  SET pass_marks = '{"advanced-turning":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Advanced turns';

  UPDATE public.training_lessons
  SET pass_marks = '{"slow-flight-stalls":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Slow flight and basic stalls';

  UPDATE public.training_lessons
  SET pass_marks = '{"scenario-based-stalling":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Scenario-based stalls';

  UPDATE public.training_lessons
  SET pass_marks = '{"take-off":"S","landing":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Circuit introduction, take-off, approach and landing';

  UPDATE public.training_lessons
  SET pass_marks = '{"take-off":"S","landing":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Go-around and continued circuits';

  UPDATE public.training_lessons
  SET pass_marks = '{"efic-efato":"S","take-off":"S","landing":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Circuit consolidation and circuit emergencies';

  UPDATE public.training_lessons
  SET pass_marks = '{"consolidation":"S","take-off":"S","landing":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'First solo and supervised solo circuit consolidation';

  UPDATE public.training_lessons
  SET pass_marks = '{"operation-in-ta":"S","airmanship-hf":"S","flt-prep-ground-ops":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Training area operations and radio procedures';

  UPDATE public.training_lessons
  SET pass_marks = '{"forced-landings":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Forced landing, glide approaches and sideslip awareness';

  UPDATE public.training_lessons
  SET pass_marks = '{"forced-landings":"S","airmanship-hf":"S","unexpected-undesired-states":"S","operation-in-ta":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Precautionary search and landing';

  UPDATE public.training_lessons
  SET pass_marks = '{"unexpected-undesired-states":"S","airmanship-hf":"S","aircraft-equipment":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'Abnormal situations and emergency management';

  UPDATE public.training_lessons
  SET pass_marks = '{"practice-flight-test":"S","consolidation":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'RPC consolidation: flight test profile practice';

  UPDATE public.training_lessons
  SET pass_marks = '{"flight-test":"S","practice-flight-test":"S","consolidation":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id
    AND name = 'CFI recommendation and Pilot Certificate readiness review';
END $$;
