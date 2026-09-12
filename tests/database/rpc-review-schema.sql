-- Isolated schema fixture derived from relevant production column definitions; contains no member data.
\set ON_ERROR_STOP on
create extension if not exists "uuid-ossp";
create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('test.aal',true),''),'aal2'))$$;
create function private.can_manage_flight_reviews() returns boolean language sql as $$select coalesce(current_setting('test.staff',true),'true')<>'false'$$;
create function private.current_user_can_conduct_flight_review(uuid) returns boolean language sql as $$select private.can_manage_flight_reviews()$$;
create function private.assert_function_permission_manifest() returns void language plpgsql as $$begin return; end$$;
create function public.sync_member_flight_review_from_endorsements(uuid) returns void language plpgsql as $$begin return; end$$;
create table private.function_permission_manifest(signature text primary key,function_name text,classification text,allowed_roles text[],security_definer boolean,fixed_search_path boolean,rationale text,reviewed_at date);
create table public.aircraft(
"id" uuid default uuid_generate_v4() not null primary key,
"registration" text not null,
"make" text not null,
"model" text not null,
"type" text not null,
"status" text default 'serviceable'::text not null,
"hourly_rate" numeric default 0.00 not null,
"total_hours" numeric default 0.0,
"last_maintenance" date,
"next_maintenance" date,
"fuel_capacity" numeric,
"empty_weight" numeric,
"max_weight" numeric,
"seat_capacity" int4 default 2,
"created_at" timestamptz default now(),
"updated_at" timestamptz default now(),
"required_endorsement_type" text,
"is_archived" bool default false not null,
"archived_at" timestamptz,
"archived_by" uuid,
"archive_reason" text,
"icon_key" text,
"xero_tracking_category_id" text,
"xero_tracking_category_name" text,
"xero_tracking_option_id" text,
"xero_tracking_option_name" text,
"xero_tracking_last_synced_at" timestamptz,
"xero_tracking_sync_error" text,
"required_endorsement_types" text[] default '{}'::text[] not null,
"required_endorsement_all_types" text[] default '{}'::text[] not null,
"required_licence_types" text[] default '{}'::text[] not null,
"required_licence_all_types" text[] default '{}'::text[] not null,
"auto_grounded_until" timestamptz,
"auto_grounded_by_defect_id" uuid,
"status_before_auto_grounding" text,
"xero_tenant_id" text,
"xero_origin_verified" bool default false not null,
"maintenance_grounded" bool default false not null,
"maintenance_grounded_milestone_id" uuid,
"private_booking_enabled" bool default false not null
);
create table public.external_logbook_entries(
"id" uuid default gen_random_uuid() not null primary key,
"user_id" uuid not null,
"flight_date" date not null,
"aircraft_registration" text not null,
"aircraft_type" text not null,
"pilot_in_command_name" text,
"other_crew_name" text,
"dual_hours" numeric default 0 not null,
"pic_hours" numeric default 0 not null,
"takeoffs" int4 default 0 not null,
"landings" int4 default 0 not null,
"comments" text default ''::text not null,
"description" text default ''::text not null,
"notes" text default ''::text not null,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null
);
create table public.flight_logs(
"id" uuid default uuid_generate_v4() not null primary key,
"booking_id" uuid not null,
"landings" int4 default 0,
"duration" numeric default 0 not null,
"tach_start" numeric default 0 not null,
"tach_end" numeric default 0 not null,
"engine_start" numeric,
"engine_end" numeric,
"total_cost" numeric,
"notes" text,
"created_at" timestamptz default now(),
"aircraft_id" uuid,
"student_id" uuid,
"instructor_id" uuid,
"start_time" timestamptz,
"end_time" timestamptz,
"start_tach" numeric,
"end_tach" numeric,
"flight_duration" numeric default 0,
"dual_time" numeric default 0,
"solo_time" numeric default 0,
"takeoffs" int4 default 0,
"comments" text,
"payment_type" text,
"observations" text,
"oil_added" numeric,
"fuel_added" numeric,
"passengers" int4,
"created_by" uuid,
"flight_type_id" uuid,
"calculated_cost" numeric,
"payment_status" text,
"training_record_status" text default 'pending'::text not null,
"hobbs_start" numeric,
"hobbs_end" numeric,
"fuel_start" numeric,
"fuel_end" numeric,
"oil_start" numeric,
"oil_end" numeric,
"fuel_type" text,
"aircraft_condition" text,
"maintenance_notes" text,
"stripe_checkout_session_id" text,
"stripe_payment_intent_id" text,
"stripe_payment_status" text,
"stripe_checkout_created_at" timestamptz,
"stripe_paid_at" timestamptz,
"updated_at" timestamptz,
"stripe_payment_error" text,
"stripe_charge_attempted_at" timestamptz,
"training_record_overdue_email_sent_at" timestamptz,
"xero_invoice_id" text,
"xero_invoice_number" text,
"xero_invoice_status" text,
"xero_invoice_synced_at" timestamptz,
"xero_payment_id" text,
"xero_payment_synced_at" timestamptz,
"xero_sync_status" text,
"xero_sync_error" text,
"stripe_mode" text default 'live'::text not null,
"is_test_mode" bool default false not null,
"xero_tenant_id" text,
"xero_origin_verified" bool default false not null,
"financial_capture_suppressed" bool default false not null,
"private_aircraft_type" text,
"private_aircraft_registration" text,
"private_aircraft_rate_snapshot" jsonb
);
create table public.flight_review_attachments(
"id" uuid default gen_random_uuid() not null primary key,
"review_record_id" uuid not null,
"candidate_id" uuid not null,
"uploaded_by" uuid default auth.uid() not null,
"category" text default 'other'::text not null,
"file_name" text not null,
"file_path" text not null,
"mime_type" text,
"file_size" int8,
"created_at" timestamptz default now() not null
);
create table public.flight_review_record_items(
"id" uuid default gen_random_uuid() not null primary key,
"review_record_id" uuid not null,
"template_item_key" text not null,
"section" text not null,
"code" text not null,
"title" text not null,
"guidance" text default ''::text not null,
"required" bool default true not null,
"result" text default 'not_assessed'::text not null,
"notes" text default ''::text not null,
"sort_order" int4 default 0 not null,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null
);
create table public.flight_review_records(
"id" uuid default gen_random_uuid() not null primary key,
"template_course_id" uuid,
"template_snapshot" jsonb default '{}'::jsonb not null,
"source_training_record_id" uuid,
"candidate_id" uuid not null,
"reviewer_user_id" uuid,
"external_examiner_name" text,
"external_examiner_identifier" text,
"external_examiner_organisation" text,
"booking_id" uuid,
"flight_log_id" uuid,
"review_type" text not null,
"authority" text default 'club'::text not null,
"status" text default 'draft'::text not null,
"review_date" date default CURRENT_DATE not null,
"completion_date" date,
"aircraft_id" uuid,
"aircraft_type" text default ''::text not null,
"registration" text default ''::text not null,
"aircraft_group" text,
"previous_review_date" date,
"previous_aircraft_group" text,
"ground_minutes" int4 default 0 not null,
"flight_minutes" int4 default 0 not null,
"candidate_objectives" text default ''::text not null,
"emergency_plan_confirmed" bool default false not null,
"reviewer_summary" text default ''::text not null,
"remedial_plan" text default ''::text not null,
"minimums_override_reason" text default ''::text not null,
"logbook_entry_confirmed" bool default false not null,
"authority_submission_confirmed" bool default false not null,
"candidate_ack" bool default false not null,
"candidate_ack_name" text,
"candidate_ack_at" timestamptz,
"reviewer_sign_name" text,
"reviewer_sign_at" timestamptz,
"next_review_due" date,
"created_by" uuid default auth.uid() not null,
"updated_by" uuid,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null,
"version" int4 default 1 not null,
"assessment_details" jsonb default '{}'::jsonb not null,
"record_origin" text default 'portal'::text not null,
"import_batch_id" uuid,
"imported_by" uuid,
"import_source_row" int4,
"source_reference" text,
unique(source_training_record_id)
);
create table public.logbook_baselines(
"user_id" uuid not null primary key,
"as_of_date" date not null,
"last_flight_date" date,
"total_hours" numeric default 0 not null,
"pic_hours" numeric default 0 not null,
"dual_hours" numeric default 0 not null,
"takeoffs" int4 default 0 not null,
"landings" int4 default 0 not null,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null
);
create table public.student_course_enrolments(
"id" uuid default gen_random_uuid() not null primary key,
"student_id" uuid not null,
"course_id" uuid not null,
"enrolled_by" uuid,
"status" text default 'active'::text not null,
"notes" text,
"enrolled_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null,
"declaration_signed_at" timestamptz,
"declaration_signed_name" text,
"declaration_member_number" text,
"declaration_text_snapshot" text,
"declaration_version" int4,
"guardian_declaration_signed_at" timestamptz,
"guardian_declaration_signed_name" text,
"guardian_declaration_relationship" text,
"guardian_declaration_email" text,
"guardian_declaration_phone" text,
"guardian_declaration_text_snapshot" text,
"guardian_declaration_version" int4,
"completed_at" timestamptz,
"completion_source_training_record_id" uuid
);
create table public.students(
"id" uuid not null primary key,
"raaus_id" text,
"casa_id" text,
"medical_type" text,
"medical_expiry" date,
"licence_expiry" date,
"date_of_birth" date,
"prepaid_balance" numeric default 0.00,
"emergency_contact_name" text,
"emergency_contact_phone" text,
"emergency_contact_relationship" text,
"created_at" timestamptz default now(),
"updated_at" timestamptz default now(),
"occupation" text,
"alternate_phone" text,
"last_flight_review" date,
"last_raaus_bfr_date" date,
"last_casa_afr_date" date
);
create table public.training_courses(
"id" uuid default gen_random_uuid() not null primary key,
"title" text not null,
"description" text default ''::text,
"category" text default 'Custom'::text not null,
"version" text default '1.0'::text not null,
"status" text default 'draft'::text not null,
"estimated_duration_hours" int4 default 6 not null,
"prerequisites" text[] default '{}'::text[],
"objectives" text[] default '{}'::text[],
"evaluation_criteria" text[] default '{}'::text[],
"tags" text[] default '{}'::text[],
"created_by" uuid,
"last_updated" timestamptz default now(),
"created_at" timestamptz default now(),
"assessment_criteria" jsonb default '[]'::jsonb not null,
"exam_requirements" jsonb default '[]'::jsonb not null,
"requires_student_acknowledgement" bool default true not null,
"completion_endorsement_enabled" bool default false not null,
"completion_endorsement_type" text,
"completion_endorsement_expiry_months" int4,
"requires_flying_declaration" bool default false not null,
"flying_declaration_title" text default 'Flying Declaration'::text not null,
"flying_declaration_text" text default ''::text not null,
"flying_declaration_version" int4 default 1 not null,
"requires_guardian_declaration_for_minors" bool default true not null,
"guardian_declaration_title" text default 'Under 18 Years - Parent/Guardian Declaration'::text not null,
"guardian_declaration_text" text default ''::text not null,
"resources" jsonb default '[]'::jsonb not null,
"two_occasion_competency_rule_enabled" bool default false not null,
"completion_licence_enabled" bool default false not null,
"completion_licence_type" text,
"completion_licence_expiry_months" int4,
"course_purpose" text default 'training'::text not null,
"review_configuration" jsonb default '{}'::jsonb not null,
"medical_requirement_mode" text default 'none'::text not null,
"medical_requirement_age" int2
);
create table public.training_lessons(
"id" uuid default gen_random_uuid() not null primary key,
"course_id" uuid not null,
"sort_order" int4 default 0 not null,
"name" text not null,
"objective" text default ''::text not null,
"flight_exercises" text default ''::text,
"theory" text default ''::text,
"sequence_id" text default ''::text,
"sequence_code" text default ''::text,
"sequence_title" text default ''::text,
"stage" text default 'flight'::text not null,
"duration_minutes" int4 default 60 not null,
"min_competency" text default 'Introduce'::text not null,
"key_exercises" text[] default '{}'::text[],
"student_preparation" text default ''::text,
"instructor_notes" text default ''::text,
"assessment_criteria" jsonb default '[]'::jsonb,
"created_at" timestamptz default now(),
"pass_marks" jsonb default '{}'::jsonb not null,
"is_flight_test" bool default false not null,
"pass_mark_repeat_requirements" jsonb default '{}'::jsonb not null,
"study_guide" text default ''::text not null,
"study_assets" jsonb default '[]'::jsonb not null
);
create table public.training_records(
"id" uuid default uuid_generate_v4() not null primary key,
"booking_id" uuid,
"student_id" uuid not null,
"instructor_id" uuid not null,
"date" date not null,
"aircraft_id" uuid,
"aircraft_type" text default ''::text not null,
"registration" text default ''::text not null,
"dual_time_min" int4 default 0,
"solo_time_min" int4 default 0,
"comments" text not null,
"formal_briefing" bool default false,
"lesson_codes" text[] default '{}'::text[],
"next_lesson" text,
"status" text default 'draft'::text not null,
"instructor_signature_url" text,
"student_ack" bool default false,
"student_ack_name" text,
"instructor_sign_timestamp" timestamptz,
"student_ack_timestamp" timestamptz,
"attachments" text[] default '{}'::text[],
"created_at" timestamptz default now(),
"updated_at" timestamptz default now(),
"course_id" uuid,
"lesson_id" uuid,
"briefing_comments" text default ''::text not null,
"criteria_grades" jsonb default '{}'::jsonb not null,
"flight_log_id" uuid,
"student_comments" text default ''::text,
"audit_log" jsonb default '[]'::jsonb not null,
"is_flight_review" bool default false not null,
"flight_review_type" text,
"flight_review_result" text,
"flight_review_notes" text,
"pilot_role_granted" bool default false not null,
"record_origin" text default 'portal'::text not null,
"import_batch_id" uuid,
"imported_by" uuid,
"import_source_row" int4,
"source_instructor_name" text,
"source_organisation" text,
"source_reference" text,
"instructor_progression_approved" bool default false not null
);
create table public.users(
"id" uuid not null primary key,
"email" text not null,
"name" text not null,
"role" text not null,
"phone" text,
"avatar_url" text,
"created_at" timestamptz default now(),
"updated_at" timestamptz default now(),
"is_senior_instructor" bool default false,
"date_of_birth" date,
"mobile_phone" text,
"home_phone" text,
"work_phone" text,
"address" text,
"emergency_contact_name" text,
"emergency_contact_phone" text,
"emergency_contact_relationship" text,
"preferred_aircraft_id" uuid,
"is_active" bool default true not null,
"cover_url" text,
"portal_access_scope" text default 'full'::text not null,
"trial_voucher_password_set_at" timestamptz,
"xero_contact_id" text,
"xero_contact_name" text,
"xero_contact_email" text,
"xero_contact_linked_at" timestamptz,
"xero_contact_sync_status" text default 'not_linked'::text not null,
"xero_contact_sync_error" text,
"xero_contact_last_synced_at" timestamptz,
"xero_tenant_id" text,
"xero_origin_verified" bool default false not null
);

