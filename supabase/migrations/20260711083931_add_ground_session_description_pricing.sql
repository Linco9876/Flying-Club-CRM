ALTER TABLE public.ground_session_description_options
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'flight_type_hourly',
  ADD COLUMN IF NOT EXISTS fixed_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flight_type_id uuid REFERENCES public.flight_types(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ground_session_description_options_pricing_mode_check'
  ) THEN
    ALTER TABLE public.ground_session_description_options
      ADD CONSTRAINT ground_session_description_options_pricing_mode_check
      CHECK (pricing_mode IN ('fixed', 'flight_type_hourly'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ground_session_description_options_flight_type
  ON public.ground_session_description_options(flight_type_id)
  WHERE flight_type_id IS NOT NULL;

COMMENT ON COLUMN public.ground_session_description_options.pricing_mode IS
  'fixed charges fixed_rate once; flight_type_hourly charges the linked/selected flight type ground hourly rate in 15 minute increments.';

COMMENT ON COLUMN public.ground_session_description_options.fixed_rate IS
  'Fixed total charge used when pricing_mode is fixed.';

COMMENT ON COLUMN public.ground_session_description_options.flight_type_id IS
  'Optional flight type whose ground_session_hourly_rate is used when pricing_mode is flight_type_hourly.';

NOTIFY pgrst, 'reload schema';
