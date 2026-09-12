-- Disposable PostgreSQL integration test; no real members or provider calls.
\set ON_ERROR_STOP on
begin;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
create table users(id uuid primary key,role text,date_of_birth date,name text);
create table students(id uuid primary key references users(id),medical_type text,medical_expiry date,date_of_birth date);
create table user_roles(user_id uuid,role text);
create table student_documents(id uuid primary key,student_id uuid);
create table training_syllabus_settings(medical_types jsonb);
create table training_courses(id uuid primary key,medical_requirement_mode text,medical_requirement_age integer);
create table student_course_enrolments(student_id uuid,course_id uuid,status text);
create table aircraft(id uuid primary key,registration text);
create table organisation_settings(timezone text);
create table safety_compliance_settings(auto_block_expired_medical boolean);
create table bookings(id uuid primary key default gen_random_uuid(),student_id uuid,instructor_id uuid,aircraft_id uuid,start_time timestamptz,end_time timestamptz,private_aircraft_registration text,status text,deleted_at timestamptz,is_guest_booking boolean,booking_kind text,payment_type text,notes text,has_conflict boolean,flight_logged boolean,flight_type_id uuid,trial_flight_voucher_id uuid,guest_name text,guest_email text,guest_phone text,recurrence_series_id uuid,recurrence_occurrence_index integer,recurrence_occurrence_count integer,recurrence_notifications_finalised_at timestamptz,private_aircraft_type text);
create function current_user_has_staff_role() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from users where id=auth.uid() and role='admin')$$;
create function current_user_has_full_portal_access() returns boolean language sql stable as $$select auth.uid() is not null$$;
create table private.function_permission_manifest(signature text,function_name text,classification text,allowed_roles text[],security_definer boolean,fixed_search_path boolean,rationale text,reviewed_at date);
create function private.assert_function_permission_manifest() returns void language plpgsql as $$begin return;end$$;
grant usage on schema public,auth to authenticated;
grant select on users,students,student_documents to authenticated;
insert into users values('00000000-0000-0000-0000-000000000001','pilot','2000-01-01','Fixture'),('00000000-0000-0000-0000-000000000002','pilot','2000-01-01','Fixture'),('00000000-0000-0000-0000-000000000003','student','2000-01-01','Fixture'),('00000000-0000-0000-0000-000000000004','pilot','2000-01-01','Fixture'),('00000000-0000-0000-0000-000000000009','admin','1980-01-01','Staff');
insert into training_syllabus_settings values('[{"id":"casa-class-2","name":"CASA Class 2","validityMode":"expiry_date","isActive":true},{"id":"raaus-medical-declaration","name":"RAAus Medical Declaration","validityMode":"until_age","validUntilAge":75,"isActive":true},{"id":"custom","name":"Custom medical","validityMode":"until_age","validUntilAge":70,"acceptedOperations":["raaus_pilot"],"isActive":true}]');
insert into students values('00000000-0000-0000-0000-000000000001','CASA Class 2','2025-01-01','2000-01-01'),('00000000-0000-0000-0000-000000000002','RAAus Medical Declaration',null,'2000-01-01'),('00000000-0000-0000-0000-000000000003',null,'2027-01-01','2000-01-01'),('00000000-0000-0000-0000-000000000004','Custom medical',null,'2000-01-01');
\ir ../../supabase/migrations/20260910100000_member_medical_records.sql

alter table training_syllabus_settings add column licence_medical_requirements jsonb default '{"raaus pilot certificate":{"required":true,"acceptedMedicalTypeIds":["raaus-medical-declaration"],"instructorMedicalTypeIds":[]}}';
insert into users values('00000000-0000-0000-0000-000000000005','pilot','1950-01-01','Older fixture');
insert into student_documents values('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000005'),('00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000001');
insert into member_medicals(user_id,type_id,medical_type,review_due_on,status,accepted_operations) values('00000000-0000-0000-0000-000000000002','casa-class-2','CASA Class 2','2030-01-01','pending',array['casa_private']);
\ir ../../supabase/migrations/20260912030000_self_service_medicals.sql