CREATE OR REPLACE FUNCTION public.validate_flight_review_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  config jsonb := coalesce(new.template_snapshot->'review_configuration', '{}'::jsonb);
  minimum_ground integer := coalesce((config->>'minimum_ground_minutes')::integer, 0);
  minimum_flight integer := coalesce((config->>'minimum_flight_minutes')::integer, 0);
  validity_months integer := coalesce((config->>'validity_months')::integer, 0);
  missing_required integer;
  evidence_type text;
  rpc_endorsements jsonb;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select count(*) into missing_required
    from public.flight_review_record_items item
    where item.review_record_id = new.id
      and item.required
      and item.result <> 'satisfactory';

    if missing_required > 0 then
      raise exception '% required review items have not been assessed as satisfactory', missing_required;
    end if;
    if new.completion_date is null then
      raise exception 'Completion date is required';
    end if;
    if nullif(trim(new.reviewer_sign_name), '') is null or new.reviewer_sign_at is null then
      raise exception 'Reviewer signature is required';
    end if;
    if coalesce((config->>'requires_reviewer_summary')::boolean, false)
       and nullif(trim(new.reviewer_summary), '') is null then
      raise exception 'Examiner notes and outcome summary are required';
    end if;
    if (new.ground_minutes < minimum_ground or new.flight_minutes < minimum_flight)
       and nullif(trim(new.minimums_override_reason), '') is null then
      raise exception 'Review duration is below the template minimum; record an override reason';
    end if;
    if (new.review_type = 'raaus_bfr'
        or coalesce((config->>'requires_logbook_confirmation')::boolean, false))
       and not new.logbook_entry_confirmed then
      raise exception 'The candidate logbook entry must be confirmed';
    end if;
    if (new.review_type = 'raaus_bfr'
        or coalesce((config->>'requires_authority_submission_confirmation')::boolean, false))
       and not new.authority_submission_confirmed then
      raise exception 'The RAAus form submission must be confirmed';
    end if;

    rpc_endorsements := new.assessment_details->'endorsementsSought';
    if new.review_type = 'raaus_rpc_flight_test' and (
      nullif(trim(new.assessment_details->>'applicantMembershipNumber'), '') is null
      or nullif(trim(new.assessment_details->>'applicantMembershipExpiry'), '') is null
      or nullif(trim(new.assessment_details->>'totalFlightHours'), '') is null
      or nullif(trim(new.assessment_details->>'dualFlightHours'), '') is null
      or nullif(trim(new.assessment_details->>'commandFlightHours'), '') is null
      or nullif(trim(new.assessment_details->>'raausFlightHours'), '') is null
      or rpc_endorsements is null
      or (jsonb_typeof(rpc_endorsements) = 'array' and jsonb_array_length(rpc_endorsements) = 0)
      or (jsonb_typeof(rpc_endorsements) = 'string' and nullif(trim(new.assessment_details->>'endorsementsSought'), '') is null)
    ) then
      raise exception 'Complete the RPC applicant and aeronautical experience details';
    end if;

    for evidence_type in
      select jsonb_array_elements_text(coalesce(config->'required_evidence', '[]'::jsonb))
    loop
      if not exists (
        select 1 from public.flight_review_attachments attachment
        where attachment.review_record_id = new.id
          and attachment.category = evidence_type
      ) then
        raise exception 'Required evidence is missing: %', evidence_type;
      end if;
    end loop;

    if validity_months > 0 and new.next_review_due is null then
      new.next_review_due := new.completion_date + make_interval(months => validity_months);
    end if;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION private.validate_flight_review_formal_findings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_further_training boolean := false;
