/*
  # Revoke PUBLIC EXECUTE on trigger-only SECURITY DEFINER functions

  The previous migration revoked from anon/authenticated by name, but the grant
  was on the PUBLIC pseudo-role which covers all roles. This migration revokes
  from PUBLIC directly, which closes the gap for both anon and authenticated.

  handle_aircraft_grounding() and handle_new_user() are trigger functions —
  they must never be callable directly via the REST API.
*/

REVOKE EXECUTE ON FUNCTION public.handle_aircraft_grounding() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
