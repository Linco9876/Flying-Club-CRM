-- Keep trial flight voucher accounts restricted to the voucher booking flow.
-- These accounts are stored as student records for booking compatibility, but
-- should not receive broad normal-member Data API access.

CREATE OR REPLACE FUNCTION public.current_user_has_full_portal_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND COALESCE(portal_access_scope, 'full') <> 'trial_voucher'
      AND COALESCE(is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_staff_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY['admin','instructor','senior_instructor'])
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_has_full_portal_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_staff_role() TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read aircraft" ON public.aircraft;
CREATE POLICY "Full portal users can read aircraft"
  ON public.aircraft
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Authenticated users can read bookings" ON public.bookings;
CREATE POLICY "Full portal users can read bookings and voucher holders read own"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_full_portal_access()
    OR (
      student_id = auth.uid()
      AND trial_flight_voucher_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Authenticated users can create bookings" ON public.bookings;
CREATE POLICY "Full portal users can create bookings"
  ON public.bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_has_full_portal_access());

DROP POLICY IF EXISTS "Admins and instructors can update any booking" ON public.bookings;
CREATE POLICY "Staff can update bookings and full students can update own"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  )
  WITH CHECK (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins and instructors can delete bookings" ON public.bookings;
CREATE POLICY "Staff can delete bookings and full students can delete own"
  ON public.bookings
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_has_staff_role()
    OR (
      public.current_user_has_full_portal_access()
      AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Authenticated users can read user_roles" ON public.user_roles;
CREATE POLICY "Users can read own roles and staff can read roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_has_staff_role()
    OR public.current_user_is_admin()
  );
