-- Avoid exposing trial-voucher helper functions to anonymous callers.

REVOKE EXECUTE ON FUNCTION public.current_user_has_full_portal_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_has_full_portal_access() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_user_has_staff_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_has_staff_role() FROM anon;

GRANT EXECUTE ON FUNCTION public.current_user_has_full_portal_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_staff_role() TO authenticated;
