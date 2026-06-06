DO $$
DECLARE
  target_course_id uuid;
  row_count integer;
  requirement_count integer;
BEGIN
  SELECT id INTO target_course_id
  FROM public.training_courses
  WHERE title = 'CASA RPL(A) v1.2'
  ORDER BY last_updated DESC
  LIMIT 1;

  IF target_course_id IS NULL THEN
    RAISE EXCEPTION 'CASA RPL(A) v1.2 course not found';
  END IF;

  SELECT count(*) INTO row_count
  FROM public.syllabus_matrix_rows
  WHERE course_id = target_course_id;

  SELECT count(*) INTO requirement_count
  FROM public.syllabus_matrix_requirements
  WHERE course_id = target_course_id;

  IF row_count <> 446 OR requirement_count <> 1762 THEN
    RAISE EXCEPTION 'CASA matrix import count mismatch: rows %, requirements %', row_count, requirement_count;
  END IF;
END $$;
