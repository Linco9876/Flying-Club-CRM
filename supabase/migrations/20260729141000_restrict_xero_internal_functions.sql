-- Trigger helpers are internal database plumbing and must never be exposed as
-- callable PostgREST RPCs.
revoke all on function public.prevent_expected_xero_tenant_change() from public, anon, authenticated;
revoke all on function public.prevent_xero_tenant_rebind() from public, anon, authenticated;
revoke all on function public.audit_xero_connection_change() from public, anon, authenticated;
revoke all on function public.audit_xero_configuration_change() from public, anon, authenticated;
revoke all on function public.bind_xero_queue_tenant() from public, anon, authenticated;
revoke all on function public.bind_new_xero_reference_to_tenant() from public, anon, authenticated;
revoke all on function public.prevent_approved_xero_mapping_change() from public, anon, authenticated;

grant execute on function public.prevent_expected_xero_tenant_change() to service_role;
grant execute on function public.prevent_xero_tenant_rebind() to service_role;
grant execute on function public.audit_xero_connection_change() to service_role;
grant execute on function public.audit_xero_configuration_change() to service_role;
grant execute on function public.bind_xero_queue_tenant() to service_role;
grant execute on function public.bind_new_xero_reference_to_tenant() to service_role;
grant execute on function public.prevent_approved_xero_mapping_change() to service_role;
