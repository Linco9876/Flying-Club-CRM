-- Make regulatory membership wording unambiguous now that the club also has
-- its own separate membership concept.

UPDATE public.instructor_compliance_course_items AS item
SET title = 'Confirm RAAus membership, instructor rating and approval are current',
    guidance = 'Sight current RAAus membership and rating details before the check.'
FROM public.instructor_compliance_courses AS course
WHERE item.course_id = course.id
  AND course.name = 'RAAus Instructor Standards & Proficiency / Renewal'
  AND item.code = 'ADM-01';

UPDATE public.training_courses
SET review_configuration = replace(
  review_configuration::text,
  'Sight current membership and member number.',
  'Sight current RAAus membership and RAAus member number.'
)::jsonb
WHERE review_configuration::text LIKE '%Sight current membership and member number.%';

UPDATE public.training_courses
SET review_configuration = replace(
  review_configuration::text,
  'Record the applicant membership number and expiry in the notes.',
  'Record the applicant RAAus membership number and expiry in the notes.'
)::jsonb
WHERE review_configuration::text LIKE '%Record the applicant membership number and expiry in the notes.%';

UPDATE public.training_courses
SET review_configuration = replace(
  review_configuration::text,
  'Record the examiner membership number and authority.',
  'Record the examiner RAAus membership number and authority.'
)::jsonb
WHERE review_configuration::text LIKE '%Record the examiner membership number and authority.%';

UPDATE public.training_courses
SET review_configuration = replace(
  review_configuration::text,
  'Use the ARN, member number or examiner authorisation where applicable.',
  'Use the ARN, RAAus member number or examiner authorisation where applicable.'
)::jsonb
WHERE review_configuration::text LIKE '%Use the ARN, member number or examiner authorisation where applicable.%';

UPDATE public.safety_compliance_settings
SET settings = jsonb_set(
  settings,
  '{safety_login_warning_message}',
  to_jsonb(
    replace(
      settings->>'safety_login_warning_message',
      'medical, membership, BFR',
      'medical, RAAus membership, BFR'
    )
  )
)
WHERE settings->>'safety_login_warning_message' LIKE '%medical, membership, BFR%';

COMMENT ON COLUMN public.students.licence_expiry IS
  'RAAus membership expiry date; this is separate from flying club membership.';
