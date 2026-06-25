/*
  The CASA RPL(A) final flight test/check should show the full final
  qualification-standard matrix, not only the three broad course criteria.
  The source planning matrix maps those final rows to RPL(A)30, so this links
  the same rows to the course-defined flight test lesson.
*/
DO $$
DECLARE
  target_course_id uuid;
  source_lesson_code text := 'RPL(A)30';
  target_lesson_id uuid;
BEGIN
  SELECT id INTO target_course_id
  FROM public.training_courses
  WHERE title IN ('CASA RPL(A) v1.2', 'CASA RPL(A)')
  ORDER BY last_updated DESC
  LIMIT 1;

  IF target_course_id IS NULL THEN
    RAISE NOTICE 'CASA RPL(A) course not found; flight test matrix link skipped.';
    RETURN;
  END IF;

  SELECT id INTO target_lesson_id
  FROM public.training_lessons
  WHERE course_id = target_course_id
    AND (sequence_code = 'RPL(A)FT' OR is_flight_test IS TRUE)
  ORDER BY sort_order DESC
  LIMIT 1;

  IF target_lesson_id IS NULL THEN
    RAISE NOTICE 'CASA RPL(A) flight test lesson not found; matrix link skipped.';
    RETURN;
  END IF;

  INSERT INTO public.syllabus_matrix_requirements (
    course_id,
    lesson_id,
    matrix_row_id,
    lesson_sequence_code,
    lesson_column_title,
    required_standard,
    assessment_criterion_id
  )
  SELECT
    source.course_id,
    target_lesson_id,
    source.matrix_row_id,
    'RPL(A)FT',
    'RPL Flight Test',
    source.required_standard,
    source.assessment_criterion_id
  FROM public.syllabus_matrix_requirements source
  WHERE source.course_id = target_course_id
    AND source.lesson_sequence_code = source_lesson_code
  ON CONFLICT (course_id, lesson_sequence_code, matrix_row_id) DO UPDATE SET
    lesson_id = EXCLUDED.lesson_id,
    lesson_column_title = EXCLUDED.lesson_column_title,
    required_standard = EXCLUDED.required_standard,
    assessment_criterion_id = EXCLUDED.assessment_criterion_id;
END $$;
