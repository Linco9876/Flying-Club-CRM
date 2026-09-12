-- Medicals are self-service records. Keep historical verification and date fields
-- for audit purposes, but new saves use one expiry and no approval workflow.
alter table public.member_medicals drop constraint member_medicals_status_check;
alter table public.member_medicals add constraint member_medicals_status_check check(status in ('active','pending','verified','legacy','superseded','withdrawn','suspended'));
alter table public.member_medicals alter column status set default 'active';

-- A birthday is the expiry before the threshold. After it, the same type remains
-- usable with supporting evidence and an explicit certificate expiry.
create or replace function private.medical_effective_expiry(r public.member_medicals, dob date, at_date date) returns date
language plpgsql immutable set search_path=public,pg_temp as $$
declare birthday date;
begin
 if at_date is null then return null; end if;
 if r.validity_mode='until_age' then
   if dob is null or r.valid_until_age is null then return null; end if;
   birthday:=make_date(extract(year from dob)::int+r.valid_until_age,extract(month from dob)::int,1)+(extract(day from dob)::int-1);
   if at_date<birthday then return birthday; end if;
   if r.document_id is null then return null; end if;
 end if;
 if r.expires_on is null or r.expires_on<at_date then return null; end if;
 return r.expires_on;
end $$;
revoke all on function private.medical_effective_expiry(public.member_medicals,date,date) from public,anon,authenticated;

-- Preserve a before/after audit for automatic pending-status and expiry updates.
with changed as (
 select m.id,to_jsonb(m) before_record,
 case when m.validity_mode='until_age' and coalesce(s.date_of_birth,u.date_of_birth) is not null and m.valid_until_age is not null
   and (now() at time zone 'Australia/Sydney')::date < (make_date(extract(year from coalesce(s.date_of_birth,u.date_of_birth))::int+m.valid_until_age,extract(month from coalesce(s.date_of_birth,u.date_of_birth))::int,1)+(extract(day from coalesce(s.date_of_birth,u.date_of_birth))::int-1))
 then make_date(extract(year from coalesce(s.date_of_birth,u.date_of_birth))::int+m.valid_until_age,extract(month from coalesce(s.date_of_birth,u.date_of_birth))::int,1)+(extract(day from coalesce(s.date_of_birth,u.date_of_birth))::int-1)
 else coalesce(m.expires_on,m.review_due_on) end expiry
 from public.member_medicals m join public.users u on u.id=m.user_id left join public.students s on s.id=m.user_id
 where m.status in ('pending','verified','legacy','active')
), updated as (
 update public.member_medicals m set status=case when m.status='pending' then 'active' else m.status end, expires_on=c.expiry,updated_at=now()
 from changed c where m.id=c.id and (m.status='pending' or m.expires_on is distinct from c.expiry)
 returning m.*,c.before_record
)
insert into public.member_medical_audit(medical_id,user_id,action,before_record,after_record)
select id,user_id,'self_service_medical_migration',before_record,to_jsonb(updated)-'before_record' from updated;

create or replace function public.save_member_medical(p_record jsonb) returns public.member_medicals
language plpgsql security definer set search_path=public,private as $$
declare
 r public.member_medicals%rowtype; before_r public.member_medicals%rowtype; d jsonb;
 v_id uuid:=coalesce(nullif(p_record->>'id','')::uuid,gen_random_uuid());
 v_user uuid:=(p_record->>'user_id')::uuid;
 v_staff boolean:=public.current_user_has_staff_role() and auth.jwt()->>'aal'='aal2';
 v_status text:=coalesce(p_record->>'status','active');
 v_dob date; v_birthday date; v_expiry date:=nullif(p_record->>'expires_on','')::date; v_mode text; v_age integer;
