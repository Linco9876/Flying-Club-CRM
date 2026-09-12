-- One RPC assessment, displayed in both the enrolled course and review history.
-- Replace the old prefill triggers: they overwrite private-aircraft/log metadata and
-- count only portal hours. The new context includes opening balances and external logs.
drop trigger if exists prefill_rpc_flight_review_on_insert on public.flight_review_records;
drop trigger if exists prefill_rpc_flight_review_on_change on public.flight_review_records;
alter table public.training_lessons add column if not exists flight_review_template_id uuid references public.training_courses(id) on delete restrict;
alter table public.training_records add column if not exists flight_review_record_id uuid references public.flight_review_records(id) on delete restrict;
create unique index if not exists training_records_rpc_review_unique on public.training_records(flight_review_record_id) where flight_review_record_id is not null;
alter table public.flight_review_records add column if not exists retest_of_id uuid references public.flight_review_records(id) on delete restrict;
alter table public.flight_review_records add column if not exists retest_root_id uuid references public.flight_review_records(id) on delete restrict;
alter table public.flight_review_record_items add column if not exists carried_from_item_id uuid references public.flight_review_record_items(id) on delete restrict;
create index if not exists flight_reviews_retest_parent_idx on public.flight_review_records(retest_of_id);
create index if not exists flight_reviews_retest_root_idx on public.flight_review_records(retest_root_id);
create index if not exists review_items_carried_idx on public.flight_review_record_items(carried_from_item_id);
create index if not exists lessons_review_template_idx on public.training_lessons(flight_review_template_id);

update public.training_lessons l set flight_review_template_id=t.id
from public.training_courses c, public.training_courses t
where l.course_id=c.id and l.is_flight_test
  and regexp_replace(lower(c.title),'[^a-z]','','g')='raausabinitio'
  and t.review_configuration->>'review_type'='raaus_rpc_flight_test' and t.status='published';

