-- Harden Xero queueing for payments and historical flight invoices.
--
-- The queue function for verified account transactions existed, but the
-- committed schema did not create the account_transactions trigger. Also,
-- older billable flight logs that pre-date automatic invoice queueing can sit
-- as not_synced with no invoice queue row. These statements are idempotent.

DROP TRIGGER IF EXISTS trg_queue_xero_verified_payment_sync ON public.account_transactions;
CREATE TRIGGER trg_queue_xero_verified_payment_sync
BEFORE INSERT OR UPDATE OF verified_status
ON public.account_transactions
FOR EACH ROW
EXECUTE FUNCTION public.queue_xero_verified_payment_sync();

-- Queue every billable flight log that still has no Xero invoice. Existing
-- pending/synced queue rows are preserved by the unique partial indexes.
INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
SELECT
  'flight_invoice',
  fl.id,
  'create_invoice',
  'pending',
  70,
  jsonb_build_object('reason', 'backfill_missing_billable_flight_invoice')
FROM public.flight_logs fl
CROSS JOIN public.xero_sync_settings settings
WHERE settings.id = true
  AND COALESCE(settings.sync_flight_charges, false) IS TRUE
  AND COALESCE(settings.auto_queue_flight_invoices, true) IS TRUE
  AND fl.xero_invoice_id IS NULL
  AND COALESCE(fl.calculated_cost, fl.total_cost, 0) > 0
  AND COALESCE(fl.payment_status, 'pending') <> 'free'
  AND NOT EXISTS (
    SELECT 1
    FROM public.xero_sync_queue existing
    WHERE existing.entity_type = 'flight_invoice'
      AND existing.entity_id = fl.id
      AND existing.action = 'create_invoice'
      AND existing.status IN ('pending', 'processing', 'synced', 'needs_review')
  )
ON CONFLICT (entity_type, entity_id, action, status)
DO UPDATE SET
  payload = public.xero_sync_queue.payload || EXCLUDED.payload,
  updated_at = now(),
  next_attempt_at = now();

UPDATE public.flight_logs fl
SET xero_sync_status = 'queued',
    xero_sync_error = NULL,
    updated_at = now()
WHERE fl.xero_invoice_id IS NULL
  AND COALESCE(fl.calculated_cost, fl.total_cost, 0) > 0
  AND COALESCE(fl.payment_status, 'pending') <> 'free'
  AND EXISTS (
    SELECT 1
    FROM public.xero_sync_queue q
    WHERE q.entity_type = 'flight_invoice'
      AND q.entity_id = fl.id
      AND q.action = 'create_invoice'
      AND q.status = 'pending'
  );

-- Queue verified payments/top-ups that were inserted before the trigger existed.
INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
SELECT
  'flight_payment',
  tx.flight_log_id,
  'apply_payment',
  'pending',
  80,
  jsonb_build_object('reason', 'backfill_verified_payment', 'account_transaction_id', tx.id)
FROM public.account_transactions tx
CROSS JOIN public.xero_sync_settings settings
WHERE settings.id = true
  AND COALESCE(settings.auto_apply_verified_payments, false) IS TRUE
  AND tx.type = 'flight_charge'
  AND tx.flight_log_id IS NOT NULL
  AND tx.verified_status = 'verified'
  AND tx.xero_payment_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.xero_sync_queue existing
    WHERE existing.entity_type = 'flight_payment'
      AND existing.entity_id = tx.flight_log_id
      AND existing.action = 'apply_payment'
      AND existing.status IN ('pending', 'processing', 'synced', 'needs_review')
  )
ON CONFLICT (entity_type, entity_id, action, status)
DO UPDATE SET
  payload = public.xero_sync_queue.payload || EXCLUDED.payload,
  updated_at = now(),
  next_attempt_at = now();

INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
SELECT
  'account_transaction',
  tx.id,
  'sync_transaction',
  'pending',
  75,
  jsonb_build_object('reason', 'backfill_verified_topup')
FROM public.account_transactions tx
CROSS JOIN public.xero_sync_settings settings
WHERE settings.id = true
  AND COALESCE(settings.sync_account_topups, false) IS TRUE
  AND tx.type = 'topup'
  AND tx.verified_status = 'verified'
  AND tx.xero_bank_transaction_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.xero_sync_queue existing
    WHERE existing.entity_type = 'account_transaction'
      AND existing.entity_id = tx.id
      AND existing.action = 'sync_transaction'
      AND existing.status IN ('pending', 'processing', 'synced', 'needs_review')
  )
ON CONFLICT (entity_type, entity_id, action, status)
DO UPDATE SET
  payload = public.xero_sync_queue.payload || EXCLUDED.payload,
  updated_at = now(),
  next_attempt_at = now();

NOTIFY pgrst, 'reload schema';
