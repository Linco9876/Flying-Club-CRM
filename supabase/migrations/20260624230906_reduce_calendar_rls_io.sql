-- Reduce repeated RLS helper IO on the busiest calendar queries.
-- Roles are synced into auth.users.raw_app_meta_data.roles by the CRM, so use
-- trusted JWT app_metadata first and only fall back to user_roles if the JWT is
-- missing older metadata.

CREATE OR REPLACE FUNCTION public.current_user_has_staff_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    ((SELECT auth.jwt()) -> 'app_metadata' -> 'roles') ?| ARRAY['admin','instructor','senior_instructor'],
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = ANY (ARRAY['admin','instructor','senior_instructor'])
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    ((SELECT auth.jwt()) -> 'app_metadata' -> 'roles') ? 'admin',
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = 'admin'
    ),
    false
  );
$$;

CREATE OR REPLACE VIEW public.calendar_booking_public
WITH (security_invoker = true)
AS
WITH viewer AS (
  SELECT
    (SELECT auth.uid()) AS uid,
    public.current_user_has_staff_role() AS is_staff,
    public.current_user_has_full_portal_access() AS has_full_access
)
SELECT
  b.id,
  b.student_id,
  b.instructor_id,
  b.aircraft_id,
  b.start_time,
  b.end_time,
  CASE
    WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.payment_type
    ELSE NULL::text
  END AS payment_type,
  CASE
    WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.notes
    ELSE NULL::text
  END AS notes,
  b.status,
  COALESCE(b.has_conflict, false) AS has_conflict,
  b.deleted_at,
  COALESCE(b.flight_logged, false) AS flight_logged,
  CASE
    WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.flight_type_id
    ELSE NULL::uuid
  END AS flight_type_id,
  CASE
    WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.trial_flight_voucher_id
    ELSE NULL::uuid
  END AS trial_flight_voucher_id,
  b.is_guest_booking,
  CASE
    WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.guest_name
    ELSE NULL::text
  END AS guest_name,
  CASE
    WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.guest_email
    ELSE NULL::text
  END AS guest_email,
  CASE
    WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.guest_phone
    ELSE NULL::text
  END AS guest_phone,
  COALESCE(b.guest_name, hirer.name) AS hirer_name,
  instructor.name AS instructor_name
FROM public.bookings b
CROSS JOIN viewer
LEFT JOIN public.users hirer ON hirer.id = b.student_id
LEFT JOIN public.users instructor ON instructor.id = b.instructor_id
WHERE viewer.has_full_access;

GRANT SELECT ON public.calendar_booking_public TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_has_staff_role() FROM anon;
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_staff_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