create or replace function private.prepare_rpc_review() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare f public.flight_logs%rowtype; a public.aircraft%rowtype; root public.flight_review_records%rowtype; prior public.flight_review_records%rowtype;
begin
  if new.review_type <> 'raaus_rpc_flight_test' then return new; end if;
  -- Submitted attempts are historical evidence. Use a new attempt, never reopen one.
  if tg_op='UPDATE' and old.status in ('completed','further_training_required') then
    if (to_jsonb(new)-array['candidate_ack','candidate_ack_name','candidate_ack_at','updated_at','version','source_training_record_id']) is distinct from
       (to_jsonb(old)-array['candidate_ack','candidate_ack_name','candidate_ack_at','updated_at','version','source_training_record_id']) then
      raise exception 'This RPC attempt is submitted. Start a new test attempt to record further assessment.';
    end if;
    return new;
  end if;
  if new.flight_log_id is not null then
    select * into f from public.flight_logs where id=new.flight_log_id;
    if not found or f.student_id is distinct from new.candidate_id or f.start_time is null or f.end_time is null or f.end_time<=f.start_time or f.end_time>now()
       or coalesce(f.dual_time,0)+coalesce(f.solo_time,0)<=0 then
      raise exception 'Attach an actual flight log for this candidate before submitting the RPC test';
    end if;
    select * into a from public.aircraft where id=f.aircraft_id;
    new.booking_id:=f.booking_id;
    new.review_date:=(f.start_time at time zone 'Australia/Sydney')::date;
    new.flight_minutes:=round((coalesce(f.dual_time,0)+coalesce(f.solo_time,0))*60);
    new.aircraft_id:=f.aircraft_id;
    new.aircraft_type:=coalesce(nullif(f.private_aircraft_type,''),nullif(concat_ws(' ',a.make,a.model),''),'');
    new.registration:=coalesce(nullif(f.private_aircraft_registration,''),a.registration,'');
    if new.status='completed' then new.completion_date:=new.review_date; end if;
  end if;
  if new.retest_of_id is not null then
    if tg_op='UPDATE' and (new.retest_of_id is distinct from old.retest_of_id or new.retest_root_id is distinct from old.retest_root_id) then
      raise exception 'The original retest chain cannot be changed';
    end if;
    select * into prior from public.flight_review_records where id=new.retest_of_id;
    select * into root from public.flight_review_records where id=new.retest_root_id;
    if prior.status is distinct from 'further_training_required' or prior.candidate_id is distinct from new.candidate_id
       or prior.review_type is distinct from new.review_type or root.id is distinct from coalesce(prior.retest_root_id,prior.id)
       or new.template_snapshot is distinct from prior.template_snapshot then
      raise exception 'Retests must link to the same candidate and original unsuccessful RPC assessment';
    end if;
    if new.flight_log_id is not null then
      if new.flight_log_id=prior.flight_log_id or f.start_time <= (select start_time from public.flight_logs where id=prior.flight_log_id) then
        raise exception 'A retest needs a different, later flight';
      end if;
      if new.review_date < root.review_date or new.review_date > root.review_date+30 then
        raise exception 'The 30-day retest window has ended. Start a full RPC test instead.';
      end if;
    end if;
  elsif new.retest_root_id is not null or (tg_op='UPDATE' and old.retest_of_id is not null) then raise exception 'The retest chain cannot be removed';
  end if;
  if new.status in ('completed','further_training_required') then
    if exists(select 1 from jsonb_array_elements(coalesce(new.template_snapshot->'review_configuration'->'checklist','[]')) t
      where coalesce((t->>'required')::boolean,false) and not exists(select 1 from public.flight_review_record_items i
        where i.review_record_id=new.id and i.template_item_key=t->>'key' and i.required)) then
      raise exception 'The RPC assessment is missing required checklist components';
    end if;
    if new.flight_log_id is null then raise exception 'Attach the test flight log before submitting. Drafts do not require flight details.'; end if;
    if coalesce((new.assessment_details->>'detailsConfirmed')::boolean,false) is not true then
      raise exception 'Confirm the prefilled candidate and flight details before submitting';
    end if;
    if new.status='further_training_required' and not exists(select 1 from public.flight_review_record_items where review_record_id=new.id and result='further_training') then
      raise exception 'Mark the components requiring further training in the checklist';
    end if;
    if nullif(btrim(new.reviewer_sign_name),'') is null or new.reviewer_sign_at is null then raise exception 'Reviewer signature is required'; end if;
  end if;
  return new;
end $$;
revoke all on function private.prepare_rpc_review() from public,anon,authenticated;
create trigger a_prepare_rpc_review before insert or update on public.flight_review_records for each row execute function private.prepare_rpc_review();

create or replace function private.protect_submitted_rpc_delete() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.review_type='raaus_rpc_flight_test' and old.status in ('completed','further_training_required') then
    raise exception 'Submitted RPC assessments are retained as historical evidence';
  end if;
  return old;
end $$;
revoke all on function private.protect_submitted_rpc_delete() from public,anon,authenticated;
create trigger protect_submitted_rpc_delete before delete on public.flight_review_records for each row execute function private.protect_submitted_rpc_delete();

create or replace function private.protect_rpc_review_item() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r public.flight_review_records%rowtype; source public.flight_review_record_items%rowtype;
begin
  select * into r from public.flight_review_records where id=coalesce(new.review_record_id,old.review_record_id);
  if r.review_type='raaus_rpc_flight_test' and r.status in ('completed','further_training_required') then
    raise exception 'Submitted RPC checklist evidence cannot be changed. Start a new test attempt.';
  end if;
  if tg_op <> 'DELETE' and new.carried_from_item_id is not null then
    select * into source from public.flight_review_record_items where id=new.carried_from_item_id;
    if source.review_record_id is distinct from r.retest_of_id or source.template_item_key is distinct from new.template_item_key
       or source.result is distinct from 'satisfactory' or new.result <> 'satisfactory' then
      raise exception 'Carried competency must come from the previous satisfactory assessment';
    end if;
  end if;
  if tg_op='UPDATE' and old.carried_from_item_id is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Previously satisfactory evidence is retained unchanged';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.protect_rpc_review_item() from public,anon,authenticated;
