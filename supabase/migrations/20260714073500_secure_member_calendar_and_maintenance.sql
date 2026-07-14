-- Members need calendar occupancy without access to another member's private booking data.
-- This owner-evaluated view deliberately exposes a narrow, masked projection and still
-- requires a signed-in full-portal member through current_user_has_full_portal_access().
CREATE OR REPLACE VIEW public.calendar_booking_public
WITH (security_invoker = false, security_barrier = true)
AS
WITH viewer AS (
  SELECT
    auth.uid() AS uid,
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
  CASE WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.payment_type ELSE NULL END AS payment_type,
  CASE WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.notes ELSE NULL END AS notes,
  b.status,
  COALESCE(b.has_conflict, false) AS has_conflict,
  b.deleted_at,
  COALESCE(b.flight_logged, false) AS flight_logged,
  CASE WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.flight_type_id ELSE NULL END AS flight_type_id,
  CASE WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.trial_flight_voucher_id ELSE NULL END AS trial_flight_voucher_id,
  b.is_guest_booking,
  CASE WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.guest_name ELSE NULL END AS guest_name,
  CASE WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.guest_email ELSE NULL END AS guest_email,
  CASE WHEN viewer.is_staff OR b.student_id = viewer.uid THEN b.guest_phone ELSE NULL END AS guest_phone,
  CASE
    WHEN viewer.is_staff OR b.student_id = viewer.uid THEN COALESCE(b.guest_name, hirer.name)
    ELSE NULL
  END AS hirer_name,
  instructor.name AS instructor_name
FROM public.bookings b
CROSS JOIN viewer
LEFT JOIN public.users hirer ON hirer.id = b.student_id
LEFT JOIN public.users instructor ON instructor.id = b.instructor_id
WHERE viewer.has_full_access;

REVOKE ALL ON public.calendar_booking_public FROM anon;
GRANT SELECT ON public.calendar_booking_public TO authenticated;
GRANT ALL ON public.calendar_booking_public TO service_role;

-- Students and pilots can see defects and serviceability, but not future maintenance plans.
DROP POLICY IF EXISTS "Full portal users can view maintenance milestones" ON public.maintenance_milestones;
CREATE POLICY "Staff can view maintenance milestones"
ON public.maintenance_milestones
FOR SELECT
TO authenticated
USING (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Full portal users can read maintenance completions" ON public.maintenance_completions;
CREATE POLICY "Staff can read maintenance completions"
ON public.maintenance_completions
FOR SELECT
TO authenticated
USING (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Full portal users can read maintenance milestone templates" ON public.maintenance_milestone_templates;
CREATE POLICY "Staff can read maintenance milestone templates"
ON public.maintenance_milestone_templates
FOR SELECT
TO authenticated
USING (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Full portal users can read maintenance settings" ON public.maintenance_settings;
CREATE POLICY "Staff can read maintenance settings"
ON public.maintenance_settings
FOR SELECT
TO authenticated
USING (public.current_user_has_staff_role());
