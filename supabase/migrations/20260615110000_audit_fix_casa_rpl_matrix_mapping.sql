/*
  CASA RPL(A) matrix audit fixes.

  Findings from the source RPL(A) v1.2 DOCX lesson set:
  - RPL(A)14 Circuit Consolidation lists the same broad circuit/pre-solo
    assessment elements as RPL(A)10, but the imported CRM matrix only kept
    A6.1/A6.2 engine-failure rows.
  - Only the first lesson had assessment_criterion_id links, so most lesson
    matrix failures could not explain the broad pass/fail outcome shown in
    the training record form.
*/

WITH target_course AS (
  SELECT id
  FROM public.training_courses
  WHERE title = 'CASA RPL(A) v1.2'
  ORDER BY last_updated DESC
  LIMIT 1
),
target_lesson AS (
  SELECT lesson.id, lesson.course_id
  FROM public.training_lessons lesson
  JOIN target_course course ON course.id = lesson.course_id
  WHERE lesson.sequence_code = 'RPL(A)14'
  LIMIT 1
),
source_requirements AS (
  SELECT requirement.*
  FROM public.syllabus_matrix_requirements requirement
  JOIN target_course course ON course.id = requirement.course_id
  WHERE requirement.lesson_sequence_code = 'RPL(A)10'
)
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
  target_lesson.id,
  source.matrix_row_id,
  'RPL(A)14',
  'Circuit Consolidation',
  2,
  CASE
    WHEN row.unit_code LIKE 'NTS%' THEN 'casa-rpl-hf-nts'
    ELSE 'casa-rpl-performance-standard'
  END
FROM source_requirements source
JOIN target_lesson ON target_lesson.course_id = source.course_id
JOIN public.syllabus_matrix_rows row ON row.id = source.matrix_row_id
ON CONFLICT (course_id, lesson_sequence_code, matrix_row_id) DO UPDATE SET
  lesson_id = EXCLUDED.lesson_id,
  lesson_column_title = EXCLUDED.lesson_column_title,
  required_standard = EXCLUDED.required_standard,
  assessment_criterion_id = EXCLUDED.assessment_criterion_id;

UPDATE public.syllabus_matrix_requirements requirement
SET assessment_criterion_id = CASE
  WHEN row.unit_code LIKE 'NTS%' THEN 'casa-rpl-hf-nts'
  ELSE 'casa-rpl-performance-standard'
END
FROM public.syllabus_matrix_rows row
JOIN public.training_courses course ON course.id = row.course_id
WHERE requirement.matrix_row_id = row.id
  AND requirement.course_id = course.id
  AND course.title = 'CASA RPL(A) v1.2';
