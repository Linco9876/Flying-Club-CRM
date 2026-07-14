-- These functions are internal trigger helpers. The API roles must not call them directly.

REVOKE EXECUTE ON FUNCTION public.sync_member_role_from_licences(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_licence_role_sync()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_aircraft_solo_hire_qualifications()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_staff_of_licence_submission()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_member_role_from_licences(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_licence_role_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_aircraft_solo_hire_qualifications() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_staff_of_licence_submission() TO service_role;
