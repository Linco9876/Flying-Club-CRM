ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_portal_access_scope_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_portal_access_scope_check
  CHECK (portal_access_scope IN ('full', 'trial_voucher', 'guest_placeholder'));

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_guest_booking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS guest_email text,
  ADD COLUMN IF NOT EXISTS guest_phone text;

CREATE INDEX IF NOT EXISTS idx_bookings_is_guest_booking ON public.bookings(is_guest_booking);

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
      AND COALESCE(portal_access_scope, 'full') = 'full'
      AND COALESCE(is_active, true) = true
  );
$$;

DROP VIEW IF EXISTS public.calendar_booking_public;

CREATE VIEW public.calendar_booking_public AS
SELECT
  b.id,
  b.student_id,
  b.instructor_id,
  b.aircraft_id,
  b.start_time,
  b.end_time,
  CASE
    WHEN public.current_user_has_staff_role() OR b.student_id = auth.uid() THEN b.payment_type
    ELSE NULL::text
  END AS payment_type,
  CASE
    WHEN public.current_user_has_staff_role() OR b.student_id = auth.uid() THEN b.notes
    ELSE NULL::text
  END AS notes,
  b.status,
  COALESCE(b.has_conflict, false) AS has_conflict,
  b.deleted_at,
  COALESCE(b.flight_logged, false) AS flight_logged,
  CASE
    WHEN public.current_user_has_staff_role() OR b.student_id = auth.uid() THEN b.flight_type_id
    ELSE NULL::uuid
  END AS flight_type_id,
  CASE
    WHEN public.current_user_has_staff_role() OR b.student_id = auth.uid() THEN b.trial_flight_voucher_id
    ELSE NULL::uuid
  END AS trial_flight_voucher_id,
  b.is_guest_booking,
  CASE
    WHEN public.current_user_has_staff_role() OR b.student_id = auth.uid() THEN b.guest_name
    ELSE NULL::text
  END AS guest_name,
  CASE
    WHEN public.current_user_has_staff_role() OR b.student_id = auth.uid() THEN b.guest_email
    ELSE NULL::text
  END AS guest_email,
  CASE
    WHEN public.current_user_has_staff_role() OR b.student_id = auth.uid() THEN b.guest_phone
    ELSE NULL::text
  END AS guest_phone,
  COALESCE(b.guest_name, hirer.name) AS hirer_name,
  instructor.name AS instructor_name
FROM public.bookings b
LEFT JOIN public.users hirer ON hirer.id = b.student_id
LEFT JOIN public.users instructor ON instructor.id = b.instructor_id
WHERE public.current_user_has_full_portal_access();

GRANT SELECT ON public.calendar_booking_public TO authenticated;

NOTIFY pgrst, 'reload schema';
