-- The standard Archer trial-flight product may have been drafted inactive before
-- the PA-28 Archer was added to the fleet. Activate it automatically once a
-- serviceable Archer/PA-28 exists and instructors are already configured.

UPDATE public.trial_flight_voucher_products
SET is_active = true,
    updated_at = now()
WHERE aircraft_mode = 'archer'
  AND is_active = false
  AND COALESCE(array_length(instructor_ids, 1), 0) > 0
  AND EXISTS (
    SELECT 1
    FROM public.aircraft a
    WHERE a.status = 'serviceable'
      AND (
        lower(concat_ws(' ', a.registration, a.make, a.model)) LIKE '%archer%'
        OR regexp_replace(lower(concat_ws('', a.registration, a.make, a.model)), '[^a-z0-9]', '', 'g') LIKE '%pa28%'
        OR regexp_replace(lower(concat_ws('', a.registration, a.make, a.model)), '[^a-z0-9]', '', 'g') LIKE '%piperpa28%'
      )
  );
