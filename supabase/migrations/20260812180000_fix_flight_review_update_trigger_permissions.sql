-- The candidate update guard calls private.can_manage_flight_reviews().
-- Security hardening correctly removed authenticated USAGE on the private
-- schema, but this SECURITY INVOKER trigger then blocked every authenticated
-- flight-review update before the row-level policy could complete.
--
-- Keep the private schema closed and run this trigger-only function as its
-- postgres owner with a fixed search path instead.

alter function public.protect_candidate_flight_review_update()
  security definer;

alter function public.protect_candidate_flight_review_update()
  set search_path = pg_catalog, public, private, pg_temp;

revoke all on function public.protect_candidate_flight_review_update()
  from public, anon, authenticated, service_role;

update private.function_permission_manifest
set security_definer = true,
    fixed_search_path = true,
    rationale = 'Trigger-only candidate update guard; runs as its owner so it can call protected private role helpers without exposing that schema to browser roles.',
    reviewed_at = current_date
where signature = 'public.protect_candidate_flight_review_update()';

do $migration$
begin
  if not exists (
    select 1
    from private.function_permission_manifest
    where signature = 'public.protect_candidate_flight_review_update()'
      and security_definer
      and fixed_search_path
  ) then
    raise exception 'Function permission manifest entry is missing or stale for protect_candidate_flight_review_update';
  end if;
end
$migration$;

select private.assert_function_permission_manifest();
