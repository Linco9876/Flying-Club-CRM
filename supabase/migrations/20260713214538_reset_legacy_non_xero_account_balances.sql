/*
  Reset legacy CRM-only account balances now that Xero is the accounting source
  of truth.

  This intentionally keeps Xero/Stripe-linked ledger rows for reconciliation, but
  neutralises rows that only existed in the pre-Xero CRM balance system.
*/

UPDATE public.account_transactions
SET
  verified_status = 'rejected',
  balance_after = NULL,
  xero_sync_status = 'not_synced',
  xero_sync_error = NULL,
  rejection_notes = concat_ws(
    E'\n',
    NULLIF(rejection_notes, ''),
    'Legacy CRM-only balance reset after Xero became the accounting source of truth.'
  )
WHERE COALESCE(xero_payment_id, '') = ''
  AND COALESCE(xero_bank_transaction_id, '') = ''
  AND COALESCE(xero_sync_status, '') NOT IN ('synced', 'matched')
  AND COALESCE(is_test_mode, false) IS FALSE
  AND COALESCE(rejection_notes, '') NOT ILIKE '%Legacy CRM-only balance reset after Xero became the accounting source of truth.%';

UPDATE public.students
SET
  prepaid_balance = 0,
  updated_at = now()
WHERE COALESCE(prepaid_balance, 0) <> 0;

COMMENT ON COLUMN public.students.prepaid_balance IS
  'Deprecated legacy CRM prepaid balance. Xero credit/overpayments are the source of truth for account balance.';

NOTIFY pgrst, 'reload schema';
