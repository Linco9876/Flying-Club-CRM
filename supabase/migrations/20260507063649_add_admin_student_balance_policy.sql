/*
  # Allow admins to update student records

  Adds INSERT and UPDATE policies on the students table so that admins
  can write prepaid_balance (and other fields) on behalf of any student.
  Previously only the student themselves could update their own record,
  which silently blocked the verifyTransaction balance upsert.

  Also backfills prepaid_balance from verified account_transactions so
  existing verified top-ups are reflected correctly.
*/

-- Admin can insert any student record
CREATE POLICY "Admins can insert student records"
  ON students FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

-- Admin can update any student record
CREATE POLICY "Admins can update student records"
  ON students FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

-- Backfill prepaid_balance from verified transactions
INSERT INTO students (id, prepaid_balance)
SELECT
  user_id,
  SUM(CASE WHEN type IN ('topup','refund') THEN amount::numeric ELSE -amount::numeric END) AS balance
FROM account_transactions
WHERE verified_status = 'verified'
GROUP BY user_id
ON CONFLICT (id) DO UPDATE
  SET prepaid_balance = EXCLUDED.prepaid_balance;