begin
 if v_status in ('pending','verified','legacy') then v_status:='active'; end if;
 if auth.uid() is null or not coalesce(v_staff or (v_user=auth.uid() and public.current_user_has_full_portal_access()),false) then raise exception 'Medical record access denied'; end if;
 select * into before_r from public.member_medicals where id=v_id for update;
 if found and before_r.user_id<>v_user then raise exception 'Medical owner cannot change'; end if;
 if before_r.id is not null and nullif(p_record->>'updated_at','')::timestamptz is distinct from before_r.updated_at then raise exception 'Medical changed since it was opened. Refresh before saving.'; end if;
 if not coalesce(v_staff,false) and (v_status not in ('active','withdrawn') or before_r.status in ('suspended','superseded')) then raise exception 'Only authorised staff can change restricted or archived medicals'; end if;
 select t into d from public.training_syllabus_settings s,lateral jsonb_array_elements(s.medical_types) t where t->>'id'=p_record->>'type_id' limit 1;
 if d is null and before_r.id is null then raise exception 'Choose a configured medical type'; end if;
 if d is not null and coalesce((d->>'isActive')::boolean,true)=false and before_r.id is null then raise exception 'Medical type is inactive'; end if;
 if nullif(p_record->>'document_id','') is not null and not exists(select 1 from public.student_documents where id=(p_record->>'document_id')::uuid and student_id=v_user) then raise exception 'Evidence must belong to this member'; end if;
 v_mode:=coalesce(d->>'validityMode',before_r.validity_mode);
 v_age:=case when v_mode='until_age' then coalesce((d->>'validUntilAge')::integer,before_r.valid_until_age) else null end;
 if v_status='active' then
   if v_mode='until_age' then
     select coalesce(s.date_of_birth,u.date_of_birth) into v_dob from public.users u left join public.students s on s.id=u.id where u.id=v_user;
     if v_dob is null or v_age is null then raise exception 'Add a date of birth before saving this age-limited medical'; end if;
     v_birthday:=make_date(extract(year from v_dob)::int+v_age,extract(month from v_dob)::int,1)+(extract(day from v_dob)::int-1);
     if (now() at time zone 'Australia/Sydney')::date<v_birthday then v_expiry:=v_birthday;
     elsif nullif(p_record->>'document_id','') is null then raise exception 'A supporting document and expiry date are required from age %',v_age; end if;
   end if;
   if v_expiry is null then raise exception 'Enter the medical expiry date'; end if;
 end if;
 if v_status in ('suspended','withdrawn','superseded') and nullif(btrim(p_record->>'restrictions'),'') is null then raise exception 'Enter a reason for the status change'; end if;
 insert into public.member_medicals(id,user_id,type_id,medical_type,issued_on,expires_on,review_due_on,validity_mode,valid_until_age,accepted_operations,status,restrictions,document_id,verified_at,verified_by)
 values(v_id,v_user,coalesce(d->>'id',before_r.type_id),coalesce(d->>'name',before_r.medical_type),before_r.issued_on,v_expiry,before_r.review_due_on,
 v_mode,v_age,
 case when coalesce(v_staff,false) and p_record ? 'accepted_operations' then array(select jsonb_array_elements_text(p_record->'accepted_operations')) else coalesce((select array_agg(value) from jsonb_array_elements_text(d->'acceptedOperations')),case when d is null then before_r.accepted_operations else private.medical_operation_defaults(d->>'name') end) end,
 v_status,nullif(btrim(p_record->>'restrictions'),''),nullif(p_record->>'document_id','')::uuid,before_r.verified_at,before_r.verified_by)
 on conflict(id) do update set type_id=excluded.type_id,medical_type=excluded.medical_type,issued_on=excluded.issued_on,expires_on=excluded.expires_on,review_due_on=excluded.review_due_on,
 validity_mode=excluded.validity_mode,valid_until_age=excluded.valid_until_age,accepted_operations=excluded.accepted_operations,status=excluded.status,restrictions=excluded.restrictions,document_id=excluded.document_id,
 verified_at=member_medicals.verified_at,verified_by=member_medicals.verified_by,updated_at=now() returning * into r;
 insert into public.member_medical_audit(medical_id,user_id,actor_id,action,before_record,after_record) values(r.id,r.user_id,auth.uid(),case when before_r.id is null then 'created' else 'updated' end,case when before_r.id is not null then to_jsonb(before_r) end,to_jsonb(r));
 return r;
end $$;

