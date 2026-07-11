-- Harden booking creation RLS.
-- Staff can create normal bookings for members, admins can create guest/casual
-- bookings, and members can only create their own non-guest booking requests.

DROP POLICY IF EXISTS "Full portal users can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Authenticated users can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can create own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins and instructors can create bookings" ON public.bookings;

CREATE POLICY "Members and staff can create permitted bookings"
  ON public.bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      COALESCE(is_guest_booking, false) = false
      AND public.current_user_has_full_portal_access()
      AND student_id = (SELECT auth.uid())
    )
    OR (
      COALESCE(is_guest_booking, false) = false
      AND public.current_user_has_staff_role()
    )
    OR (
      COALESCE(is_guest_booking, false) = true
      AND public.current_user_is_admin()
    )
  );
