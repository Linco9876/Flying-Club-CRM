-- Queue Xero flight invoices automatically when billable flight logs are created.
-- Verified payments were already queued, but payments cannot sync until the
-- flight invoice exists. This keeps the invoice and payment queues paired.

CREATE OR REPLACE FUNCTION public.queue_xero_flight_invoice_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings_row public.xero_sync_settings%ROWTYPE;
  billable_amount numeric := 0;
BEGIN
  SELECT * INTO settings_row
  FROM public.xero_sync_settings
  WHERE id = true;

  billable_amount := COALESCE(NEW.calculated_cost, NEW.total_cost, 0);

  IF COALESCE(settings_row.sync_flight_charges, false) IS TRUE
     AND COALESCE(settings_row.auto_queue_flight_invoices, true) IS TRUE
     AND NEW.id IS NOT NULL
     AND billable_amount > 0
     AND NEW.payment_status <> 'free'
     AND NEW.xero_invoice_id IS NULL
  THEN
    INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
    VALUES (
      'flight_invoice',
      NEW.id,
      'create_invoice',
      'pending',
      70,
      jsonb_build_object('reason', 'billable_flight_log')
    )
    ON CONFLICT (entity_type, entity_id, action, status)
    DO UPDATE SET
      payload = public.xero_sync_queue.payload || EXCLUDED.payload,
      updated_at = now(),
      next_attempt_at = now();

    NEW.xero_sync_status := 'queued';
    NEW.xero_sync_error := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_xero_flight_invoice_sync ON public.flight_logs;
CREATE TRIGGER trg_queue_xero_flight_invoice_sync
BEFORE INSERT OR UPDATE OF calculated_cost, total_cost, payment_status, xero_invoice_id ON public.flight_logs
FOR EACH ROW
EXECUTE FUNCTION public.queue_xero_flight_invoice_sync();

GRANT EXECUTE ON FUNCTION public.queue_xero_flight_invoice_sync() TO service_role;
REVOKE EXECUTE ON FUNCTION public.queue_xero_flight_invoice_sync() FROM anon, authenticated;

-- Backfill invoice queue rows for paid/verified flight payments that were
-- already queued before this trigger existed.
INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
SELECT DISTINCT
  'flight_invoice',
  fl.id,
  'create_invoice',
  'pending',
  70,
  jsonb_build_object('reason', 'backfill_missing_invoice_for_queued_payment')
FROM public.flight_logs fl
JOIN public.xero_sync_queue payment_queue
  ON payment_queue.entity_type = 'flight_payment'
 AND payment_queue.entity_id = fl.id
WHERE payment_queue.status IN ('pending', 'failed', 'needs_review')
  AND fl.xero_invoice_id IS NULL
  AND COALESCE(fl.calculated_cost, fl.total_cost, 0) > 0
  AND fl.payment_status <> 'free'
ON CONFLICT (entity_type, entity_id, action, status)
DO UPDATE SET
  payload = public.xero_sync_queue.payload || EXCLUDED.payload,
  updated_at = now(),
  next_attempt_at = now();

NOTIFY pgrst, 'reload schema';
