/*
  Make lesson pass marks explicit for the RAAus ab-initio course.

  Every lesson carries every assessment criterion. Criteria not being assessed
  in that lesson are set to "-" so they are treated as not assessed / passed for
  that lesson. Criteria being assessed remain "S".
*/

DO $$
DECLARE
  target_course_id uuid;
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
BEGIN
  SELECT id INTO target_course_id
  FROM public.training_courses
  WHERE title = 'RAAus Ab-Initio RPC - Group A (3-Axis)'
  ORDER BY created_at DESC
  LIMIT 1;

  IF target_course_id IS NULL THEN
    RAISE NOTICE 'RAAus ab-initio course not found; skipping pass mark update.';
    RETURN;
  END IF;

  UPDATE public.training_courses
  SET
    evaluation_criteria = ARRAY[
      'Use the -, NC, S, C grading scale for each listed assessment criterion',
      'A lesson pass mark of - means the criterion is not assessed in that lesson',
      'Earlier lessons only require S on the criteria being taught or assessed in that lesson',
      'All relevant pre-solo items must be S or C before first solo',
      'Practice Flight Test, Consolidation and Flight Test criteria must be S or C before CFI recommendation'
    ],
    last_updated = now()
  WHERE id = target_course_id;

  UPDATE public.training_lessons
  SET pass_marks = not_assessed
  WHERE course_id = target_course_id;

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"flt-prep-ground-ops":"S","airmanship-hf":"S","aircraft-equipment":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Trial Instruction Flight';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"flt-prep-ground-ops":"S","airmanship-hf":"S","effects-of-controls":"S","aircraft-equipment":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Effects of controls';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"straight-level":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Straight and level';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"climbing":"S","descending":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Climbing and descending';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"basic-turning":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Medium turns, climbing turns and descending turns';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"advanced-turning":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Advanced turns';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"slow-flight-stalls":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Slow flight and basic stalls';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"scenario-based-stalling":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Scenario-based stalls';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"take-off":"S","landing":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Circuit introduction, take-off, approach and landing';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"take-off":"S","landing":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Go-around and continued circuits';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"efic-efato":"S","take-off":"S","landing":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Circuit consolidation and circuit emergencies';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"consolidation":"S","take-off":"S","landing":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'First solo and supervised solo circuit consolidation';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"operation-in-ta":"S","airmanship-hf":"S","flt-prep-ground-ops":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Training area operations and radio procedures';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"forced-landings":"S","airmanship-hf":"S","unexpected-undesired-states":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Forced landing, glide approaches and sideslip awareness';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"forced-landings":"S","airmanship-hf":"S","unexpected-undesired-states":"S","operation-in-ta":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Precautionary search and landing';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"unexpected-undesired-states":"S","airmanship-hf":"S","aircraft-equipment":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'Abnormal situations and emergency management';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"practice-flight-test":"S","consolidation":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'RPC consolidation: flight test profile practice';

  UPDATE public.training_lessons
  SET pass_marks = not_assessed || '{"flight-test":"S","practice-flight-test":"S","consolidation":"S","airmanship-hf":"S"}'::jsonb
  WHERE course_id = target_course_id AND name = 'CFI recommendation and Pilot Certificate readiness review';
END $$;
