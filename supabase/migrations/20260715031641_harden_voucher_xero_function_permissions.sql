-- These helpers are called only by trusted Edge Functions or database triggers.
-- Keeping EXECUTE away from browser roles prevents quota exhaustion and forged
-- accounting queue activity while preserving service-role processing.
revoke all on function public.claim_xero_api_slot(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_xero_api_slot(integer, integer, integer) to service_role;

revoke all on function public.note_xero_rate_limit(integer) from public, anon, authenticated;
grant execute on function public.note_xero_rate_limit(integer) to service_role;

revoke all on function public.queue_xero_voucher_sync_from_flight_log() from public, anon, authenticated;
grant execute on function public.queue_xero_voucher_sync_from_flight_log() to service_role;

revoke all on function public.queue_xero_voucher_sync_from_voucher() from public, anon, authenticated;
grant execute on function public.queue_xero_voucher_sync_from_voucher() to service_role;
