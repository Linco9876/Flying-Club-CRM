/*
  # Drop bookings payment_type CHECK constraint

  The bookings table has a CHECK constraint that restricts payment_type to
  ('prepaid', 'payg', 'account') — stale hardcoded values that no longer match
  the payment_methods table. Both the booking form and flight log form now use
  the shared payment_methods table, so this constraint must be removed to allow
  any payment method name to be stored.
*/

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_type_check;
