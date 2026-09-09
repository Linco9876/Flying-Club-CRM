-- Run only in a new disposable local PostgreSQL database.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('test.user_id', true), '')::uuid
$$;
create function auth.role() returns text language sql as $$
  select current_setting('test.role', true)
$$;
create function public.current_user_has_staff_role() returns boolean language sql as $$
  select coalesce(nullif(current_setting('test.staff', true), ''), 'false')::boolean
$$;
create function private.assert_function_permission_manifest() returns void language plpgsql as $$ begin return; end $$;
create function public.training_record_audit_entry(text,jsonb) returns jsonb language sql as $$
  select jsonb_build_object('action', $1, 'changes', $2, 'timestamp', now())
$$;
create table public.training_records(
  id integer primary key, student_id uuid, student_ack boolean default false,
  student_ack_name text, student_ack_timestamp timestamptz, student_comments text,
  status text default 'submitted', audit_log jsonb default '[]', instructor_comments text
);
\ir ../../supabase/migrations/20260909130000_fix_service_training_record_updates.sql
create trigger guard_and_audit_training_record_update before update on public.training_records
for each row execute function public.guard_and_audit_training_record_update();
insert into public.training_records(id,student_id,student_ack) values
  (1, '10000000-0000-4000-8000-000000000001', true),
  (2, '10000000-0000-4000-8000-000000000001', false);
do $$
declare v_audit jsonb;
begin
  -- Exact failing operation: a service request has no user ID and moves history.
  perform set_config('test.role', 'service_role', true);
  perform set_config('test.user_id', '', true);
  update public.training_records set student_id = '20000000-0000-4000-8000-000000000002';
  if exists(select 1 from public.training_records where student_id <> '20000000-0000-4000-8000-000000000002') then
    raise exception 'Service history transfer failed';
  end if;
  select audit_log into v_audit from public.training_records where id = 1;
  if v_audit->0->>'action' <> 'record_revised_after_student_acknowledgement'
    or not (v_audit->0->'changes'->'changedFields' ? 'student_id') then
    raise exception 'Service transfer lost revision auditing';
  end if;
  perform set_config('test.role', 'authenticated', true);
  perform set_config('test.user_id', '20000000-0000-4000-8000-000000000002', true);
  begin
    update public.training_records set student_id = '10000000-0000-4000-8000-000000000001' where id = 2;
    raise exception 'Student could reassign a training record';
  exception when insufficient_privilege then null;
  end;
  update public.training_records set student_comments = 'Acknowledged', student_ack = true where id = 2;
  if (select audit_log->0->>'action' from public.training_records where id = 2) <> 'student_acknowledged_record' then
    raise exception 'Student acknowledgement lost its audit';
  end if;
  perform set_config('test.user_id', '', true);
  begin
    update public.training_records set student_comments = 'Unauthenticated change' where id = 2;
    raise exception 'Missing user identity was allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.user_id', '30000000-0000-4000-8000-000000000003', true);
  begin
    update public.training_records set student_comments = 'Other student change' where id = 2;
    raise exception 'Unrelated student was allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.staff', 'true', true);
  update public.training_records set instructor_comments = 'Staff correction' where id = 1;
end $$;
rollback;
