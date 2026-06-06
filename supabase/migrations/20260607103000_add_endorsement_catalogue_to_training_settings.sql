/*
  Store the organisation endorsement catalogue in Training / Syllabus settings.
*/

ALTER TABLE public.training_syllabus_settings
  ADD COLUMN IF NOT EXISTS endorsement_types text[] NOT NULL DEFAULT ARRAY[
    'Pilot Certificate',
    'Recreational Pilots Licence RPL (A)',
    'RPL(A) Aeroplane Category Rating',
    'Passenger Carrying',
    'Flight Radio',
    'Cross Country',
    'Low Level',
    'Formation',
    'Tailwheel'
  ]::text[];

UPDATE public.training_syllabus_settings
SET endorsement_types = (
  SELECT ARRAY(
    SELECT DISTINCT value
    FROM unnest(
      endorsement_types
      || COALESCE(pilot_status_endorsement_types, ARRAY[]::text[])
      || ARRAY[
        'Pilot Certificate',
        'Recreational Pilots Licence RPL (A)',
        'RPL(A) Aeroplane Category Rating',
        'Passenger Carrying',
        'Flight Radio',
        'Cross Country',
        'Low Level',
        'Formation',
        'Tailwheel'
      ]::text[]
    ) AS value
    WHERE btrim(value) <> ''
    ORDER BY value
  )
)
WHERE endorsement_types IS NULL
   OR cardinality(endorsement_types) = 0;

UPDATE public.training_syllabus_settings
SET endorsement_types = (
  SELECT ARRAY(
    SELECT DISTINCT value
    FROM unnest(endorsement_types || COALESCE(pilot_status_endorsement_types, ARRAY[]::text[])) AS value
    WHERE btrim(value) <> ''
    ORDER BY value
  )
);

UPDATE public.training_syllabus_settings
SET endorsement_types = (
  SELECT ARRAY(
    SELECT DISTINCT value
    FROM unnest(
      endorsement_types
      || COALESCE((
        SELECT array_agg(completion_endorsement_type)
        FROM public.training_courses
        WHERE completion_endorsement_type IS NOT NULL
          AND btrim(completion_endorsement_type) <> ''
      ), ARRAY[]::text[])
    ) AS value
    WHERE btrim(value) <> ''
    ORDER BY value
  )
);

COMMENT ON COLUMN public.training_syllabus_settings.endorsement_types IS
  'Organisation-managed list of endorsement names available to courses and member profiles.';
