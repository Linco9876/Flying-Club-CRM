/*
  # Add transaction verification status

  Adds payment verification workflow to account_transactions.

  1. New Columns
    - `verified_status` (text) - 'pending' | 'verified' | 'rejected'
      - topup transactions default to 'pending' (need admin verification)
      - flight_charge/refund/adjustment default to 'verified' (auto-verified)
    - `rejection_notes` (text, nullable) - Admin notes when rejecting a payment

  2. Constraint
    - CHECK constraint ensures only valid status values are stored
*/

ALTER TABLE account_transactions
  ADD COLUMN IF NOT EXISTS verified_status text
    NOT NULL DEFAULT 'pending'
    CHECK (verified_status IN ('pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS rejection_notes text;

-- Auto-verify non-topup transactions (flight charges, refunds, adjustments)
UPDATE account_transactions
SET verified_status = 'verified'
WHERE type != 'topup';
