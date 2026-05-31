/*
  # Harden billing and rates settings

  Ensures Billing & Rates can safely draft/deactivate flight types and payment
  methods without deleting historical references, and makes rate lookups stable.
*/

ALTER TABLE flight_types
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS allowed_roles text[] DEFAULT ARRAY['student', 'pilot', 'instructor', 'admin'],
  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forced_payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL;

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;

ALTER TABLE aircraft_rates
  ADD COLUMN IF NOT EXISTS flight_type_id uuid REFERENCES flight_types(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS charge_type text NOT NULL DEFAULT 'not_used',
  ADD COLUMN IF NOT EXISTS solo_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dual_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flat_surcharge numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekend_surcharge numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS included_taxes numeric DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_aircraft_rates_aircraft_flight_type_unique
  ON aircraft_rates(aircraft_id, flight_type_id)
  WHERE flight_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flight_types_active_order
  ON flight_types(active, display_order);

CREATE INDEX IF NOT EXISTS idx_payment_methods_active_order
  ON payment_methods(active, display_order);

CREATE INDEX IF NOT EXISTS idx_flight_logs_billing_status
  ON flight_logs(payment_status, payment_type, student_id);

UPDATE flight_types SET active = true WHERE active IS NULL;
UPDATE payment_methods SET active = true WHERE active IS NULL;
