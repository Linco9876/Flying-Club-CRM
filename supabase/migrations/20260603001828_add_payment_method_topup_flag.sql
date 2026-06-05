ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS allow_account_topup boolean NOT NULL DEFAULT true;

UPDATE payment_methods
SET allow_account_topup = false,
    updated_at = now()
WHERE lower(name) IN ('pilot account', 'pilot accounts', 'prepaid account', 'student account');

CREATE INDEX IF NOT EXISTS idx_payment_methods_topup_order
  ON payment_methods(active, allow_account_topup, display_order);
