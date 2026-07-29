-- These functions are trigger/internal assignment helpers. Portal users update
-- roster tables through RLS and do not need to invoke the helpers directly.

revoke all on function public.validate_supervisor_roster_locations()
  from public, anon, authenticated;
revoke all on function public.supervisor_roster_locations_for_slot(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function public.validate_supervisor_roster_locations()
  to service_role;
grant execute on function public.supervisor_roster_locations_for_slot(uuid, timestamptz, timestamptz)
  to service_role;
