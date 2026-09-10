-- Preserve medical evidence and licence verification; derive flying validity at flight time.
alter table public.training_syllabus_settings add column licence_medical_requirements jsonb not null default '{"raaus pilot certificate":{"required":true,"acceptedMedicalTypeIds":["raaus-medical-declaration","driver-licence-medical","raaus-instructor-medical-med003","casa-class-1","casa-class-2"],"instructorMedicalTypeIds":["raaus-instructor-medical-med003","casa-class-1","casa-class-2"]},"casa recreational pilot licence (rpl)":{"required":true,"acceptedMedicalTypeIds":["casa-class-1","casa-class-2"],"instructorMedicalTypeIds":["casa-class-1","casa-class-2"]},"casa private pilot licence (ppl)":{"required":true,"acceptedMedicalTypeIds":["casa-class-1","casa-class-2"],"instructorMedicalTypeIds":["casa-class-1","casa-class-2"]},"casa commercial pilot licence (cpl)":{"required":true,"acceptedMedicalTypeIds":["casa-class-1"],"instructorMedicalTypeIds":["casa-class-1"]},"casa air transport pilot licence (atpl)":{"required":true,"acceptedMedicalTypeIds":["casa-class-1"],"instructorMedicalTypeIds":["casa-class-1"]}}'::jsonb check(jsonb_typeof(licence_medical_requirements)='object');