do $$begin
 assert not exists(select 1 from member_medicals where status='pending'),'Existing pending records no longer need approval';
 assert exists(select 1 from member_medical_audit where action='self_service_medical_migration' and before_record->>'status'='pending' and after_record->>'status'='active'),'Status migration is audited';
 assert exists(select 1 from member_medicals where status='active' and expires_on='2030-01-01' and review_due_on='2030-01-01'),'Existing review date becomes the sole expiry without losing historical data';
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$declare r member_medicals;begin
 r:=save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000002","type_id":"raaus-medical-declaration"}');
 assert r.status='active' and r.expires_on='2075-01-01' and r.document_id is null and r.issued_on is null and r.review_due_on is null,'Under-age owner needs only the medical type';
 assert r.verified_at is null and r.verified_by is null,'Self-service must not invent approval';
 assert (assess_member_medicals(r.user_id,'2026-09-12','raaus_pilot')->>'eligible')::boolean,'Saved medical is usable immediately';
 r:=save_member_medical(to_jsonb(r)||'{"restrictions":"Updated by owner"}');
 assert r.restrictions='Updated by owner','Owner can edit an active medical';
 begin perform save_member_medical(to_jsonb(r)||'{"updated_at":"2000-01-01"}');raise exception 'TEST stale write accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
 begin perform save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000001","type_id":"casa-class-2","expires_on":"2030-01-01"}');raise exception 'TEST other-owner write accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
 r:=save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000002","type_id":"casa-class-2","expires_on":"2030-01-01","status":"pending","issued_on":"2040-01-01","review_due_on":"2020-01-01"}');
 assert r.status='active' and r.issued_on is null and r.review_due_on is null,'Old clients cannot reintroduce approval or extra dates';
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$declare r member_medicals;begin
 begin perform save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000005","type_id":"raaus-medical-declaration","expires_on":"2030-01-01"}');raise exception 'TEST older medical without evidence accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
 begin perform save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000005","type_id":"raaus-medical-declaration","document_id":"00000000-0000-0000-0000-000000000015"}');raise exception 'TEST older medical without expiry accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
 begin perform save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000005","type_id":"raaus-medical-declaration","expires_on":"2030-01-01","document_id":"00000000-0000-0000-0000-000000000016"}');raise exception 'TEST foreign evidence accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
 r:=save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000005","type_id":"raaus-medical-declaration","expires_on":"2030-01-01","document_id":"00000000-0000-0000-0000-000000000015"}');
 assert r.status='active' and r.expires_on='2030-01-01','Older medical is usable without approval';
 assert (assess_member_medicals(r.user_id,'2030-01-01','raaus_pilot')->>'eligible')::boolean,'Expiry is inclusive';
 assert not (assess_member_medicals(r.user_id,'2030-01-02','raaus_pilot')->>'eligible')::boolean,'Expired evidence cannot grant validity';
end $$;
reset role;
do $$declare r member_medicals;begin
 assert (private.assess_licence_medical('00000000-0000-0000-0000-000000000005','RAAus Pilot Certificate','2026-09-12','2026-09-12')->>'eligible')::boolean,'Older evidence supports the licence';
 select * into r from member_medicals where user_id='00000000-0000-0000-0000-000000000005';
 r.document_id:=null;
 assert private.medical_effective_expiry(r,'1952-02-29','2027-02-28')='2027-03-01','Leap birthday remains valid through February';
 assert private.medical_effective_expiry(r,'1952-02-29','2027-03-01') is null,'Evidence needed on the leap-adjusted birthday';
 assert private.medical_effective_expiry(r,null,'2027-03-01') is null,'Missing DOB cannot bypass age rules';
end $$;
rollback;
\echo Self-service medical assertions passed
