-- Medical evidence is a collection. Legacy fields are preserved for rollback and
-- imported exactly once; they are no longer the source of current eligibility.
create table public.member_medicals (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id) on delete cascade,
 type_id text,
 medical_type text not null,
 issued_on date,
 expires_on date,
 review_due_on date,
 validity_mode text not null default 'expiry_date' check(validity_mode in ('expiry_date','until_age')),
 valid_until_age integer check(valid_until_age between 1 and 120),
 accepted_operations text[] not null default '{}',
 status text not null default 'pending' check(status in ('pending','verified','legacy','superseded','withdrawn','suspended')),
 restrictions text,
 document_id uuid references public.student_documents(id) on delete restrict,
 verified_at timestamptz,
 verified_by uuid references public.users(id),
 legacy_snapshot jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(accepted_operations <@ array['raaus_pilot','raaus_instructor','casa_private','casa_class1']::text[])
);
create index member_medicals_user_idx on public.member_medicals(user_id);
create unique index member_medicals_one_legacy_idx on public.member_medicals(user_id) where status='legacy';
create table public.member_medical_audit (
 id uuid primary key default gen_random_uuid(),
 medical_id uuid not null references public.member_medicals(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 actor_id uuid,
 action text not null,
 before_record jsonb,
 after_record jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.member_medicals enable row level security;
alter table public.member_medical_audit enable row level security;
revoke all on public.member_medicals, public.member_medical_audit from anon, authenticated;
grant select on public.member_medicals, public.member_medical_audit to authenticated;
grant all on public.member_medicals, public.member_medical_audit to service_role;
create policy medical_owner_or_verified_staff_read on public.member_medicals for select to authenticated
using ((user_id=auth.uid() and public.current_user_has_full_portal_access()) or (public.current_user_has_staff_role() and auth.jwt()->>'aal'='aal2'));
create policy medical_audit_owner_or_verified_staff_read on public.member_medical_audit for select to authenticated
using ((user_id=auth.uid() and public.current_user_has_full_portal_access()) or (public.current_user_has_staff_role() and auth.jwt()->>'aal'='aal2'));

create or replace function private.medical_operation_defaults(p_name text) returns text[]
language sql immutable set search_path=public as $$
 select case lower(btrim(p_name))
 when 'casa class 1' then array['raaus_pilot','raaus_instructor','casa_private','casa_class1']
 when 'casa class 2' then array['raaus_pilot','raaus_instructor','casa_private']
 when 'raaus instructor medical (med003)' then array['raaus_pilot','raaus_instructor']
 when 'raaus medical declaration' then array['raaus_pilot']
 when 'driver licence medical' then array['raaus_pilot']
 else array[]::text[] end;
$$;
revoke all on function private.medical_operation_defaults(text) from public,anon,authenticated;

create or replace function private.capture_legacy_medical() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare d jsonb; r public.member_medicals%rowtype;
begin
 if tg_op='UPDATE' and new.medical_type is not distinct from old.medical_type and new.medical_expiry is not distinct from old.medical_expiry then return new; end if;
 -- Older clients may still write the scalar fields. Capture that evidence as
 -- pending; never let an old profile write grant clearance or remove a valid record.
 if nullif(btrim(new.medical_type),'') is null and new.medical_expiry is null then return new; end if;
 select t into d from public.training_syllabus_settings s, lateral jsonb_array_elements(s.medical_types) t
 where lower(t->>'name')=lower(btrim(new.medical_type)) limit 1;
 insert into public.member_medicals(user_id,type_id,medical_type,expires_on,validity_mode,valid_until_age,accepted_operations,status,legacy_snapshot)
 values(new.id,d->>'id',coalesce(nullif(btrim(new.medical_type),''),'Unspecified medical (imported)'),new.medical_expiry,
 coalesce(d->>'validityMode',case when new.medical_type ~* '(self[- ]?declar|medical declaration)' then 'until_age' else 'expiry_date' end),
 case when d->>'validityMode'='until_age' then (d->>'validUntilAge')::integer when d is null and new.medical_type ~* '(self[- ]?declar|medical declaration)' then 75 else null end,
 coalesce((select array_agg(value) from jsonb_array_elements_text(d->'acceptedOperations')),private.medical_operation_defaults(new.medical_type)),
 'pending',jsonb_build_object('medical_type',new.medical_type,'medical_expiry',new.medical_expiry,'imported_at',now())) returning * into r;
 insert into public.member_medical_audit(medical_id,user_id,actor_id,action,after_record) values(r.id,r.user_id,auth.uid(),'legacy_profile_submission',to_jsonb(r));
 return new;
end $$;
revoke all on function private.capture_legacy_medical() from public,anon,authenticated;
create trigger capture_legacy_medical after insert or update of medical_type,medical_expiry on public.students
for each row execute function private.capture_legacy_medical();
-- Backfill uses the identical mapping as the compatibility trigger, including
-- unknown types and expiry-only records. No dates or verification are invented.
insert into public.member_medicals(user_id,type_id,medical_type,expires_on,validity_mode,valid_until_age,accepted_operations,status,legacy_snapshot)
select s.id,d->>'id',coalesce(nullif(btrim(s.medical_type),''),'Unspecified medical (imported)'),s.medical_expiry,
 coalesce(d->>'validityMode',case when s.medical_type ~* '(self[- ]?declar|medical declaration)' then 'until_age' else 'expiry_date' end),
 case when d->>'validityMode'='until_age' then (d->>'validUntilAge')::integer when d is null and s.medical_type ~* '(self[- ]?declar|medical declaration)' then 75 else null end,
 coalesce((select array_agg(value) from jsonb_array_elements_text(d->'acceptedOperations')),private.medical_operation_defaults(s.medical_type)),
 'legacy',jsonb_build_object('medical_type',s.medical_type,'medical_expiry',s.medical_expiry,'imported_at',now())
from public.students s left join lateral (
 select t as d from public.training_syllabus_settings ts,lateral jsonb_array_elements(ts.medical_types) t
 where lower(t->>'name')=lower(btrim(s.medical_type)) limit 1
) definition on true
where nullif(btrim(s.medical_type),'') is not null or s.medical_expiry is not null;
insert into public.member_medical_audit(medical_id,user_id,action,after_record)
select id,user_id,'legacy_import',to_jsonb(m) from public.member_medicals m;

do $$ begin
 if exists(select 1 from public.students s where (nullif(btrim(s.medical_type),'') is not null or s.medical_expiry is not null)
 and not exists(select 1 from public.member_medicals m where m.user_id=s.id and m.status='legacy'
 and m.legacy_snapshot->>'medical_type' is not distinct from s.medical_type
 and m.expires_on is not distinct from s.medical_expiry)) then
 raise exception 'Medical migration validation failed: source record not preserved'; end if;
end $$;

create or replace function public.save_member_medical(p_record jsonb) returns public.member_medicals
language plpgsql security definer set search_path=public,private as $$
declare
 r public.member_medicals%rowtype; before_r public.member_medicals%rowtype; d jsonb;
 v_id uuid:=coalesce(nullif(p_record->>'id','')::uuid,gen_random_uuid());
 v_user uuid:=(p_record->>'user_id')::uuid;
 v_staff boolean:=public.current_user_has_staff_role() and auth.jwt()->>'aal'='aal2';
 v_status text:=coalesce(p_record->>'status','pending');
begin
 if auth.uid() is null or not coalesce(v_staff or (v_user=auth.uid() and public.current_user_has_full_portal_access()),false) then raise exception 'Medical record access denied'; end if;
 select * into before_r from public.member_medicals where id=v_id for update;
 if found and before_r.user_id<>v_user then raise exception 'Medical owner cannot change'; end if;
 if before_r.id is not null and nullif(p_record->>'updated_at','')::timestamptz is distinct from before_r.updated_at then raise exception 'Medical changed since it was opened. Refresh before saving.'; end if;
 if not coalesce(v_staff,false) and (v_status not in ('pending','withdrawn') or (before_r.id is not null and before_r.status not in ('pending','withdrawn'))) then raise exception 'Only authorised staff can verify or change accepted medicals'; end if;
 if v_status='legacy' then raise exception 'Imported status is reserved for migration'; end if;
 select t into d from public.training_syllabus_settings s,lateral jsonb_array_elements(s.medical_types) t where t->>'id'=p_record->>'type_id' limit 1;
 if d is null and before_r.id is null then raise exception 'Choose a configured medical type'; end if;
 if d is not null and coalesce((d->>'isActive')::boolean,true)=false and before_r.id is null then raise exception 'Medical type is inactive'; end if;
 if nullif(p_record->>'document_id','') is not null and not exists(select 1 from public.student_documents where id=(p_record->>'document_id')::uuid and student_id=v_user) then raise exception 'Evidence must belong to this member'; end if;
 if v_status='verified' and nullif(p_record->>'issued_on','') is null then raise exception 'Enter the issue or declaration date before verification'; end if;
 if v_status in ('verified','pending') and coalesce(d->>'validityMode',before_r.validity_mode)='until_age' and nullif(p_record->>'review_due_on','') is null then raise exception 'Enter the declaration review date'; end if;
 if v_status='verified' and coalesce(d->>'validityMode',before_r.validity_mode)='expiry_date' and nullif(p_record->>'expires_on','') is null then raise exception 'Enter the expiry printed on the certificate'; end if;
 if nullif(p_record->>'expires_on','')::date < nullif(p_record->>'issued_on','')::date or nullif(p_record->>'review_due_on','')::date < nullif(p_record->>'issued_on','')::date then raise exception 'Expiry or review cannot precede issue'; end if;
 if v_status in ('suspended','withdrawn','superseded') and nullif(btrim(p_record->>'restrictions'),'') is null then raise exception 'Enter a reason for the status change'; end if;
 insert into public.member_medicals(id,user_id,type_id,medical_type,issued_on,expires_on,review_due_on,validity_mode,valid_until_age,accepted_operations,status,restrictions,document_id,verified_at,verified_by)
 values(v_id,v_user,coalesce(d->>'id',before_r.type_id),coalesce(d->>'name',before_r.medical_type),nullif(p_record->>'issued_on','')::date,nullif(p_record->>'expires_on','')::date,nullif(p_record->>'review_due_on','')::date,
 coalesce(d->>'validityMode',before_r.validity_mode),coalesce((d->>'validUntilAge')::integer,before_r.valid_until_age),
 case when coalesce(v_staff,false) and p_record ? 'accepted_operations' then array(select jsonb_array_elements_text(p_record->'accepted_operations')) else coalesce((select array_agg(value) from jsonb_array_elements_text(d->'acceptedOperations')),private.medical_operation_defaults(d->>'name')) end,
 v_status,nullif(btrim(p_record->>'restrictions'),''),nullif(p_record->>'document_id','')::uuid,case when v_status='verified' then now() end,case when v_status='verified' then auth.uid() end)
 on conflict(id) do update set type_id=excluded.type_id,medical_type=excluded.medical_type,issued_on=excluded.issued_on,expires_on=excluded.expires_on,review_due_on=excluded.review_due_on,
 validity_mode=excluded.validity_mode,valid_until_age=excluded.valid_until_age,accepted_operations=excluded.accepted_operations,status=excluded.status,restrictions=excluded.restrictions,document_id=excluded.document_id,
 verified_at=case when excluded.status='verified' then excluded.verified_at else member_medicals.verified_at end,verified_by=case when excluded.status='verified' then excluded.verified_by else member_medicals.verified_by end,updated_at=now() returning * into r;
 insert into public.member_medical_audit(medical_id,user_id,actor_id,action,before_record,after_record) values(r.id,r.user_id,auth.uid(),case when before_r.id is null then 'created' else 'updated' end,case when before_r.id is not null then to_jsonb(before_r) end,to_jsonb(r));
 return r;
end $$;
revoke all on function public.save_member_medical(jsonb) from public,anon;
grant execute on function public.save_member_medical(jsonb) to authenticated,service_role;
insert into private.function_permission_manifest(signature,function_name,classification,allowed_roles,security_definer,fixed_search_path,rationale,reviewed_at)
values('public.save_member_medical(p_record jsonb)','save_member_medical','authenticated_self_service',array['authenticated','service_role'],true,true,'Owner can submit pending evidence; AAL2 staff alone verify, restrict or supersede medicals. Audits every write.',date '2026-09-10');
select private.assert_function_permission_manifest();
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
 for r in select * from public.member_medicals where user_id=p_user and status in ('verified','legacy') and p_operation=any(accepted_operations) loop
   expiry:=null; age_date:=null;
   if r.issued_on is not null and r.issued_on>p_at then continue; end if;
   if r.validity_mode='until_age' then
     if dob is null or r.valid_until_age is null then continue; end if;
     age_date:=make_date(extract(year from dob)::integer+r.valid_until_age,extract(month from dob)::integer,1)+(extract(day from dob)::integer-1);
     if p_at>=age_date then continue; end if;
     expiry:=age_date;
   else
     expiry:=r.expires_on;
   end if;
   expiry:=least(expiry,r.review_due_on,r.expires_on);
   if expiry is null or expiry<p_at then continue; end if;
   if best is null or expiry>best_date then
     best_date:=expiry;
     best:=jsonb_build_object('eligible',true,'operation',p_operation,'medicalId',r.id,'medicalType',r.medical_type,'effectiveExpiry',expiry,'expiryInclusive',expiry is distinct from age_date,'verification',r.status,'reason','An applicable medical is current.');
   end if;
 end loop;
 return coalesce(best,jsonb_build_object('eligible',false,'operation',p_operation,'reason','No current accepted medical covers this operation.'));
end $$;
revoke all on function private.assess_medical_records(uuid,date,text) from public,anon,authenticated;

create or replace function public.assess_member_medicals(p_user_id uuid,p_at date,p_operation text) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
begin
 if not coalesce(auth.role()='service_role' or (public.current_user_has_full_portal_access() and (auth.uid()=p_user_id or public.current_user_has_staff_role())),false) then raise exception 'Medical eligibility access denied'; end if;
 return private.assess_medical_records(p_user_id,p_at,p_operation);
end $$;
revoke all on function public.assess_member_medicals(uuid,date,text) from public,anon;
grant execute on function public.assess_member_medicals(uuid,date,text) to authenticated,service_role;

alter table public.bookings add column medical_operation text check(medical_operation in ('raaus_pilot','casa_private','casa_class1')),
 add column medical_eligibility_snapshot jsonb;
create or replace function private.member_medical_required(p_user uuid,p_date date) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.user_roles where user_id=p_user and role in ('pilot','instructor','senior_instructor','cfi'))
   or exists(select 1 from public.users where id=p_user and role in ('pilot','instructor','senior_instructor','cfi'))
   or exists(select 1 from public.student_course_enrolments e join public.training_courses c on c.id=e.course_id
     left join public.users u on u.id=e.student_id left join public.students s on s.id=u.id
     where e.student_id=p_user and e.status='active' and (c.medical_requirement_mode='required' or (c.medical_requirement_mode='age_threshold' and extract(year from age(p_date,coalesce(s.date_of_birth,u.date_of_birth)))>=c.medical_requirement_age)))
;
$$;
revoke all on function private.member_medical_required(uuid,date) from public,anon,authenticated;
create or replace function private.assess_booking_medicals() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare reg text; op text; pilot_required boolean; pilot_result jsonb; instructor_result jsonb; block_expired boolean; on_date date; end_date date; zone text;
begin
 if tg_op='UPDATE' and (new.student_id,new.instructor_id,new.aircraft_id,new.start_time,new.end_time,new.private_aircraft_registration,new.medical_operation,new.status) is not distinct from (old.student_id,old.instructor_id,old.aircraft_id,old.start_time,old.end_time,old.private_aircraft_registration,old.medical_operation,old.status) then
   new.medical_eligibility_snapshot:=old.medical_eligibility_snapshot; return new;
 end if;
 if coalesce(new.booking_kind,'flight')='ground' or new.aircraft_id is null or new.status in ('cancelled','no-show') or new.deleted_at is not null then return new; end if;
 select registration into reg from public.aircraft where id=new.aircraft_id;
 reg:=coalesce(nullif(new.private_aircraft_registration,''),reg);
 op:=new.medical_operation;
 if reg ~* '^VH[- ]' then
   if op is null then op:='casa_private'; end if;
   if op='raaus_pilot' then raise exception 'A VH aircraft requires a CASA medical operating framework'; end if;
 elsif reg ~ '^\d{2}[- ]\d{3,4}$' then
   if op is null then op:='raaus_pilot'; end if;
   if op<>'raaus_pilot' then raise exception 'An RAAus aircraft requires the RAAus medical operating framework'; end if;
 end if;
 new.medical_operation:=op;
 select timezone into zone from public.organisation_settings limit 1;
 on_date:=(new.start_time at time zone coalesce(zone,'Australia/Sydney'))::date;
 end_date:=(new.end_time at time zone coalesce(zone,'Australia/Sydney'))::date;
 select coalesce(auto_block_expired_medical,true) into block_expired from public.safety_compliance_settings limit 1;
 pilot_required:=private.member_medical_required(new.student_id,on_date);
 if not coalesce(new.is_guest_booking,false) and pilot_required then pilot_result:=private.assess_medical_records(new.student_id,on_date,op); end if;
 if new.instructor_id is not null then instructor_result:=private.assess_medical_records(new.instructor_id,on_date,case when op='raaus_pilot' then 'raaus_instructor' else op end); end if;
 if pilot_result->>'eligible'='true' and ((pilot_result->>'effectiveExpiry')::date<end_date or (pilot_result->>'expiryInclusive'='false' and (pilot_result->>'effectiveExpiry')::date=end_date)) then pilot_result:=jsonb_build_object('eligible',false,'reason','Pilot medical expires before this flight ends.'); end if;
 if instructor_result->>'eligible'='true' and ((instructor_result->>'effectiveExpiry')::date<end_date or (instructor_result->>'expiryInclusive'='false' and (instructor_result->>'effectiveExpiry')::date=end_date)) then instructor_result:=jsonb_build_object('eligible',false,'reason','Instructor medical expires before this flight ends.'); end if;
 new.medical_eligibility_snapshot:=jsonb_build_object('assessedAt',now(),'flightDate',on_date,'operation',op,'pilot',pilot_result,'instructor',instructor_result);
 -- Historical records remain loggable. Future booking enforcement follows the
 -- club's existing medical-block setting, with a stored explanation in either mode.
 if new.start_time>=now() and coalesce(block_expired,true) then
   if pilot_result->>'eligible'='false' then raise exception 'Pilot medical: %',pilot_result->>'reason'; end if;
   if instructor_result->>'eligible'='false' then raise exception 'Instructor medical: %',instructor_result->>'reason'; end if;
 end if;
 return new;
end $$;
revoke all on function private.assess_booking_medicals() from public,anon,authenticated;
create trigger assess_booking_medicals before insert or update on public.bookings for each row execute function private.assess_booking_medicals();
insert into private.function_permission_manifest(signature,function_name,classification,allowed_roles,security_definer,fixed_search_path,rationale,reviewed_at)
values('public.assess_member_medicals(p_user_id uuid, p_at date, p_operation text)','assess_member_medicals','authenticated_self_service',array['authenticated','service_role'],true,true,'Owner or staff can read minimal eligibility; no medical documents, health notes or profile details exposed.',date '2026-09-10');
select private.assert_function_permission_manifest();

create or replace view public.calendar_booking_public
with (security_invoker = false, security_barrier = true)
as
with viewer as (
  select
    auth.uid() as uid,
    public.current_user_has_staff_role() as is_staff,
    public.current_user_has_full_portal_access() as has_full_access
)
select
  b.id,
  b.student_id,
  b.instructor_id,
  b.aircraft_id,
  b.start_time,
  b.end_time,
  case when viewer.is_staff or b.student_id = viewer.uid then b.payment_type else null end as payment_type,
  case when viewer.is_staff or b.student_id = viewer.uid then b.notes else null end as notes,
  b.status,
  coalesce(b.has_conflict, false) as has_conflict,
  b.deleted_at,
  coalesce(b.flight_logged, false) as flight_logged,
  case when viewer.is_staff or b.student_id = viewer.uid then b.flight_type_id else null end as flight_type_id,
  case when viewer.is_staff or b.student_id = viewer.uid then b.trial_flight_voucher_id else null end as trial_flight_voucher_id,
  b.is_guest_booking,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_name else null end as guest_name,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_email else null end as guest_email,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_phone else null end as guest_phone,
  case
    when viewer.is_staff or b.student_id = viewer.uid then coalesce(b.guest_name, hirer.name)
    else null
  end as hirer_name,
  instructor.name as instructor_name,
  b.recurrence_series_id,
  b.recurrence_occurrence_index,
  b.recurrence_occurrence_count,
  b.recurrence_notifications_finalised_at,
  b.private_aircraft_type,
  b.private_aircraft_registration,
  b.medical_operation
from public.bookings b
cross join viewer
left join public.users hirer on hirer.id = b.student_id
left join public.users instructor on instructor.id = b.instructor_id
where viewer.has_full_access;

create or replace function public.check_booking_medicals(p_booking_id uuid,p_use_current_time boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare b public.bookings%rowtype; op text; reg text; flight_date date; end_date date; zone text; pilot jsonb; instructor jsonb;
begin
 select * into b from public.bookings where id=p_booking_id;
 if not found or not coalesce(public.current_user_has_full_portal_access() and (public.current_user_has_staff_role() or auth.uid()=b.student_id or auth.uid()=b.instructor_id),false) then raise exception 'Booking medical check access denied'; end if;
 if b.booking_kind='ground' or b.aircraft_id is null then return jsonb_build_object('pilot',jsonb_build_object('eligible',true,'reason','No aircraft operation to assess.')); end if;
 select timezone into zone from public.organisation_settings limit 1;
 flight_date:=((case when p_use_current_time then now() else b.start_time end) at time zone coalesce(zone,'Australia/Sydney'))::date;
 end_date:=((case when p_use_current_time then now()+(b.end_time-b.start_time) else b.end_time end) at time zone coalesce(zone,'Australia/Sydney'))::date;
 select registration into reg from public.aircraft where id=b.aircraft_id;
 reg:=coalesce(nullif(b.private_aircraft_registration,''),reg);
 op:=coalesce(b.medical_operation,case when reg ~* '^VH[- ]' then 'casa_private' when reg ~ '^\d{2}[- ]\d{3,4}$' then 'raaus_pilot' end);
 if not coalesce(b.is_guest_booking,false) and private.member_medical_required(b.student_id,flight_date) then pilot:=private.assess_medical_records(b.student_id,flight_date,op);
 else pilot:=jsonb_build_object('eligible',true,'reason','No pilot medical requirement applies to this booking.');end if;
 if b.instructor_id is not null then instructor:=private.assess_medical_records(b.instructor_id,flight_date,case when op='raaus_pilot' then 'raaus_instructor' else op end);end if;
 if pilot->>'eligible'='true' and ((pilot->>'effectiveExpiry')::date<end_date or (pilot->>'expiryInclusive'='false' and (pilot->>'effectiveExpiry')::date=end_date)) then pilot:=jsonb_build_object('eligible',false,'reason','Pilot medical expires before this flight ends.');end if;
 if instructor->>'eligible'='true' and ((instructor->>'effectiveExpiry')::date<end_date or (instructor->>'expiryInclusive'='false' and (instructor->>'effectiveExpiry')::date=end_date)) then instructor:=jsonb_build_object('eligible',false,'reason','Instructor medical expires before this flight ends.');end if;
 return jsonb_build_object('checkedAt',now(),'flightDate',flight_date,'operation',op,'pilot',pilot,'instructor',instructor);
end $$;
revoke all on function public.check_booking_medicals(uuid,boolean) from public,anon;
grant execute on function public.check_booking_medicals(uuid,boolean) to authenticated,service_role;
insert into private.function_permission_manifest(signature,function_name,classification,allowed_roles,security_definer,fixed_search_path,rationale,reviewed_at)
values('public.check_booking_medicals(p_booking_id uuid, p_use_current_time boolean)','check_booking_medicals','authenticated_self_service',array['authenticated','service_role'],true,true,'Booking owner or staff can recheck minimal medical eligibility before flight; no confidential documents or notes returned.',date '2026-09-10');
select private.assert_function_permission_manifest();
