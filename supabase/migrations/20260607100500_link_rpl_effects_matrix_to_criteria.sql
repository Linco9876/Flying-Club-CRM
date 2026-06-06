/*
  Link the initial RPL(A) Effects of Controls lesson matrix rows to the broad
  assessment criteria used by the course. This lets a missed matrix standard
  explain the broader pass/fail result recorded for the lesson.
*/

WITH target_lesson AS (
  SELECT lesson.id, lesson.course_id, lesson.sequence_code
  FROM public.training_lessons lesson
  JOIN public.training_courses course ON course.id = lesson.course_id
  WHERE course.title = 'CASA RPL(A) v1.2'
    AND lesson.name ILIKE 'Effects of Controls'
  LIMIT 1
),
linked_rows AS (
  SELECT
    row.id,
    CASE
      WHEN row.code LIKE 'NTS%' THEN 'casa-rpl-hf-nts'
      ELSE 'casa-rpl-performance-standard'
    END AS criterion_id
  FROM public.syllabus_matrix_rows row
  JOIN target_lesson lesson ON lesson.course_id = row.course_id
  WHERE
    (row.element_code = 'C2.1' AND row.description ILIKE '%complete all required pre-flight administration documentation%')
    OR (row.element_code = 'C2.2' AND row.description ILIKE '%complete an internal and external check of the aircraft%')
    OR (row.element_code = 'C2.2' AND row.description ILIKE '%locking and securing devices%')
    OR (row.element_code = 'C2.3' AND row.description ILIKE '%shut down aircraft%')
    OR (row.element_code = 'C2.3' AND row.description ILIKE '%post-flight inspection and secure%')
    OR (row.element_code = 'C2.3' AND row.description ILIKE '%post-flight administration documentation%')
    OR (row.element_code = 'NTS1.1' AND row.description ILIKE '%traffic separation using a systematic visual scan%')
    OR (row.element_code = 'A1.1' AND row.description ILIKE '%perform engine start and after start actions%')
)
UPDATE public.syllabus_matrix_requirements requirement
SET assessment_criterion_id = linked_rows.criterion_id
FROM linked_rows, target_lesson lesson
WHERE requirement.course_id = lesson.course_id
  AND (requirement.lesson_id = lesson.id OR requirement.lesson_sequence_code = lesson.sequence_code)
  AND requirement.matrix_row_id = linked_rows.id;
