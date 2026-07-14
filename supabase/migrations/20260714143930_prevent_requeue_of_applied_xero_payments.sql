CREATE OR REPLACE FUNCTION public.queue_xero_verified_payment_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  settings_row public.xero_sync_settings%ROWTYPE;
BEGIN
  SELECT * INTO settings_row
  FROM public.xero_sync_settings
  WHERE id = true;

  IF NEW.type = 'flight_charge'
     AND NEW.flight_log_id IS NOT NULL
     AND NEW.verified_status = 'verified'
     AND NEW.xero_payment_id IS NULL
     AND COALESCE(NEW.xero_sync_status, 'not_synced') <> 'synced'
     AND (TG_OP = 'INSERT' OR NEW.verified_status IS DISTINCT FROM OLD.verified_status)
     AND COALESCE(settings_row.auto_apply_verified_payments, false) IS TRUE
  THEN
    INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
    VALUES (
      'flight_payment',
      NEW.flight_log_id,
      'apply_payment',
      'pending',
      80,
      jsonb_build_object('reason', 'verified_payment', 'account_transaction_id', NEW.id)
    )
    ON CONFLICT (entity_type, entity_id, action, status)
    DO UPDATE SET
      payload = public.xero_sync_queue.payload || EXCLUDED.payload,
      updated_at = now(),
      next_attempt_at = now();

    NEW.xero_sync_status := 'queued';
    NEW.xero_sync_error := NULL;
  END IF;

  IF NEW.type = 'topup'
     AND NEW.verified_status = 'verified'
     AND (TG_OP = 'INSERT' OR NEW.verified_status IS DISTINCT FROM OLD.verified_status)
     AND COALESCE(settings_row.sync_account_topups, false) IS TRUE
  THEN
    INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
    VALUES (
      'account_transaction',
      NEW.id,
      'sync_transaction',
      'pending',
      75,
      jsonb_build_object('reason', 'verified_topup')
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
$function$;

REVOKE EXECUTE ON FUNCTION public.queue_xero_verified_payment_sync()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.queue_xero_verified_payment_sync()
TO service_role;

UPDATE public.account_transactions AS tx
SET
  xero_invoice_id = flight.xero_invoice_id,
  xero_payment_id = COALESCE(
    tx.xero_payment_id,
    CASE
      WHEN tx.description ILIKE 'Xero credit allocation%'
        THEN 'credit-allocation:' || flight.xero_invoice_id || ':' || tx.id::text
      ELSE flight.xero_payment_id
    END
  ),
  xero_synced_at = COALESCE(tx.xero_synced_at, flight.xero_payment_synced_at, now()),
  xero_sync_status = 'synced',
  xero_sync_error = NULL
FROM public.flight_logs AS flight
WHERE tx.flight_log_id = flight.id
  AND tx.type = 'flight_charge'
  AND tx.verified_status = 'verified'
  AND flight.payment_status = 'paid'
  AND flight.xero_invoice_id IS NOT NULL
  AND (
    tx.xero_sync_status <> 'synced'
    OR tx.xero_invoice_id IS NULL
    OR tx.xero_payment_id IS NULL
  );

DELETE FROM public.xero_sync_queue AS queue
USING public.flight_logs AS flight
WHERE queue.entity_id = flight.id
  AND queue.entity_type IN ('flight_invoice', 'flight_payment')
  AND queue.status IN ('pending', 'processing', 'failed', 'needs_review')
  AND flight.xero_invoice_id IS NOT NULL
  AND (
    queue.action = 'create_invoice'
    OR (
      queue.action = 'apply_payment'
      AND flight.payment_status = 'paid'
      AND NOT EXISTS (
        SELECT 1
        FROM public.account_transactions AS tx
        WHERE tx.flight_log_id = flight.id
          AND tx.type = 'flight_charge'
          AND tx.verified_status = 'verified'
          AND tx.xero_sync_status <> 'synced'
      )
    )
  );
