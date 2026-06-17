/*
  Fix CASA RPL(A) v1.2 matrix drift found by auditing the CRM data against
  the source RPL(A) v1.2 DOCX planning matrix and lesson documents.

  The lesson requirement links already match the audited source set:
  - 1,762 requirements from 00_RPL(A) Planning Matrix.DOCX
  - plus RPL(A)14 expanded from RPL(A)10 because the RPL(A)14 lesson DOCX
    contains the same broad circuit consolidation block as RPL(A)10.

  This migration repairs wording drift only.
*/

WITH target_course AS (
  SELECT id
  FROM public.training_courses
  WHERE title = 'CASA RPL(A) v1.2'
  ORDER BY last_updated DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1
),
updates(code, description) AS (
  VALUES
    (
      'A3.6.004',
      'establish and maintain crosswind leg tracking 90° to the runway'
    ),
    (
      'A3.6.006',
      'establish base leg tracking 90° to the runway at a specified distance from the runway threshold'
    ),
    (
      'A5.4.004',
      'sideslipping turn by adjusting the bank angle to turn through minimum heading change of 90° at constant airspeed using sideslip, and exiting the turn on a specified heading or geographical feature, within tolerance'
    ),
    (
      'C2.3.001',
      'shut down aircraft'
    )
)
UPDATE public.syllabus_matrix_rows row
SET description = updates.description
FROM updates
JOIN target_course course ON true
WHERE row.course_id = course.id
  AND row.code = updates.code;
