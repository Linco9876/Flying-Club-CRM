/*
  # Revoke public EXECUTE on SECURITY DEFINER functions

  handle_aircraft_grounding() and handle_new_user() are trigger functions that
  should only be called by the database trigger system, not via the REST API.
  Revoke EXECUTE from anon and authenticated roles to prevent direct invocation.
*/

REVOKE EXECUTE ON FUNCTION public.handle_aircraft_grounding() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_aircraft_grounding() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
