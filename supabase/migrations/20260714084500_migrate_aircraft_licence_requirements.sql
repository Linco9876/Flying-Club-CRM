-- Move licence-like aircraft hire requirements out of endorsements.
-- Endorsements record additional privileges; verified licences control Pilot status
-- and base solo-hire eligibility.

WITH legacy AS (
  SELECT
    id,
    lower(trim(coalesce(required_endorsement_type, ''))) = 'pilot certificate'
      OR EXISTS (
        SELECT 1 FROM unnest(required_endorsement_types || required_endorsement_all_types) value
        WHERE lower(trim(value)) = 'pilot certificate'
      ) AS needs_raaus_licence,
    lower(trim(coalesce(required_endorsement_type, ''))) IN (
        'recreational pilots licence rpl (a)',
        'rpl(a) aeroplane category rating'
      ) OR EXISTS (
        SELECT 1 FROM unnest(required_endorsement_types || required_endorsement_all_types) value
        WHERE lower(trim(value)) IN (
          'recreational pilots licence rpl (a)',
          'rpl(a) aeroplane category rating'
        )
      ) AS needs_casa_licence
  FROM public.aircraft
)
UPDATE public.aircraft aircraft
SET
  required_licence_types = ARRAY(
    SELECT DISTINCT value
    FROM unnest(
      aircraft.required_licence_types
      || CASE WHEN legacy.needs_raaus_licence
          AND NOT ('RAAus Pilot Certificate' = ANY(aircraft.required_licence_all_types))
        THEN ARRAY['RAAus Pilot Certificate']::text[] ELSE '{}'::text[] END
      || CASE WHEN legacy.needs_casa_licence THEN ARRAY[
          'CASA Recreational Pilot Licence (RPL)',
          'CASA Private Pilot Licence (PPL)',
          'CASA Commercial Pilot Licence (CPL)',
          'CASA Air Transport Pilot Licence (ATPL)'
        ]::text[] ELSE '{}'::text[] END
    ) value
  ),
  required_endorsement_type = CASE
    WHEN lower(trim(coalesce(aircraft.required_endorsement_type, ''))) IN (
      'pilot certificate',
      'recreational pilots licence rpl (a)',
      'rpl(a) aeroplane category rating'
    ) THEN NULL
    ELSE aircraft.required_endorsement_type
  END,
  required_endorsement_types = ARRAY(
    SELECT value FROM unnest(aircraft.required_endorsement_types) value
    WHERE lower(trim(value)) NOT IN (
      'pilot certificate',
      'recreational pilots licence rpl (a)',
      'rpl(a) aeroplane category rating'
    )
  ),
  required_endorsement_all_types = ARRAY(
    SELECT value FROM unnest(aircraft.required_endorsement_all_types) value
    WHERE lower(trim(value)) NOT IN (
      'pilot certificate',
      'recreational pilots licence rpl (a)',
      'rpl(a) aeroplane category rating'
    )
  ),
  updated_at = now()
FROM legacy
WHERE aircraft.id = legacy.id
  AND (legacy.needs_raaus_licence OR legacy.needs_casa_licence);

COMMENT ON COLUMN public.aircraft.required_endorsement_type IS
  'Deprecated single endorsement requirement retained for compatibility. Use the endorsement arrays for additional privileges and licence arrays for pilot licences.';
