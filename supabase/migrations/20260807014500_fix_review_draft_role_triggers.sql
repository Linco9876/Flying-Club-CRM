-- These trigger functions call helpers in the protected private schema.
-- They must execute as their postgres owner; otherwise an authenticated staff
-- insert reaches the trigger and fails before the reviewer-role check can run.

alter function private.validate_review_template_crm_roles()
  security definer;

alter function private.validate_review_template_crm_roles()
  set search_path = pg_catalog, public, private, pg_temp;

alter function private.validate_flight_review_reviewer_role()
  security definer;

alter function private.validate_flight_review_reviewer_role()
  set search_path = pg_catalog, public, private, pg_temp;

-- These are trigger-only functions. Keep direct application access closed;
-- SECURITY DEFINER changes the trigger execution context, not who may call the
-- functions through the API.
revoke all on function private.validate_review_template_crm_roles()
  from public, anon, authenticated;
revoke all on function private.validate_flight_review_reviewer_role()
  from public, anon, authenticated;

grant execute on function private.validate_review_template_crm_roles()
  to service_role;
grant execute on function private.validate_flight_review_reviewer_role()
  to service_role;