create or replace function private.assess_licence_medical(p_user uuid,p_type text,p_at date,p_through date,p_instructing boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare rule jsonb; accepted jsonb; r public.member_medicals%rowtype; dob date; expiry date; age_date date;
begin
 if p_at is null or p_through is null or p_through<p_at then return jsonb_build_object('eligible',false,'reason','Valid flight dates are required.');end if;
 if exists(select 1 from public.member_medicals where user_id=p_user and status='suspended') then return jsonb_build_object('eligible',false,'reason','Medical restriction requires staff review.');end if;
 select licence_medical_requirements->lower(trim(p_type)) into rule from public.training_syllabus_settings limit 1;
 if rule->>'required'='false' then return jsonb_build_object('eligible',true,'reason','No medical required for this licence.');end if;
 accepted:=rule->case when p_instructing then 'instructorMedicalTypeIds' else 'acceptedMedicalTypeIds' end;
 if accepted is null or jsonb_typeof(accepted)<>'array' or jsonb_array_length(accepted)=0 then return jsonb_build_object('eligible',false,'reason',p_type||': medical requirements need configuration.');end if;
 select coalesce(s.date_of_birth,u.date_of_birth) into dob from public.users u left join public.students s on s.id=u.id where u.id=p_user;
 for r in select * from public.member_medicals where user_id=p_user and status in ('verified','legacy') and accepted ? type_id order by created_at desc loop
   if r.issued_on>p_at then continue;end if;
   age_date:=null;
   if r.validity_mode='until_age' then
     if dob is null or r.valid_until_age is null then continue;end if;
     age_date:=make_date(extract(year from dob)::int+r.valid_until_age,extract(month from dob)::int,1)+(extract(day from dob)::int-1);
     if p_through>=age_date then continue;end if;
   end if;
   expiry:=least(r.expires_on,r.review_due_on,age_date);
   if expiry is null or expiry<p_through then continue;end if;
   return jsonb_build_object('eligible',true,'medicalId',r.id,'medicalType',r.medical_type,'effectiveExpiry',expiry,'reason',p_type||': accepted medical current.');
 end loop;
 return jsonb_build_object('eligible',false,'reason',p_type||': accepted medical missing, expired or awaiting verification.');
end $$;
revoke all on function private.assess_licence_medical(uuid,text,date,date,boolean) from public,anon,authenticated;

create or replace function private.assess_aircraft_licences(p_user uuid,p_aircraft uuid,p_at date,p_through date,p_instructing boolean default false,p_private_reg text default null,p_medical_only boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare a public.aircraft%rowtype; all_types text[]; any_types text[]; kind text; result jsonb; results jsonb:='[]'; matched boolean; valid boolean; failure text;
begin
 if exists(select 1 from public.member_medicals where user_id=p_user and status='suspended') then return jsonb_build_object('eligible',false,'reason','Medical restriction requires staff review.');end if;
 select * into a from public.aircraft where id=p_aircraft;
 if not found then return jsonb_build_object('eligible',false,'reason','Aircraft not found.');end if;
 all_types:=coalesce(a.required_licence_all_types,'{}'); any_types:=coalesce(a.required_licence_types,'{}');
 -- Private aircraft have no fleet profile; infer their existing licence family from the required registration.
 if p_aircraft='00000000-0000-4000-8000-000000000001' then
   if p_private_reg ~ '^\d{2}[- ]\d{3,4}$' then all_types:=array['RAAus Pilot Certificate'];
   elsif p_private_reg ~* '^VH[- ]' then any_types:=array['CASA Recreational Pilot Licence (RPL)','CASA Private Pilot Licence (PPL)','CASA Commercial Pilot Licence (CPL)','CASA Air Transport Pilot Licence (ATPL)'];
   else return jsonb_build_object('eligible',false,'reason','Private aircraft registration needs staff review to identify its required licences.');end if;
 end if;
 if cardinality(all_types)=0 and cardinality(any_types)=0 then
   return jsonb_build_object('eligible',not p_medical_only,'reason','No licence requirements configured for this aircraft.');
 end if;
 foreach kind in array all_types loop
   valid:=p_medical_only or exists(select 1 from public.licences l where l.student_id=p_user and lower(trim(l.type))=lower(trim(kind)) and l.is_active and l.verification_status='verified' and (l.date_obtained is null or l.date_obtained<=p_at) and (l.expiry_date is null or l.expiry_date>=p_through));
   result:=case when valid then private.assess_licence_medical(p_user,kind,p_at,p_through,p_instructing) else jsonb_build_object('eligible',false,'reason',kind||': active verified licence required for the flight dates.') end;
   results:=results||jsonb_build_array(result||jsonb_build_object('licenceType',kind));
   if result->>'eligible'<>'true' then return result||jsonb_build_object('licences',results);end if;
 end loop;
 matched:=cardinality(any_types)=0;
 foreach kind in array any_types loop
   valid:=p_medical_only or exists(select 1 from public.licences l where l.student_id=p_user and lower(trim(l.type))=lower(trim(kind)) and l.is_active and l.verification_status='verified' and (l.date_obtained is null or l.date_obtained<=p_at) and (l.expiry_date is null or l.expiry_date>=p_through));
   result:=case when valid then private.assess_licence_medical(p_user,kind,p_at,p_through,p_instructing) else jsonb_build_object('eligible',false,'reason',kind||': active verified licence required for the flight dates.') end;
   results:=results||jsonb_build_array(result||jsonb_build_object('licenceType',kind));
   if result->>'eligible'='true' then matched:=true;exit;end if;
   if valid then failure:=result->>'reason';end if;
 end loop;
 return jsonb_build_object('eligible',matched,'reason',case when matched then 'Required licences and accepted medicals are valid for this flight.' else coalesce(failure,'A current verified licence with an accepted medical is required: '||array_to_string(any_types,', ')) end,'licences',results);
end $$;
revoke all on function private.assess_aircraft_licences(uuid,uuid,date,date,boolean,text,boolean) from public,anon,authenticated;

-- Shared by save-time enforcement and the preflight recheck; no caller-selected medical framework.
create or replace function private.booking_licence_medical_results(b public.bookings,p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare zone text; first_day date; last_day date; pilot jsonb; instructor jsonb; course_type text; course_result jsonb;
begin
 if b.booking_kind='ground' or b.aircraft_id is null then return jsonb_build_object('pilot',jsonb_build_object('eligible',true,'reason','No aircraft operation to assess.'));end if;
 select timezone into zone from public.organisation_settings limit 1;
 first_day:=(p_start at time zone coalesce(zone,'Australia/Sydney'))::date;
 last_day:=(p_end at time zone coalesce(zone,'Australia/Sydney'))::date;
 if b.instructor_id is not null then
   instructor:=private.assess_aircraft_licences(b.instructor_id,b.aircraft_id,first_day,last_day,true,b.private_aircraft_registration);
   pilot:=jsonb_build_object('eligible',true,'reason','Supervised flight: the instructor must satisfy the aircraft licence and medical requirements.');
   -- Keep explicitly configured training-course medical requirements for students.
   if not coalesce(b.is_guest_booking,false) then
     for course_type in select c.completion_licence_type from public.student_course_enrolments e join public.training_courses c on c.id=e.course_id
       left join public.users u on u.id=e.student_id left join public.students s on s.id=u.id
       where e.student_id=b.student_id and e.status='active' and (c.medical_requirement_mode='required' or (c.medical_requirement_mode='age_threshold' and extract(year from age(last_day,coalesce(s.date_of_birth,u.date_of_birth)))>=c.medical_requirement_age)) loop
       course_result:=case when nullif(trim(course_type),'') is null then private.assess_aircraft_licences(b.student_id,b.aircraft_id,first_day,last_day,false,b.private_aircraft_registration,true) else private.assess_licence_medical(b.student_id,course_type,first_day,last_day,false) end;
       if course_result->>'eligible'<>'true' then pilot:=course_result;exit;end if;
     end loop;
   end if;
 else
   pilot:=private.assess_aircraft_licences(b.student_id,b.aircraft_id,first_day,last_day,false,b.private_aircraft_registration);
 end if;
 if exists(select 1 from public.member_medicals where user_id=b.student_id and status='suspended') then pilot:=jsonb_build_object('eligible',false,'reason','Medical restriction requires staff review.');end if;
 return jsonb_build_object('checkedAt',now(),'flightDate',first_day,'pilot',pilot,'instructor',instructor);
end $$;
revoke all on function private.booking_licence_medical_results(public.bookings,timestamptz,timestamptz) from public,anon,authenticated;

create or replace function private.assess_booking_medicals() returns trigger
language plpgsql security definer set search_path=public,private as $$
begin
 new.medical_operation:=null;
 if tg_op='UPDATE' and (new.student_id,new.instructor_id,new.aircraft_id,new.start_time,new.end_time,new.private_aircraft_registration,new.status,new.booking_kind,new.is_guest_booking,new.deleted_at) is not distinct from (old.student_id,old.instructor_id,old.aircraft_id,old.start_time,old.end_time,old.private_aircraft_registration,old.status,old.booking_kind,old.is_guest_booking,old.deleted_at) then
   new.medical_eligibility_snapshot:=old.medical_eligibility_snapshot;return new;
 end if;
 if new.status in ('cancelled','no-show') or new.deleted_at is not null then return new;end if;
 new.medical_eligibility_snapshot:=private.booking_licence_medical_results(new,new.start_time,new.end_time);
 if new.start_time>=now() then
   if new.medical_eligibility_snapshot->'pilot'->>'eligible'='false' then raise exception 'Pilot licence/medical: %',new.medical_eligibility_snapshot->'pilot'->>'reason';end if;
   if new.medical_eligibility_snapshot->'instructor'->>'eligible'='false' then raise exception 'Instructor licence/medical: %',new.medical_eligibility_snapshot->'instructor'->>'reason';end if;
 end if;
 return new;
end $$;
revoke all on function private.assess_booking_medicals() from public,anon,authenticated;

create or replace function public.check_booking_medicals(p_booking_id uuid,p_use_current_time boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare b public.bookings%rowtype;
begin
 select * into b from public.bookings where id=p_booking_id;
 if not found or not coalesce(public.current_user_has_full_portal_access() and (public.current_user_has_staff_role() or auth.uid()=b.student_id or auth.uid()=b.instructor_id),false) then raise exception 'Booking medical check access denied';end if;
 return private.booking_licence_medical_results(b,case when p_use_current_time then now() else b.start_time end,case when p_use_current_time then now()+(b.end_time-b.start_time) else b.end_time end);
end $$;
select private.assert_function_permission_manifest();