revoke all on function public.save_member_medical(jsonb) from public,anon;
grant execute on function public.save_member_medical(jsonb) to authenticated,service_role;
create or replace function private.capture_legacy_medical() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare d jsonb; r public.member_medicals%rowtype;
begin
 if tg_op='UPDATE' and new.medical_type is not distinct from old.medical_type and new.medical_expiry is not distinct from old.medical_expiry then return new; end if;
 -- Older profile submissions remain self-service; normal expiry/evidence checks apply.
 if nullif(btrim(new.medical_type),'') is null and new.medical_expiry is null then return new; end if;
 select t into d from public.training_syllabus_settings s, lateral jsonb_array_elements(s.medical_types) t
 where lower(t->>'name')=lower(btrim(new.medical_type)) limit 1;
 insert into public.member_medicals(user_id,type_id,medical_type,expires_on,validity_mode,valid_until_age,accepted_operations,status,legacy_snapshot)
 values(new.id,d->>'id',coalesce(nullif(btrim(new.medical_type),''),'Unspecified medical (imported)'),new.medical_expiry,
 coalesce(d->>'validityMode',case when new.medical_type ~* '(self[- ]?declar|medical declaration)' then 'until_age' else 'expiry_date' end),
 case when d->>'validityMode'='until_age' then (d->>'validUntilAge')::integer when d is null and new.medical_type ~* '(self[- ]?declar|medical declaration)' then 75 else null end,
 coalesce((select array_agg(value) from jsonb_array_elements_text(d->'acceptedOperations')),private.medical_operation_defaults(new.medical_type)),
 'active',jsonb_build_object('medical_type',new.medical_type,'medical_expiry',new.medical_expiry,'imported_at',now())) returning * into r;
 insert into public.member_medical_audit(medical_id,user_id,actor_id,action,after_record) values(r.id,r.user_id,auth.uid(),'legacy_profile_submission',to_jsonb(r));
 return new;
end $$;
revoke all on function private.capture_legacy_medical() from public,anon,authenticated;
create or replace function private.assess_medical_records(p_user uuid,p_at date,p_operation text) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare r public.member_medicals%rowtype; expiry date; age_date date; dob date; best jsonb; best_date date;
begin
 if p_at is null then return jsonb_build_object('eligible',false,'reason','Flight date is required.'); end if;
 if p_operation not in ('raaus_pilot','raaus_instructor','casa_private','casa_class1') or p_operation is null then
 return jsonb_build_object('eligible',false,'reason','Choose the medical operating framework for this flight.','operation',p_operation); end if;
 if exists(select 1 from public.member_medicals where user_id=p_user and status='suspended') then
 return jsonb_build_object('eligible',false,'reason','Medical restriction requires staff review.','operation',p_operation); end if;
 select coalesce(s.date_of_birth,u.date_of_birth) into dob from public.users u left join public.students s on s.id=u.id where u.id=p_user;
 for r in select * from public.member_medicals where user_id=p_user and status in ('active','verified','legacy') and p_operation=any(accepted_operations) loop
   expiry:=private.medical_effective_expiry(r,dob,p_at);
   if expiry is null then continue; end if;
   age_date:=case when r.validity_mode='until_age' and dob is not null and r.valid_until_age is not null then make_date(extract(year from dob)::int+r.valid_until_age,extract(month from dob)::int,1)+(extract(day from dob)::int-1) end;
   if best is null or expiry>best_date then
     best_date:=expiry;
     best:=jsonb_build_object('eligible',true,'operation',p_operation,'medicalId',r.id,'medicalType',r.medical_type,'effectiveExpiry',expiry,'expiryInclusive',expiry is distinct from age_date,'verification',r.status,'reason','An applicable medical is current.');
   end if;
 end loop;
 return coalesce(best,jsonb_build_object('eligible',false,'operation',p_operation,'reason','No current accepted medical covers this operation.'));
end $$;
revoke all on function private.assess_medical_records(uuid,date,text) from public,anon,authenticated;

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
 for r in select * from public.member_medicals where user_id=p_user and status in ('active','verified','legacy') and accepted ? type_id order by created_at desc loop
   if private.medical_effective_expiry(r,dob,p_at) is null then continue; end if;
   expiry:=private.medical_effective_expiry(r,dob,p_through);
   if expiry is null then continue; end if;
   return jsonb_build_object('eligible',true,'medicalId',r.id,'medicalType',r.medical_type,'effectiveExpiry',expiry,'reason',p_type||': accepted medical current.');
 end loop;
 return jsonb_build_object('eligible',false,'reason',p_type||': accepted medical missing, expired or missing required evidence.');
end $$;
revoke all on function private.assess_licence_medical(uuid,text,date,date,boolean) from public,anon,authenticated;


update private.function_permission_manifest set rationale='Owner can save active medical records without approval; AAL2 staff manage restrictions. Evidence and expiry are enforced by age and every write is audited.',reviewed_at=current_date where signature='public.save_member_medical(p_record jsonb)';
select private.assert_function_permission_manifest();
