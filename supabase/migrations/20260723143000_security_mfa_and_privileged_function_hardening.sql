-- Require a verified second factor for direct staff access to high-impact settings.
-- Members remain unaffected, and service-role automations continue to bypass RLS.
create or replace function public.current_user_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'senior_instructor', 'instructor')
  );
$$;

revoke all on function public.current_user_is_staff() from public;
grant execute on function public.current_user_is_staff() to authenticated, service_role;

create or replace function public.staff_session_has_required_assurance()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    not public.current_user_is_staff()
    or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke all on function public.staff_session_has_required_assurance() from public;
grant execute on function public.staff_session_has_required_assurance() to authenticated, service_role;

-- Make the existing admin helper the single database-level MFA boundary. This
-- protects every older RLS policy and SECURITY DEFINER function that already
-- relies on current_user_is_admin(), without prompting again during an AAL2
-- session. Service-role automations remain unaffected.
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    auth.role() = 'service_role'
    or (
      coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      and exists (
        select 1
        from public.user_roles
        where user_id = auth.uid()
          and role = 'admin'
      )
    );
$$;

revoke all on function public.current_user_is_admin() from public;
grant execute on function public.current_user_is_admin() to authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_roles',
    'organisation_settings',
    'booking_rules_settings',
    'membership_settings',
    'membership_classes',
    'senior_instructor_authorisations',
    'xero_connection_settings',
    'xero_sync_settings',
    'stripe_connect_settings'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format(
        'drop policy if exists require_staff_aal2 on public.%I',
        table_name
      );
      execute format(
        'create policy require_staff_aal2 on public.%I as restrictive for all to authenticated '
        || 'using (public.staff_session_has_required_assurance()) '
        || 'with check (public.staff_session_has_required_assurance())',
        table_name
      );
    end if;
  end loop;
end
$$;

-- Trigger helpers do not need to be callable by a browser. They continue to run
-- normally from their owning triggers under SECURITY DEFINER.
revoke all on function public.sync_member_flight_review_from_endorsements(uuid) from public, anon, authenticated;
grant execute on function public.sync_member_flight_review_from_endorsements(uuid) to service_role;

revoke all on function public.sync_member_role_from_endorsements(uuid) from public, anon, authenticated;
grant execute on function public.sync_member_role_from_endorsements(uuid) to service_role;

create or replace function public.rename_aircraft_endorsement_requirement(old_value text, new_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not exists (
       select 1
       from public.user_roles
       where user_id = auth.uid()
         and role = 'admin'
     )
     or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
  then
    raise exception 'Administrator MFA verification is required';
  end if;

  if nullif(trim(old_value), '') is null or nullif(trim(new_value), '') is null then
    raise exception 'Both endorsement names are required';
  end if;

  update public.aircraft
  set required_endorsement_types = (
        select coalesce(
          array_agg(case when item = old_value then new_value else item end),
          '{}'
        )
        from unnest(required_endorsement_types) as item
      ),
      required_endorsement_type = case
        when required_endorsement_type = old_value then new_value
        else required_endorsement_type
      end
  where old_value = any(required_endorsement_types)
     or required_endorsement_type = old_value;
end;
$$;

revoke all on function public.rename_aircraft_endorsement_requirement(text, text) from public, anon;
grant execute on function public.rename_aircraft_endorsement_requirement(text, text) to authenticated, service_role;
