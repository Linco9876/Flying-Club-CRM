/*
  # Billing: add balance_after to account_transactions + RLS

  1. Changes
    - Add `balance_after` column to `account_transactions` so each row records the
      running balance after the transaction
    - Enable RLS on `account_transactions` (may already be enabled — safe to re-apply)
    - Add policies: admins/instructors can read all; pilots can read their own
    - Add admin insert/update policy for top-ups and corrections
    - Add index on user_id + created_at for efficient per-user queries

  2. Notes
    - `balance_after` is nullable so existing rows are not broken
    - The `type` column stores 'credit' (top-up) or 'debit' (flight charge)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'account_transactions' AND column_name = 'balance_after'
  ) THEN
    ALTER TABLE account_transactions ADD COLUMN balance_after numeric;
  END IF;
END $$;

ALTER TABLE account_transactions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating
DROP POLICY IF EXISTS "Admins and instructors can view all transactions" ON account_transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON account_transactions;
DROP POLICY IF EXISTS "Admins can insert transactions" ON account_transactions;
DROP POLICY IF EXISTS "Admins can update transactions" ON account_transactions;

CREATE POLICY "Admins and instructors can view all transactions"
  ON account_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Users can view own transactions"
  ON account_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can insert transactions"
  ON account_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Admins can update transactions"
  ON account_transactions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'instructor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'instructor')
    )
  );

CREATE INDEX IF NOT EXISTS idx_account_transactions_user_created
  ON account_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_flight_logs_payment_status
  ON flight_logs(payment_status, student_id);
