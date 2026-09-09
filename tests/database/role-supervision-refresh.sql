-- Run in a new disposable local database; no real accounts or bookings required.
\set ON_ERROR_STOP on
begin;
create schema private;
create table public.users(id uuid primary key, role text);
create table public.user_roles(user_id uuid, role text);
create table public.test_reconciliations(id integer generated always as identity);
create function private.assert_function_permission_manifest() returns void language plpgsql as $$ begin return; end $$;
create function public.reconcile_role_based_supervision_requirements() returns void language sql as $$
  insert into public.test_reconciliations default values
$$;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
\ir ../../supabase/migrations/20260909160000_scope_role_supervision_refresh.sql
do $$
declare v_id uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_count int;
begin
  -- Account-creation trigger and invite-user both write/delete student/pilot roles.
  insert into public.users values(v_id,'student');
  insert into public.user_roles values(v_id,'student');
  update public.users set role='student' where id=v_id;
  delete from public.user_roles where user_id=v_id and role='pilot';
  delete from public.user_roles where user_id=v_id;
  insert into public.user_roles values(v_id,'pilot');
  update public.users set role='pilot' where id=v_id;
  if exists(select 1 from public.test_reconciliations) then
    raise exception 'Student/pilot provisioning recalculated instructor supervision';
  end if;
  insert into public.user_roles values(v_id,'instructor');
  update public.user_roles set role='senior_instructor' where role='instructor';
  update public.user_roles set role='cfi' where role='senior_instructor';
  update public.user_roles set user_id=v_other where role='cfi';
  delete from public.user_roles where role='cfi';
  update public.users set role='instructor' where id=v_id;
  update public.users set role='admin' where id=v_id;
  select count(*) into v_count from public.test_reconciliations;
  if v_count <> 7 then raise exception 'Relevant role changes missed reconciliation: %',v_count; end if;
  update public.users set role=role;
  update public.user_roles set role=role;
  update public.users set role='instructor' where id=v_other;
  if (select count(*) from public.test_reconciliations) <> v_count then
    raise exception 'No-op role writes performed reconciliation';
  end if;
end $$;
rollback;
