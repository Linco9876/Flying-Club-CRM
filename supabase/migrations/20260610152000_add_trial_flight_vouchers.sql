-- Trial instructional flight gift voucher foundation.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS portal_access_scope text NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_portal_access_scope_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_portal_access_scope_check
      CHECK (portal_access_scope IN ('full', 'trial_voucher'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trial_flight_voucher_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  aircraft_mode text NOT NULL DEFAULT 'tecnam'
    CHECK (aircraft_mode IN ('tecnam', 'archer', 'specific')),
  aircraft_ids uuid[] NOT NULL DEFAULT '{}',
  instructor_ids uuid[] NOT NULL DEFAULT '{}',
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  price numeric(12,2) NOT NULL DEFAULT 0,
  email_subject text NOT NULL DEFAULT 'Your Bendigo Flying Club trial flight voucher',
  email_body text NOT NULL DEFAULT '',
  booking_instructions text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trial_flight_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.trial_flight_voucher_products(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  purchaser_name text NOT NULL,
  purchaser_email text NOT NULL,
  purchaser_phone text,
  recipient_name text,
  recipient_email text,
  send_to_recipient boolean NOT NULL DEFAULT false,
  recipient_delivery_at timestamptz,
  delivered_at timestamptz,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('draft', 'issued', 'redeemed', 'booked', 'expired', 'cancelled')),
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  booked_booking_id uuid,
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS trial_flight_voucher_id uuid REFERENCES public.trial_flight_vouchers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trial_flight_voucher_products_active
  ON public.trial_flight_voucher_products(is_active);

CREATE INDEX IF NOT EXISTS idx_trial_flight_vouchers_code
  ON public.trial_flight_vouchers(code);

CREATE INDEX IF NOT EXISTS idx_trial_flight_vouchers_status
  ON public.trial_flight_vouchers(status);

CREATE INDEX IF NOT EXISTS idx_bookings_trial_flight_voucher_id
  ON public.bookings(trial_flight_voucher_id);

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

ALTER TABLE public.trial_flight_voucher_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_flight_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage trial flight voucher products" ON public.trial_flight_voucher_products;
CREATE POLICY "Admins manage trial flight voucher products"
  ON public.trial_flight_voucher_products
  FOR ALL
  TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

DROP POLICY IF EXISTS "Staff can read trial flight voucher products" ON public.trial_flight_voucher_products;
CREATE POLICY "Staff can read trial flight voucher products"
  ON public.trial_flight_voucher_products
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR public.current_user_has_staff_role()
  );

DROP POLICY IF EXISTS "Admins manage trial flight vouchers" ON public.trial_flight_vouchers;
CREATE POLICY "Admins manage trial flight vouchers"
  ON public.trial_flight_vouchers
  FOR ALL
  TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

DROP POLICY IF EXISTS "Redeemed voucher holders can read own voucher" ON public.trial_flight_vouchers;
CREATE POLICY "Redeemed voucher holders can read own voucher"
  ON public.trial_flight_vouchers
  FOR SELECT
  TO authenticated
  USING (redeemed_by_user_id = auth.uid());
