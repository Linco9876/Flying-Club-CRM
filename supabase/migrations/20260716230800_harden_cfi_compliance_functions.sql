-- Supabase may retain explicit role grants even after PUBLIC is revoked.
-- Trigger functions are never intended to be callable over the API.
REVOKE ALL ON FUNCTION public.current_user_is_cfi() FROM anon;

REVOKE ALL ON FUNCTION public.prepare_instructor_compliance_record() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_instructor_compliance_record() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_instructor_compliance_result() FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_user_is_cfi() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_instructor_compliance_record() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_instructor_compliance_record() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_instructor_compliance_result() TO service_role;
