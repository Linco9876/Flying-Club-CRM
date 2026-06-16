UPDATE public.flight_types
SET
  description = 'Trial flight or voucher-funded flight. No member payment is collected when the flight is logged.',
  active = true,
  allowed_roles = ARRAY['student', 'pilot', 'instructor', 'admin'],
  updated_at = now()
WHERE lower(name) IN ('gift voucher', 'gift certificate');

INSERT INTO public.flight_types (
  name,
  description,
  active,
  allowed_roles,
  display_order
)
SELECT
  'Gift voucher',
  'Trial flight or voucher-funded flight. No member payment is collected when the flight is logged.',
  true,
  ARRAY['student', 'pilot', 'instructor', 'admin'],
  98
WHERE NOT EXISTS (
  SELECT 1
  FROM public.flight_types
  WHERE lower(name) IN ('gift voucher', 'gift certificate')
);