create trigger protect_rpc_review_item before insert or update or delete on public.flight_review_record_items for each row execute function private.protect_rpc_review_item();

create or replace function public.start_rpc_retest(p_previous_id uuid) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.flight_review_records%rowtype; v_id uuid; root_id uuid;
begin
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' or not private.can_manage_flight_reviews() or not private.current_user_can_conduct_flight_review(p_previous_id) then raise exception 'An authorised reviewer is required'; end if;
  select * into p from public.flight_review_records where id=p_previous_id for update;
  if not found or p.review_type<>'raaus_rpc_flight_test' or p.status<>'further_training_required' or p.flight_log_id is null then
    raise exception 'Select a submitted unsuccessful RPC test with an attached flight log';
  end if;
  select id into v_id from public.flight_review_records where retest_of_id=p.id and status in ('draft','in_progress') order by created_at limit 1;
  if found then return v_id; end if;
  root_id:=coalesce(p.retest_root_id,p.id);
  insert into public.flight_review_records(template_course_id,template_snapshot,candidate_id,reviewer_user_id,review_type,authority,review_date,
    retest_of_id,retest_root_id,assessment_details,candidate_objectives,created_by)
  values(p.template_course_id,p.template_snapshot,p.candidate_id,auth.uid(),p.review_type,p.authority,current_date,
    p.id,root_id,p.assessment_details-array['detailsConfirmed','examinerMembershipNumber','totalFlightHours','dualFlightHours','commandFlightHours'],'Reassess outstanding components from the previous RPC flight test.',auth.uid()) returning id into v_id;
  insert into public.flight_review_record_items(review_record_id,template_item_key,section,code,title,guidance,required,result,notes,sort_order,carried_from_item_id)
  select v_id,template_item_key,section,code,title,guidance,required,
    case when result='satisfactory' then 'satisfactory' else 'not_assessed' end,
    case when result='satisfactory' then notes else '' end,sort_order,case when result='satisfactory' then id else null end
  from public.flight_review_record_items where review_record_id=p.id;
  return v_id;
end $$;
revoke all on function public.start_rpc_retest(uuid) from public,anon,authenticated,service_role;
grant execute on function public.start_rpc_retest(uuid) to authenticated,service_role;

