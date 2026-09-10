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
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated","aal":"aal2"}',true);
do $$
declare r member_medicals; count_before integer;
begin
 assert (select count(*)=4 from member_medicals),'Every legacy medical must be imported';
 assert (select count(*)=4 from member_medical_audit),'Every import must be audited';
 assert (select count(*)=4 from member_medicals where verified_at is null and verified_by is null and issued_on is null),'No dates or verification invented';
 assert (select legacy_snapshot->>'medical_type' is null and expires_on='2027-01-01' from member_medicals where user_id='00000000-0000-0000-0000-000000000003'),'Expiry-only evidence preserved';
 assert (private.assess_medical_records('00000000-0000-0000-0000-000000000002','2026-09-10','raaus_pilot')->>'eligible')::boolean;
 assert not (private.assess_medical_records('00000000-0000-0000-0000-000000000002','2026-09-10','raaus_instructor')->>'eligible')::boolean;
 assert not (private.assess_medical_records('00000000-0000-0000-0000-000000000002','2075-01-01','raaus_pilot')->>'eligible')::boolean,'Age threshold must apply on birthday';
 r:=save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000001","type_id":"raaus-medical-declaration","issued_on":"2026-09-01","review_due_on":"2028-09-01","status":"verified"}');
 assert (private.assess_medical_records(r.user_id,'2026-09-10','raaus_pilot')->>'eligible')::boolean,'Valid RAAus must survive expired CASA';
 assert not (private.assess_medical_records(r.user_id,'2026-09-10','casa_private')->>'eligible')::boolean,'RAAus cannot clear CASA';
 assert not (private.assess_medical_records(r.user_id,'2028-09-02','raaus_pilot')->>'eligible')::boolean,'Declaration review date must apply';
 r:=save_member_medical(to_jsonb(r)||'{"status":"suspended","restrictions":"Medical review required"}');
 assert not (private.assess_medical_records(r.user_id,'2026-09-10','raaus_pilot')->>'eligible')::boolean,'A hold cannot be bypassed';
 begin perform save_member_medical(to_jsonb(r)||'{"updated_at":"2000-01-01T00:00:00Z","status":"verified"}');raise exception 'Stale edit accepted';exception when others then if sqlerrm='Stale edit accepted' then raise;end if;end;
 select count(*) into count_before from member_medicals;
 update students set medical_expiry=medical_expiry where id='00000000-0000-0000-0000-000000000001';
 assert (select count(*)=count_before from member_medicals),'Unrelated profile saves must not duplicate imports';
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
 assert (select count(*)=1 from member_medicals),'Member may read only their own evidence';
 begin perform save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000002","type_id":"casa-class-2","issued_on":"2026-01-01","expires_on":"2027-01-01","status":"verified"}');raise exception 'Self verification accepted';exception when others then if sqlerrm='Self verification accepted' then raise;end if;end;
 begin perform save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000001","type_id":"casa-class-2","status":"pending"}');raise exception 'Other owner write accepted';exception when others then if sqlerrm='Other owner write accepted' then raise;end if;end;
 perform save_member_medical('{"user_id":"00000000-0000-0000-0000-000000000002","type_id":"casa-class-2","issued_on":"2026-01-01","expires_on":"2027-01-01","status":"pending","accepted_operations":["casa_class1"]}');
 assert not (assess_member_medicals('00000000-0000-0000-0000-000000000002','2026-09-10','casa_class1')->>'eligible')::boolean,'Pending evidence cannot clear access';
end $$;
reset role;

-- Booking assessments run in the database, including private aircraft and future dates.
insert into aircraft values('10000000-0000-0000-0000-000000000001','24-1234'),('10000000-0000-0000-0000-000000000002','VH-ABC');
insert into safety_compliance_settings values(true);
do $$
declare b bookings;
begin
 insert into bookings(student_id,aircraft_id,start_time,end_time,status,booking_kind) values('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','flight') returning * into b;
 assert b.medical_operation='raaus_pilot';
 assert (public.check_booking_medicals(b.id,false)->'pilot'->>'eligible')::boolean,'Preflight check must use current evidence';
 assert (public.check_booking_medicals(b.id,true)->'pilot'->>'eligible')::boolean,'Current-time recheck must be supported';
 assert (b.medical_eligibility_snapshot->'pilot'->>'eligible')::boolean;
 begin
   insert into bookings(student_id,aircraft_id,start_time,end_time,status,booking_kind) values('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','flight');
   raise exception 'RAAus incorrectly cleared VH';
 exception when others then assert sqlerrm like 'Pilot medical:%',sqlerrm;end;
 begin
   insert into bookings(student_id,instructor_id,aircraft_id,start_time,end_time,status,booking_kind,is_guest_booking) values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','flight',true);
   raise exception 'Pilot declaration incorrectly cleared instruction';
 exception when others then assert sqlerrm like 'Instructor medical:%',sqlerrm;end;
 begin
   insert into bookings(student_id,aircraft_id,start_time,end_time,status,booking_kind) values('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','2074-12-31 23:00+11','2075-01-01 01:00+11','confirmed','flight');
   raise exception 'Medical expired mid-flight accepted';
 exception when others then assert sqlerrm like 'Pilot medical:%',sqlerrm;end;
 update safety_compliance_settings set auto_block_expired_medical=false;
 insert into bookings(student_id,aircraft_id,start_time,end_time,status,booking_kind) values('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','flight') returning * into b;
 assert not (b.medical_eligibility_snapshot->'pilot'->>'eligible')::boolean,'Warning mode must still record the failed assessment';
 -- An old profile client must not grant accepted medicals or remove accepted evidence.
 update students set medical_type='CASA Class 2',medical_expiry='2030-01-01' where id='00000000-0000-0000-0000-000000000002';
 assert not (private.assess_medical_records('00000000-0000-0000-0000-000000000002','2026-09-10','casa_private')->>'eligible')::boolean;
 assert (select count(*)=1 from member_medicals where user_id='00000000-0000-0000-0000-000000000002' and status='legacy');
end $$;
rollback;
