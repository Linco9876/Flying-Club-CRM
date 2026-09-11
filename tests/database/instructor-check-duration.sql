-- Disposable PostgreSQL test of the actual completion trigger. No notifications or real records.
\set ON_ERROR_STOP on
begin;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
create function current_user_is_cfi() returns boolean language sql as $$select true$$;
create function private.assert_function_permission_manifest() returns void language plpgsql as $$begin return;end$$;
create table user_roles(user_id uuid,role text);
insert into user_roles values('00000000-0000-0000-0000-000000000002','instructor');
create table instructor_compliance_courses(id uuid primary key,check_type text);
insert into instructor_compliance_courses values('10000000-0000-0000-0000-000000000001','sp_check'),('10000000-0000-0000-0000-000000000002','renewal');
create table instructor_compliance_course_items(id uuid,course_id uuid,required boolean,applicable_levels text[],applicable_check_types text[]);
create table instructor_compliance_records(
 id uuid primary key default gen_random_uuid(),course_id uuid,
 examiner_cfi_id uuid default '00000000-0000-0000-0000-000000000001',candidate_instructor_id uuid default '00000000-0000-0000-0000-000000000002',
 check_type text,instructor_level text,updated_at timestamptz,status text default 'completed',check_date date default current_date,
 medical_sighted boolean default true,emergency_control_plan_confirmed boolean default true,briefing_lesson text default 'Fixture briefing',
 checklist jsonb default '[]',outcome text,development_plan text,flight_minutes integer check(flight_minutes>=0),
 logbook_entries_confirmed boolean default true,raaus_form_path text default 'fixture/renewal.pdf',authority_submission_confirmed boolean default true,
 completed_at timestamptz,next_sp_check_due date,next_renewal_due date,voided_at timestamptz);
\ir ../../supabase/migrations/20260911010000_remove_sp_check_flight_minimum.sql
create trigger prepare before insert or update on instructor_compliance_records for each row execute function prepare_instructor_compliance_record();
do $$
declare r instructor_compliance_records;
begin
 insert into instructor_compliance_records(course_id,check_type,flight_minutes) values('10000000-0000-0000-0000-000000000001','sp_check',30) returning * into r;
 assert r.status='completed' and r.outcome='satisfactory','A short S&P must complete successfully';
 assert r.next_sp_check_due=current_date+90,'Short S&P must retain normal currency';
 assert r.next_renewal_due is null,'S&P must not renew instructor rating';
 update instructor_compliance_records set flight_minutes=15 where id=r.id;
 begin
  insert into instructor_compliance_records(course_id,check_type,flight_minutes) values('10000000-0000-0000-0000-000000000002','renewal',59);
  raise exception 'Short renewal was accepted';
 exception when others then assert sqlerrm like '%at least 60 minutes%',sqlerrm;end;
 insert into instructor_compliance_records(course_id,check_type,flight_minutes) values('10000000-0000-0000-0000-000000000002','renewal',60) returning * into r;
 assert r.status='completed' and r.outcome='satisfactory','60-minute renewal must complete';
 assert r.next_renewal_due=(current_date+interval '2 years')::date,'Renewal currency must remain unchanged';
 begin
  update instructor_compliance_records set flight_minutes=59 where id=r.id;
  raise exception 'Renewal edited below minimum';
 exception when others then assert sqlerrm like '%at least 60 minutes%',sqlerrm;end;
 insert into instructor_compliance_records(course_id,check_type,flight_minutes,checklist,development_plan) values('10000000-0000-0000-0000-000000000001','sp_check',20,'[{"result":"unsatisfactory"}]','Remedial training') returning * into r;
 assert r.status='remedial_required' and r.outcome='unsatisfactory','Short S&P must retain remedial outcome';
 begin
  insert into instructor_compliance_records(course_id,check_type,flight_minutes,logbook_entries_confirmed) values('10000000-0000-0000-0000-000000000001','sp_check',30,false);
  raise exception 'Logbook confirmation bypassed';
 exception when others then assert sqlerrm like 'Confirm the result%',sqlerrm;end;
end $$;
rollback;
