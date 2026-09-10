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

alter table aircraft add column required_licence_types text[] not null default '{}', add column required_licence_all_types text[] not null default '{}';
alter table training_courses add column completion_licence_type text;
create table licences(id uuid primary key default gen_random_uuid(),student_id uuid,type text,is_active boolean default true,verification_status text default 'verified',date_obtained date,expiry_date date);
\ir ../../supabase/migrations/20260910120000_licence_medical_requirements.sql
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated","aal":"aal2"}',true);
insert into licences(student_id,type) values
('00000000-0000-0000-0000-000000000002','RAAus Pilot Certificate'),
('00000000-0000-0000-0000-000000000002','CASA Private Pilot Licence (PPL)'),
('00000000-0000-0000-0000-000000000001','RAAus Pilot Certificate');
insert into aircraft(id,registration,required_licence_all_types) values('10000000-0000-0000-0000-000000000001','24-1234',array['RAAus Pilot Certificate']);
insert into aircraft(id,registration,required_licence_types) values('10000000-0000-0000-0000-000000000002','VH-ABC',array['CASA Private Pilot Licence (PPL)','CASA Commercial Pilot Licence (CPL)']);
insert into aircraft(id,registration) values('00000000-0000-4000-8000-000000000001','Private aircraft');
do $$
declare u uuid:='00000000-0000-0000-0000-000000000002'; a uuid:='10000000-0000-0000-0000-000000000001'; b bookings; r member_medicals;
begin
 assert (select count(*)=4 from member_medicals),'Migration preserves existing evidence';
 assert (select count(*)=4 from member_medical_audit),'No medical history rewritten';
 assert (private.assess_aircraft_licences(u,a,'2026-09-10','2026-09-10')->>'eligible')::boolean,'RAAus valid';
 assert not (private.assess_aircraft_licences(u,'10000000-0000-0000-0000-000000000002','2026-09-10','2026-09-10')->>'eligible')::boolean,'RAAus medical cannot clear PPL';
 assert not (private.assess_aircraft_licences(u,a,'2026-09-10','2026-09-10',true)->>'eligible')::boolean,'Pilot declaration cannot clear instruction';
 assert not (private.assess_aircraft_licences(u,a,'2074-12-31','2075-01-01')->>'eligible')::boolean,'Age boundary applies during flight';
 update licences set verification_status='pending' where student_id=u and type='RAAus Pilot Certificate';
 assert not (private.assess_aircraft_licences(u,a,'2026-09-10','2026-09-10')->>'eligible')::boolean,'Pending licence cannot clear access';
 update licences set verification_status='verified',expiry_date='2026-09-10' where student_id=u and type='RAAus Pilot Certificate';
 assert not (private.assess_aircraft_licences(u,a,'2026-09-10','2026-09-11')->>'eligible')::boolean,'Licence must remain current through end';
 update licences set expiry_date=null where student_id=u;
 insert into bookings(student_id,aircraft_id,start_time,end_time,status,booking_kind,medical_operation) values(u,a,now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','flight','casa_class1') returning * into b;
 assert b.medical_operation is null,'Obsolete framework ignored';
 assert (public.check_booking_medicals(b.id,false)->'pilot'->>'eligible')::boolean,'Recheck uses licence requirements';
 begin
   update bookings set aircraft_id='10000000-0000-0000-0000-000000000002' where id=b.id;
   raise exception 'Aircraft licence medical mismatch accepted';
 exception when others then assert sqlerrm like 'Pilot licence/medical:%',sqlerrm;end;
 r:=save_member_medical(jsonb_build_object('user_id',u,'type_id','casa-class-2','issued_on','2026-01-01','expires_on','2035-01-01','status','verified'));
 assert (private.assess_aircraft_licences(u,'10000000-0000-0000-0000-000000000002','2026-09-10','2026-09-10')->>'eligible')::boolean,'Any accepted licence with its medical suffices';
 update aircraft set required_licence_all_types=array['RAAus Pilot Certificate','CASA Commercial Pilot Licence (CPL)'] where id=a;
 assert not (private.assess_aircraft_licences(u,a,'2026-09-10','2026-09-10')->>'eligible')::boolean,'All licences really required';
 update aircraft set required_licence_all_types=array['RAAus Pilot Certificate'] where id=a;
 insert into bookings(student_id,instructor_id,aircraft_id,start_time,end_time,status,booking_kind) values('00000000-0000-0000-0000-000000000003',u,a,now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','flight');
 assert (private.assess_aircraft_licences(u,'00000000-0000-4000-8000-000000000001','2026-09-10','2026-09-10',true,'24-1234')->>'eligible')::boolean,'Private aircraft uses inferred licence family';
 assert not (private.assess_aircraft_licences(u,'00000000-0000-4000-8000-000000000001','2026-09-10','2026-09-10',true,'N123AB')->>'eligible')::boolean,'Unknown private family requires review';

 -- Supervised training still honours a course requirement without a course award licence.
 insert into training_courses(id,medical_requirement_mode) values('20000000-0000-0000-0000-000000000001','required');
 insert into student_course_enrolments values('00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','active');
 begin
   insert into bookings(student_id,instructor_id,aircraft_id,start_time,end_time,status,booking_kind) values('00000000-0000-0000-0000-000000000003',u,a,now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','flight');
   raise exception 'Course medical requirement bypassed';
 exception when others then assert sqlerrm like 'Pilot licence/medical:%',sqlerrm;end;
 perform save_member_medical(jsonb_build_object('user_id','00000000-0000-0000-0000-000000000003','type_id','casa-class-2','issued_on','2026-01-01','expires_on','2035-01-01','status','verified'));
 insert into bookings(student_id,instructor_id,aircraft_id,start_time,end_time,status,booking_kind) values('00000000-0000-0000-0000-000000000003',u,a,now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','flight');
 assert not (private.assess_licence_medical(u,'CASA Private Pilot Licence (PPL)','2035-01-01','2035-01-02')->>'eligible')::boolean,'Medical must cover flight end';
 update training_syllabus_settings set licence_medical_requirements=jsonb_set(licence_medical_requirements,'{casa private pilot licence (ppl),required}','false');
 assert (private.assess_licence_medical(u,'CASA Private Pilot Licence (PPL)','2035-01-01','2035-01-02')->>'eligible')::boolean,'Explicit no-medical rule respected';
 update training_syllabus_settings set licence_medical_requirements=jsonb_set(licence_medical_requirements,'{casa private pilot licence (ppl),required}','true');
 update member_medicals set status='pending' where id=r.id;
 assert (private.assess_aircraft_licences(u,a,'2026-09-10','2026-09-10')->>'eligible')::boolean,'Pending CASA leaves RAAus intact';
 assert not (private.assess_aircraft_licences(u,'10000000-0000-0000-0000-000000000002','2026-09-10','2026-09-10')->>'eligible')::boolean,'Pending medical cannot clear PPL';
 update member_medicals set status='suspended' where id=r.id;
 assert not (public.check_booking_medicals(b.id,false)->'pilot'->>'eligible')::boolean,'Preflight detects restriction added since booking';
end $$;
rollback;