BEGIN
  IF NEW.status = 'completed' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.flight_review_record_items item
      WHERE item.review_record_id = NEW.id
        AND item.result = 'further_training'
    ) INTO v_has_further_training;
  END IF;

  IF (NEW.status = 'further_training_required' OR v_has_further_training)
    AND nullif(btrim(NEW.reviewer_summary), '') IS NULL THEN
    RAISE EXCEPTION 'Formal findings or required follow-up are required for this review outcome';
  END IF;
  RETURN NEW;
END;
$function$;
create trigger validate_flight_review_completion before update on public.flight_review_records for each row execute function public.validate_flight_review_completion();
create trigger validate_flight_review_formal_findings before update on public.flight_review_records for each row execute function private.validate_flight_review_formal_findings();

create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
create function public.current_user_has_staff_role() returns boolean language sql as $$select private.can_manage_flight_reviews()$$;
create table training_deficiencies(id uuid default gen_random_uuid(), student_id uuid, course_id uuid, stage text, status text);
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
create trigger enforce_training_deficiency_gate before insert or update on training_records for each row execute function private.enforce_training_deficiency_gate();
CREATE OR REPLACE FUNCTION public.guard_and_audit_training_record_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_is_staff boolean;
  v_actor_is_student boolean;
  v_changed_fields text[];
  v_disallowed_fields text[];
  v_allowed_student_fields text[] := array[
    'student_ack',
    'student_ack_name',
    'student_ack_timestamp',
    'student_comments',
    'status'
  ];
  v_material_fields text[];
  v_latest_revision jsonb;
  v_action text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  select coalesce(array_agg(key order by key), '{}')
  into v_changed_fields
  from jsonb_object_keys(to_jsonb(old) || to_jsonb(new)) as keys(key)
  where coalesce(to_jsonb(old) -> key, 'null'::jsonb) is distinct from coalesce(to_jsonb(new) -> key, 'null'::jsonb);

  if coalesce(array_length(v_changed_fields, 1), 0) = 0 then
    return new;
  end if;

  -- Service-only history transfers have no auth.uid(); retain the staff audit path.
  v_is_staff := coalesce(auth.role(), '') = 'service_role'
    or coalesce(public.current_user_has_staff_role(), false);
  v_actor_is_student := coalesce(auth.uid() = old.student_id, false);

  if not v_is_staff then
    if not v_actor_is_student then
      raise exception 'Only staff or the student can update this training record'
        using errcode = '42501';
    end if;

    select coalesce(array_agg(field), '{}')
    into v_disallowed_fields
    from unnest(v_changed_fields) as changed(field)
    where field <> all(v_allowed_student_fields);

    if coalesce(array_length(v_disallowed_fields, 1), 0) > 0 then
      raise exception 'Students can only acknowledge or comment on their own training records. Disallowed fields: %', array_to_string(v_disallowed_fields, ', ')
        using errcode = '42501';
    end if;

    if 'status' = any(v_changed_fields)
       and not (
         old.status = 'submitted'
         and new.status in ('submitted', 'locked')
         and coalesce(new.student_ack, false) = true
       ) then
      raise exception 'Students can only lock a submitted record while acknowledging it'
        using errcode = '42501';
    end if;

    if old.student_id is distinct from new.student_id then
      raise exception 'Students cannot move training records between students'
        using errcode = '42501';
    end if;

    if coalesce(old.student_ack, false) = true and coalesce(new.student_ack, false) = false then
      raise exception 'Students cannot remove their acknowledgement from a training record'
        using errcode = '42501';
    end if;

    if coalesce(old.student_ack, false) = false and coalesce(new.student_ack, false) = true then
      v_latest_revision := (
        select entry
        from jsonb_array_elements(case when jsonb_typeof(old.audit_log) = 'array' then old.audit_log else '[]'::jsonb end) as entries(entry)
        where entry->>'action' = 'record_revised_after_student_acknowledgement'
        order by (entry->>'timestamp')::timestamptz desc nulls last
        limit 1
      );

      v_action := case
        when v_latest_revision is null then 'student_acknowledged_record'
        else 'student_acknowledged_revised_record'
      end;

      new.audit_log := (case when jsonb_typeof(old.audit_log) = 'array' then old.audit_log else '[]'::jsonb end)
        || jsonb_build_array(public.training_record_audit_entry(
          v_action,
          case
            when v_latest_revision is null then jsonb_build_object('recordAcknowledged', true)
            else jsonb_build_object(
              'revisedRecordAcknowledged', true,
              'revisionTimestamp', v_latest_revision->>'timestamp'
            )
          end
        ));
    end if;

    return new;
  end if;

  if coalesce(old.student_ack, false) = true then
    select coalesce(array_agg(field), '{}')
    into v_material_fields
    from unnest(v_changed_fields) as changed(field)
    where field not in ('audit_log', 'updated_at');

    if coalesce(array_length(v_material_fields, 1), 0) > 0
       and new.audit_log is not distinct from old.audit_log then
      new.audit_log := (case when jsonb_typeof(old.audit_log) = 'array' then old.audit_log else '[]'::jsonb end)
        || jsonb_build_array(public.training_record_audit_entry(
          'record_revised_after_student_acknowledgement',
          jsonb_build_object(
            'changedFields', to_jsonb(v_material_fields),
            'studentAcknowledgementRequired', true,
            'databaseCaptured', true
          )
        ));
    end if;
  end if;

  return new;
