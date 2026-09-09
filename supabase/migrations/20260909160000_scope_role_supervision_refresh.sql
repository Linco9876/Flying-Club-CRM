-- Student provisioning must not refresh the entire instructor booking calendar.
-- Only changes to roles used by instructor_requires_role_supervision need reconciliation.
create or replace function public.refresh_role_based_supervision_requirements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roles text[] := array['instructor', 'senior_instructor', 'cfi'];
begin
  if tg_table_name = 'users' then
    if old.role is not distinct from new.role then return null; end if;
    if not (coalesce(old.role = any(v_roles), false) or coalesce(new.role = any(v_roles), false)) then
      return null;
    end if;
  elsif tg_table_name = 'user_roles' then
    if tg_op = 'INSERT' then
      if not coalesce(new.role = any(v_roles), false) then return null; end if;
    elsif tg_op = 'DELETE' then
      if not coalesce(old.role = any(v_roles), false) then return null; end if;
    else
      if old.user_id is not distinct from new.user_id and old.role is not distinct from new.role then
        return null;
      end if;
      if not (coalesce(old.role = any(v_roles), false) or coalesce(new.role = any(v_roles), false)) then
        return null;
      end if;
    end if;
  else
    raise exception 'Unexpected source for role supervision refresh';
  end if;
  perform public.reconcile_role_based_supervision_requirements();
  return null;
end;
$$;

drop trigger if exists refresh_role_supervision_after_user_roles on public.user_roles;
create trigger refresh_role_supervision_after_user_roles
after insert or update or delete on public.user_roles
for each row execute function public.refresh_role_based_supervision_requirements();

drop trigger if exists refresh_role_supervision_after_primary_role on public.users;
create trigger refresh_role_supervision_after_primary_role
after update of role on public.users
for each row execute function public.refresh_role_based_supervision_requirements();

revoke all on function public.refresh_role_based_supervision_requirements()
from public, anon, authenticated, service_role;
select private.assert_function_permission_manifest();