create or replace function private.sync_rpc_course_record(p_review_id uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r public.flight_review_records%rowtype; l public.training_lessons%rowtype; f public.flight_logs%rowtype; tid uuid;
begin
  select * into r from public.flight_review_records where id=p_review_id;
  if r.review_type<>'raaus_rpc_flight_test' or r.status not in ('completed','further_training_required') or r.flight_log_id is null then return; end if;
  update public.flight_logs set training_record_status='recorded' where id=r.flight_log_id;
  select lesson.* into l from public.training_lessons lesson join public.student_course_enrolments e on e.course_id=lesson.course_id
  where e.student_id=r.candidate_id and e.status in ('active','completed') and lesson.flight_review_template_id=r.template_course_id
  order by e.enrolled_at limit 1;
  if not found then return; end if;
  select * into f from public.flight_logs where id=r.flight_log_id;
  select id into tid from public.training_records where flight_review_record_id=r.id;
  if tid is null and r.source_training_record_id is not null then
    select id into tid from public.training_records where id=r.source_training_record_id and status='draft' and student_id=r.candidate_id;
  end if;
  if tid is null then
    insert into public.training_records(student_id,instructor_id,date,comments,status,flight_review_record_id)
      values(r.candidate_id,coalesce(r.reviewer_user_id,r.created_by),r.review_date,coalesce(f.comments,''),'draft',r.id) returning id into tid;
  end if;
  update public.training_records set course_id=l.course_id,lesson_id=l.id,flight_review_record_id=r.id,
    flight_log_id=f.id,booking_id=f.booking_id,date=r.review_date,aircraft_id=r.aircraft_id,aircraft_type=r.aircraft_type,registration=r.registration,
    dual_time_min=round(coalesce(f.dual_time,0)*60),solo_time_min=round(coalesce(f.solo_time,0)*60),
    comments=coalesce(f.comments,''),is_flight_review=true,flight_review_type='RAAus RPC Flight Test',
    flight_review_result=case when r.status='completed' then 'pass' else 'fail' end,
    flight_review_notes=concat_ws(E'\n',nullif(r.reviewer_summary,''),nullif(r.remedial_plan,'')),
    instructor_sign_timestamp=r.reviewer_sign_at,status='submitted',updated_at=now()
  where id=tid;
  if r.source_training_record_id is distinct from tid then
    update public.flight_review_records set source_training_record_id=tid where id=r.id;
  end if;
  update public.flight_logs set training_record_status='recorded' where id=f.id;
end $$;
revoke all on function private.sync_rpc_course_record(uuid) from public,anon,authenticated;

create or replace function private.sync_rpc_course_after_review() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
  if pg_trigger_depth()<2 then perform private.sync_rpc_course_record(new.id); end if;
  return new;
end $$;
revoke all on function private.sync_rpc_course_after_review() from public,anon,authenticated;
create trigger sync_rpc_course_after_review after insert or update of status on public.flight_review_records for each row execute function private.sync_rpc_course_after_review();

CREATE OR REPLACE FUNCTION private.enforce_training_deficiency_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_lesson public.training_lessons%rowtype;
  v_gate_stage text;
  v_open_count integer;
begin
  -- A recorded unsuccessful RPC attempt must remain visible while training is outstanding.
  if new.flight_review_record_id is not null and new.flight_review_result='fail' then return new; end if;
  if new.status = 'draft' or new.student_id is null or new.course_id is null or new.lesson_id is null then
    return new;
  end if;

  select * into v_lesson
  from public.training_lessons
  where id = new.lesson_id and course_id = new.course_id;

  if not found then
    return new;
  end if;

  if coalesce(v_lesson.is_flight_test, false) then
    v_gate_stage := 'pre_test';
  elsif concat_ws(' ', v_lesson.name, v_lesson.sequence_title)
      ~* '(^|[^[:alnum:]])(first[[:space:]]+)?solo([^[:alnum:]]|$)'
    and concat_ws(' ', v_lesson.name, v_lesson.sequence_title)
      !~* '(^|[^[:alnum:]])pre[[:space:]-]*solo([^[:alnum:]]|$)'
    and concat_ws(' ', v_lesson.name, v_lesson.sequence_title)
      !~* '(^|[^[:alnum:]])solo[[:space:]-]+(assessment|check|readiness)([^[:alnum:]]|$)' then
    v_gate_stage := 'pre_solo';
  else
    return new;
  end if;

  select count(*) into v_open_count
  from public.training_deficiencies deficiency
  where deficiency.student_id = new.student_id
    and deficiency.course_id = new.course_id
    and deficiency.stage = v_gate_stage
    and deficiency.status = 'open';

  if v_open_count > 0 then
    raise exception using
      message = format(
        '%s open %s %s must be marked fixed before this lesson can be submitted',
        v_open_count,
        case v_gate_stage when 'pre_solo' then 'pre-solo' else 'pre-test' end,
        case v_open_count when 1 then 'deficiency' else 'deficiencies' end
      ),
      hint = 'Open an earlier lesson record, mark each addressed deficiency as fixed, and submit that record first.';
  end if;

  return new;
end;
$function$
;

-- Protect the shared projection against legacy forms changing the authoritative result.
create or replace function private.protect_rpc_course_projection() returns trigger
language plpgsql set search_path=public,private,pg_temp as $$
begin
  if new.status<>'draft' and new.flight_review_record_id is null and new.record_origin='portal'
    and (tg_op='INSERT' or old.status='draft') and exists(select 1 from public.training_lessons where id=new.lesson_id and flight_review_template_id is not null) then
    raise exception 'Use the linked RPC review form to submit this flight test';
  end if;
  if pg_trigger_depth()=1 and (new.flight_review_record_id is not null or (tg_op='UPDATE' and old.flight_review_record_id is not null))
    and current_user not in ('postgres','supabase_admin') then
    if tg_op='INSERT' or (to_jsonb(new)-array['student_ack','student_ack_name','student_ack_timestamp','student_comments','status','audit_log','updated_at']) is distinct from
      (to_jsonb(old)-array['student_ack','student_ack_name','student_ack_timestamp','student_comments','status','audit_log','updated_at'])
      or new.status not in ('submitted','locked') then raise exception 'Edit this test through its RPC review form'; end if;
  end if;
  return new;
end $$;
revoke all on function private.protect_rpc_course_projection() from public,anon,authenticated;
create trigger protect_rpc_course_projection before insert or update on public.training_records for each row execute function private.protect_rpc_course_projection();

create or replace function public.rpc_review_context(p_review_id uuid) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r public.flight_review_records%rowtype; s public.students%rowtype; examiner public.students%rowtype;
 b public.logbook_baselines%rowtype; cutoff date; d numeric; p numeric; extra numeric; flights jsonb; root_date date;
begin
 select * into r from public.flight_review_records where id=p_review_id;
 if not found or auth.uid() is null or (r.candidate_id<>auth.uid() and not private.can_manage_flight_reviews()) then raise exception 'You cannot access this review'; end if;
 select * into s from public.students where id=r.candidate_id;
 select * into examiner from public.students where id=r.reviewer_user_id;
 select * into b from public.logbook_baselines where user_id=r.candidate_id;
 cutoff:=coalesce((select (start_time at time zone 'Australia/Sydney')::date from public.flight_logs where id=r.flight_log_id),current_date);
 -- Opening balances are inclusive; do not count the same hours twice.
 select coalesce(sum(dual_time),0),coalesce(sum(solo_time),0) into d,p from public.flight_logs
 where student_id=r.candidate_id and (start_time at time zone 'Australia/Sydney')::date<=cutoff
 and (b.as_of_date is null or b.as_of_date>cutoff or (start_time at time zone 'Australia/Sydney')::date>b.as_of_date);
 select d+coalesce(sum(dual_hours),0),p+coalesce(sum(pic_hours),0) into d,p from public.external_logbook_entries
 where user_id=r.candidate_id and flight_date<=cutoff and (b.as_of_date is null or b.as_of_date>cutoff or flight_date>b.as_of_date);
 if b.as_of_date is not null and b.as_of_date<=cutoff then
   d:=d+b.dual_hours; p:=p+b.pic_hours; extra:=greatest(0,b.total_hours-b.dual_hours-b.pic_hours);
 else extra:=0; end if;
 select jsonb_agg(x order by x->>'reviewDate' desc) into flights from (
   select jsonb_build_object('id',f.id,'aircraftId',f.aircraft_id,'reviewDate',(f.start_time at time zone 'Australia/Sydney')::date,
    'aircraftType',coalesce(nullif(f.private_aircraft_type,''),concat_ws(' ',a.make,a.model)),
    'registration',coalesce(nullif(f.private_aircraft_registration,''),a.registration,''),
    'flightMinutes',round((coalesce(f.dual_time,0)+coalesce(f.solo_time,0))*60)) as x
   from public.flight_logs f left join public.aircraft a on a.id=f.aircraft_id
   where f.student_id=r.candidate_id and f.start_time is not null and f.end_time>f.start_time and f.end_time<=now() and coalesce(f.dual_time,0)+coalesce(f.solo_time,0)>0
   order by (f.id=r.flight_log_id) desc,f.start_time desc limit 100
 ) rows;
 select review_date into root_date from public.flight_review_records where id=r.retest_root_id;
 return jsonb_build_object('defaults',jsonb_strip_nulls(jsonb_build_object(
   'applicantMembershipNumber',nullif(s.raaus_id,''),'applicantMembershipExpiry',s.licence_expiry,
   'examinerMembershipNumber',nullif(examiner.raaus_id,''),'totalFlightHours',round(d+p+extra,1),
   'dualFlightHours',round(d,1),'commandFlightHours',round(p,1))),
   'flights',coalesce(flights,'[]'::jsonb),'retestDeadline',root_date+30);
end $$;
revoke all on function public.rpc_review_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.rpc_review_context(uuid) to authenticated,service_role;

insert into private.function_permission_manifest(signature,function_name,classification,allowed_roles,security_definer,fixed_search_path,rationale,reviewed_at) values
 ('public.start_rpc_retest(p_previous_id uuid)','start_rpc_retest','staff_aal2',array['authenticated','service_role'],true,true,'Authorised reviewers create a separate RPC retest and preserve the original assessment.',current_date),
 ('public.rpc_review_context(p_review_id uuid)','rpc_review_context','authenticated_self_service',array['authenticated','service_role'],true,true,'Only the candidate or staff can read the prefill context for a review.',current_date)
on conflict(signature) do update set allowed_roles=excluded.allowed_roles,security_definer=excluded.security_definer,fixed_search_path=excluded.fixed_search_path;

select private.assert_function_permission_manifest();

CREATE OR REPLACE FUNCTION private.sync_course_flight_test_review_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_course public.training_courses%rowtype;
  v_lesson public.training_lessons%rowtype;
  v_reviewer_name text;
  v_authority text;
  v_review_type text;
  v_review_status text;
  v_snapshot jsonb;
BEGIN
  IF NEW.flight_review_record_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'draft'
     OR NOT coalesce(NEW.is_flight_review, false)
     OR NEW.flight_review_result NOT IN ('pass', 'fail') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lesson
  FROM public.training_lessons lesson
  WHERE lesson.id = NEW.lesson_id
    AND lesson.course_id = NEW.course_id
    AND lesson.is_flight_test;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_course
  FROM public.training_courses course
  WHERE course.id = NEW.course_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT nullif(btrim(portal_user.name), '')
  INTO v_reviewer_name
  FROM public.users portal_user
  WHERE portal_user.id = NEW.instructor_id;

  v_authority := CASE
    WHEN concat_ws(' ', v_course.title, v_course.category, v_lesson.name, NEW.flight_review_type)
      ~* '(RAAus|RPC|Pilot Certificate)' THEN 'raaus'
    WHEN concat_ws(' ', v_course.title, v_course.category, v_lesson.name, NEW.flight_review_type)
      ~* '(CASA|RPL|PPL|CPL|ATPL)' THEN 'casa'
    ELSE 'club'
  END;
  v_review_type := CASE
    WHEN v_authority = 'raaus' THEN 'raaus_course_flight_test'
    WHEN v_authority = 'casa' THEN 'casa_course_flight_test'
    ELSE 'course_flight_test'
  END;
  v_review_status := CASE
    WHEN NEW.flight_review_result = 'pass' THEN 'completed'
    ELSE 'further_training_required'
  END;
  v_snapshot := jsonb_build_object(
    'title', concat(v_course.title, ' - ', v_lesson.name),
    'version', v_course.version,
    'course_purpose', 'flight_test',
    'record_origin', 'course_flight_test',
    'course_id', v_course.id,
    'lesson_id', v_lesson.id,
    'review_configuration', jsonb_build_object(
      'review_type', v_review_type,
      'authority', v_authority,
      'outcome_scheme', 'pass_fail',
      'validity_months', 24,
      'resets_flight_review', true,
      'candidate_ack_required', false,
      'allowed_reviewer_roles',
        jsonb_build_array('admin', 'cfi', 'senior_instructor', 'instructor'),
      'required_evidence', '[]'::jsonb,
      'checklist', '[]'::jsonb,
      'requires_reviewer_summary', false,
      'reviewer_summary_label', 'Formal findings or required follow-up'
    ),
    'captured_at', now()
  );

  INSERT INTO public.flight_review_records (
    template_course_id,
    template_snapshot,
    source_training_record_id,
    candidate_id,
    reviewer_user_id,
    booking_id,
    flight_log_id,
    review_type,
    authority,
    status,
    review_date,
    completion_date,
    aircraft_id,
    aircraft_type,
    registration,
    ground_minutes,
    flight_minutes,
    reviewer_summary,
    reviewer_sign_name,
    reviewer_sign_at,
    next_review_due,
    created_by,
    updated_by
  ) VALUES (
    v_course.id,
    v_snapshot,
    NEW.id,
    NEW.student_id,
    NEW.instructor_id,
    NEW.booking_id,
    NEW.flight_log_id,
    v_review_type,
    v_authority,
    v_review_status,
    NEW.date,
    CASE WHEN NEW.flight_review_result = 'pass' THEN NEW.date ELSE NULL END,
    NEW.aircraft_id,
    NEW.aircraft_type,
    NEW.registration,
    0,
    greatest(0, coalesce(NEW.dual_time_min, 0) + coalesce(NEW.solo_time_min, 0)),
    coalesce(NEW.flight_review_notes, ''),
    coalesce(v_reviewer_name, 'Instructor'),
    coalesce(NEW.instructor_sign_timestamp, now()),
    CASE
      WHEN NEW.flight_review_result = 'pass' THEN (NEW.date + interval '2 years')::date
      ELSE NULL
    END,
    NEW.instructor_id,
    NEW.instructor_id
  )
  ON CONFLICT (source_training_record_id) DO UPDATE
  SET template_course_id = EXCLUDED.template_course_id,
      template_snapshot = EXCLUDED.template_snapshot,
      candidate_id = EXCLUDED.candidate_id,
      reviewer_user_id = EXCLUDED.reviewer_user_id,
      booking_id = EXCLUDED.booking_id,
      flight_log_id = EXCLUDED.flight_log_id,
      review_type = EXCLUDED.review_type,
      authority = EXCLUDED.authority,
      status = EXCLUDED.status,
      review_date = EXCLUDED.review_date,
      completion_date = EXCLUDED.completion_date,
      aircraft_id = EXCLUDED.aircraft_id,
      aircraft_type = EXCLUDED.aircraft_type,
      registration = EXCLUDED.registration,
      flight_minutes = EXCLUDED.flight_minutes,
      reviewer_summary = EXCLUDED.reviewer_summary,
      reviewer_sign_name = EXCLUDED.reviewer_sign_name,
      reviewer_sign_at = EXCLUDED.reviewer_sign_at,
      next_review_due = EXCLUDED.next_review_due,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  WHERE flight_review_records.template_snapshot->>'record_origin' = 'course_flight_test';

  PERFORM public.sync_member_flight_review_from_endorsements(NEW.student_id);
  RETURN NEW;
END;
$function$;

-- Link previously submitted RPC reviews without rewriting their assessment evidence.
-- Historical backfill uses the existing service audit path, then restores session claims.
do $$
declare prior_role text:=current_setting('request.jwt.claim.role',true);
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  perform private.sync_rpc_course_record(id) from public.flight_review_records
  where review_type='raaus_rpc_flight_test' and status in ('completed','further_training_required') and flight_log_id is not null;
  perform set_config('request.jwt.claim.role',coalesce(prior_role,''),true);
end $$;
