/*
  Let the organisation decide which endorsement names grant Pilot status.
*/

ALTER TABLE public.training_syllabus_settings
  ADD COLUMN IF NOT EXISTS pilot_status_endorsement_types text[] NOT NULL DEFAULT ARRAY[
    'Pilot Certificate',
    'Recreational Pilots Licence RPL (A)',
    'RPL(A) Aeroplane Category Rating'
  ]::text[];

UPDATE public.training_syllabus_settings
SET pilot_status_endorsement_types = ARRAY[
  'Pilot Certificate',
  'Recreational Pilots Licence RPL (A)',
  'RPL(A) Aeroplane Category Rating'
]::text[]
WHERE pilot_status_endorsement_types IS NULL
   OR cardinality(pilot_status_endorsement_types) = 0;

COMMENT ON COLUMN public.training_syllabus_settings.pilot_status_endorsement_types IS
  'Active endorsements with these exact names grant Pilot status to student accounts.';
