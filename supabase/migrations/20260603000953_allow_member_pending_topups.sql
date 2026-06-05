/*
  # Allow members to submit pending account top-ups

  Pilots and students can add funds from their billing page, but those funds
  remain pending until an admin/instructor verifies the transaction.
*/

ALTER TABLE account_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can submit own pending topups" ON account_transactions;

CREATE POLICY "Users can submit own pending topups"
  ON account_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND type = 'topup'
    AND amount > 0
    AND verified_status = 'pending'
    AND balance_after IS NULL
    AND flight_log_id IS NULL
  );