end;
$function$
;
create trigger guard_and_audit_training_record_update before insert or update on training_records for each row execute function public.guard_and_audit_training_record_update();
CREATE OR REPLACE FUNCTION private.validate_course_flight_test_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status <> 'draft'
    AND EXISTS (
      SELECT 1
      FROM public.training_lessons lesson
      WHERE lesson.id = NEW.lesson_id
        AND lesson.course_id = NEW.course_id
        AND lesson.is_flight_test
    )
    AND coalesce(NEW.flight_review_result, 'not_assessed') NOT IN ('pass', 'fail') THEN
    RAISE EXCEPTION 'Select Pass or Further training required before submitting a course flight test';
  END IF;
  RETURN NEW;
END;
$function$
;
create trigger validate_course_flight_test_outcome before insert or update on training_records for each row execute function private.validate_course_flight_test_outcome();
CREATE OR REPLACE FUNCTION private.validate_training_record_formal_findings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(NEW.is_flight_review, false)
    AND NEW.status <> 'draft'
    AND NEW.flight_review_result IN ('fail', 'not_assessed')
    AND nullif(btrim(NEW.flight_review_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Formal findings or required follow-up are required for this flight test outcome';
  END IF;
  RETURN NEW;
END;
$function$
;
create trigger validate_training_record_formal_findings before insert or update on training_records for each row execute function private.validate_training_record_formal_findings();
