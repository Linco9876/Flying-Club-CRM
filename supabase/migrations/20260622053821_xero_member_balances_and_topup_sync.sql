-- Reconstructed from remote supabase_migrations.schema_migrations history.
-- This file preserves migration history so local Git and the linked database agree.

ALTER TABLE public.xero_sync_settings
  ADD COLUMN IF NOT EXISTS topup_receipt_account_code text;

ALTER TABLE public.account_transactions
  ADD COLUMN IF NOT EXISTS xero_bank_transaction_id text;

CREATE OR REPLACE FUNCTION public.queue_xero_verified_payment_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings_row public.xero_sync_settings%ROWTYPE;
BEGIN
  SELECT * INTO settings_row
  FROM public.xero_sync_settings
  WHERE id = true;

  IF NEW.type = 'flight_charge'
     AND NEW.flight_log_id IS NOT NULL
     AND NEW.verified_status = 'verified'
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
$$;

GRANT EXECUTE ON FUNCTION public.queue_xero_verified_payment_sync() TO service_role;
REVOKE EXECUTE ON FUNCTION public.queue_xero_verified_payment_sync() FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

