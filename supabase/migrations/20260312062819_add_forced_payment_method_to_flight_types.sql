/*
  # Add Forced Payment Method to Flight Types

  ## Summary
  Adds a `forced_payment_method_id` column to the `flight_types` table, allowing
  administrators to configure a flight type so that a specific payment method is
  automatically required whenever that flight type is selected during booking.

  ## Changes
  ### Modified Tables
  - `flight_types`
    - Added `forced_payment_method_id` (uuid, nullable) — references `payment_methods(id)`.
      When set, the booking form must use this payment method for this flight type.
      When null, no payment method is forced.

  ## Notes
  - Column is nullable so existing flight types are unaffected.
  - Foreign key uses ON DELETE SET NULL so deleting a payment method clears the forced link safely.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'flight_types' AND column_name = 'forced_payment_method_id'
  ) THEN
    ALTER TABLE flight_types
      ADD COLUMN forced_payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL;
  END IF;
END $$;
