ALTER TABLE public.flight_types
  ADD COLUMN IF NOT EXISTS xero_item_code text;

CREATE INDEX IF NOT EXISTS idx_flight_types_xero_item_code
  ON public.flight_types(upper(xero_item_code))
  WHERE xero_item_code IS NOT NULL AND btrim(xero_item_code) <> '';

COMMENT ON COLUMN public.flight_types.xero_item_code IS
  'Xero sales item code used on invoices for this booking or flight type.';

NOTIFY pgrst, 'reload schema';
