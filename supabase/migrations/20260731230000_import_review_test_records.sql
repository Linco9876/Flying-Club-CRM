-- Version-bound CSV transfer for flight reviews, flight tests and proficiency checks.
-- Imported records remain operationally isolated: they do not create bookings,
-- flight logs, aircraft time, billing, Stripe or Xero activity.

-- Two published RPC gate lessons pre-dated the course-level Circuits criterion.
-- Explicitly assess it at command standard so exports contain a complete NC/S/C matrix.
update public.training_lessons lesson
set pass_marks = coalesce(lesson.pass_marks, '{}'::jsonb) || '{"circuits":"C"}'::jsonb
from public.training_courses course
where lesson.course_id = course.id
  and course.title = 'RAAus Ab-Initio'
  and lesson.sequence_code in ('RPC-CONSOL', 'RPC-FLT-TEST')
  and not coalesce(lesson.pass_marks, '{}'::jsonb) ? 'circuits';

alter table public.student_record_import_batches
  drop constraint if exists student_record_import_batches_record_type_check;
alter table public.student_record_import_batches
  add constraint student_record_import_batches_record_type_check
  check (record_type in ('lesson', 'exam', 'review'));

alter table public.student_record_import_rows
  drop constraint if exists student_record_import_rows_target_table_check;
alter table public.student_record_import_rows
  add constraint student_record_import_rows_target_table_check
  check (target_table in ('training_records', 'student_exam_results', 'flight_review_records'));

alter table public.flight_review_records
  add column if not exists record_origin text not null default 'portal'
    check (record_origin in ('portal', 'csv_import')),
  add column if not exists import_batch_id uuid references public.student_record_import_batches(id),
  add column if not exists imported_by uuid references public.users(id),
  add column if not exists import_source_row integer,
  add column if not exists source_reference text;

create index if not exists flight_review_records_import_batch_idx
  on public.flight_review_records (import_batch_id)
  where import_batch_id is not null;

create or replace function public.protect_flight_review_import_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.import_batch_id is not null and (
    new.import_batch_id is distinct from old.import_batch_id
    or new.imported_by is distinct from old.imported_by
    or new.import_source_row is distinct from old.import_source_row
    or new.record_origin is distinct from old.record_origin
    or new.source_reference is distinct from old.source_reference
  ) then
    raise exception 'Imported review provenance cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_flight_review_import_provenance on public.flight_review_records;
create trigger protect_flight_review_import_provenance
before update on public.flight_review_records
for each row execute function public.protect_flight_review_import_provenance();

create or replace function public.process_student_review_record_import(
  p_student_id uuid,
  p_course_id uuid,
  p_course_version text,
  p_filename text,
  p_rows jsonb,
  p_commit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_course public.training_courses%rowtype;
  v_count integer;
  v_row jsonb;
  v_item jsonb;
  v_result jsonb;
  v_source_row integer;
  v_row_errors text[];
  v_errors integer := 0;
  v_duplicates integer := 0;
  v_ready integer := 0;
  v_duplicate boolean;
  v_fingerprint text;
  v_results jsonb := '[]'::jsonb;
  v_batch_id uuid;
  v_record_id uuid;
  v_imported integer := 0;
  v_status text;
  v_ground integer;
  v_flight integer;
  v_required_evidence integer;
  v_outcome text;
begin
  if v_actor is null then
    raise exception 'You must be signed in to transfer review records.';
  end if;
  if not public.current_user_has_staff_role() then
    raise exception 'Only authorised instructors and administrators can transfer review records.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Transfer rows must be a JSON array.';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then
    raise exception 'A review transfer must contain between 1 and 500 records.';
  end if;
  if length(btrim(coalesce(p_filename, ''))) not between 1 and 255 then
    raise exception 'Source filename must contain between 1 and 255 characters.';
  end if;
  if v_count > 25 and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'Multi-factor authentication is required to import more than 25 review records.';
  end if;

  select * into v_course from public.training_courses where id = p_course_id;
  if v_course.id is null then
    raise exception 'The selected course no longer exists.';
  end if;
  if v_course.course_purpose not in ('flight_review', 'flight_test', 'proficiency_check') then
    raise exception 'Choose a review, test or proficiency-check course.';
  end if;
  if btrim(coalesce(p_course_version, '')) <> btrim(v_course.version) then
    raise exception 'The course version changed. Download a fresh template before importing.';
  end if;

  v_required_evidence := jsonb_array_length(coalesce(v_course.review_configuration->'required_evidence', '[]'::jsonb));

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row_errors := array[]::text[];
    v_source_row := case
      when coalesce(v_row->>'source_row', '') ~ '^[0-9]+$' then (v_row->>'source_row')::integer
      else 0
    end;
    v_status := coalesce(v_row->>'status', '');
    v_ground := case when coalesce(v_row->>'ground_time_min', '') ~ '^[0-9]+$'
      then (v_row->>'ground_time_min')::integer else -1 end;
    v_flight := case when coalesce(v_row->>'flight_time_min', '') ~ '^[0-9]+$'
      then (v_row->>'flight_time_min')::integer else -1 end;

    if coalesce(v_row->>'student_portal_id', '') <> p_student_id::text then
      v_row_errors := array_append(v_row_errors, 'Student identity does not match the open Pilot File.');
    end if;
    if coalesce(v_row->>'course_id', '') <> p_course_id::text then
      v_row_errors := array_append(v_row_errors, 'The row is not for the selected course.');
    end if;
    if btrim(coalesce(v_row->>'course_version', '')) <> btrim(v_course.version) then
      v_row_errors := array_append(v_row_errors, 'The row uses a different course version.');
    end if;
    if coalesce(v_row->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      v_row_errors := array_append(v_row_errors, 'Review date is invalid.');
    end if;
    if v_status not in ('draft', 'in_progress', 'further_training_required', 'completed', 'cancelled') then
      v_row_errors := array_append(v_row_errors, 'Review status is invalid.');
    end if;
    if length(btrim(coalesce(v_row->>'instructor_name', ''))) = 0 then
      v_row_errors := array_append(v_row_errors, 'Reviewer name is required.');
    end if;
    if length(btrim(coalesce(v_row->>'source_reference', ''))) = 0 then
      v_row_errors := array_append(v_row_errors, 'A record reference is required.');
    end if;
    if v_ground < 0 or v_ground > 1440 or v_flight < 0 or v_flight > 1440 then
      v_row_errors := array_append(v_row_errors, 'Review ground and flight time must each be between 0 and 1,440 minutes.');
    end if;
    if jsonb_typeof(coalesce(v_row->'checklist_results', '[]'::jsonb)) <> 'array' then
      v_row_errors := array_append(v_row_errors, 'Checklist results must be an array.');
    elsif jsonb_array_length(coalesce(v_row->'checklist_results', '[]'::jsonb))
      <> jsonb_array_length(coalesce(v_course.review_configuration->'checklist', '[]'::jsonb)) then
      v_row_errors := array_append(v_row_errors, 'Checklist results do not match this course version.');
    elsif exists (
      select 1
      from jsonb_array_elements(coalesce(v_row->'checklist_results', '[]'::jsonb)) result
      left join jsonb_array_elements(coalesce(v_course.review_configuration->'checklist', '[]'::jsonb)) item
        on item->>'key' = result->>'key'
      where item is null
    ) or exists (
      select 1
      from jsonb_array_elements(coalesce(v_row->'checklist_results', '[]'::jsonb)) result
      group by result->>'key'
      having count(*) > 1
    ) then
      v_row_errors := array_append(v_row_errors, 'Checklist results contain an unknown or repeated item.');
    else
      for v_item in select value from jsonb_array_elements(coalesce(v_course.review_configuration->'checklist', '[]'::jsonb))
      loop
        select value into v_result
        from jsonb_array_elements(coalesce(v_row->'checklist_results', '[]'::jsonb))
        where value->>'key' = v_item->>'key'
        limit 1;
        if v_result is null then
          v_row_errors := array_append(v_row_errors, format('Checklist item %s is missing.', coalesce(v_item->>'code', v_item->>'key')));
        else
          v_outcome := coalesce(v_result->>'result', '');
          if v_outcome not in ('not_assessed', 'satisfactory', 'further_training', 'not_applicable') then
            v_row_errors := array_append(v_row_errors, format('Checklist result for %s is invalid.', coalesce(v_item->>'code', v_item->>'key')));
          elsif v_status = 'completed'
            and coalesce((v_item->>'required')::boolean, true)
            and v_outcome not in ('satisfactory', 'not_applicable') then
            v_row_errors := array_append(v_row_errors, format('Checklist item %s is incomplete.', coalesce(v_item->>'code', v_item->>'key')));
          end if;
          if length(coalesce(v_result->>'notes', '')) > 4000 then
            v_row_errors := array_append(v_row_errors, format('Checklist notes for %s exceed 4,000 characters.', coalesce(v_item->>'code', v_item->>'key')));
          end if;
        end if;
        v_result := null;
      end loop;
    end if;

    if v_status = 'completed' then
      if v_required_evidence > 0 and length(btrim(coalesce(v_row->>'evidence_reference', ''))) = 0 then
        v_row_errors := array_append(v_row_errors, 'Evidence reference is required for this completed review.');
      end if;
      if coalesce((v_course.review_configuration->>'requires_reviewer_summary')::boolean, false)
        and length(btrim(coalesce(v_row->>'reviewer_summary', ''))) = 0 then
        v_row_errors := array_append(v_row_errors, 'Reviewer summary is required for this completed review.');
      end if;
      if coalesce((v_course.review_configuration->>'requires_logbook_confirmation')::boolean, false)
        and not coalesce((v_row->>'logbook_entry_confirmed')::boolean, false) then
        v_row_errors := array_append(v_row_errors, 'Logbook confirmation is required for this completed review.');
      end if;
      if coalesce((v_course.review_configuration->>'requires_authority_submission_confirmation')::boolean, false)
        and not coalesce((v_row->>'authority_submission_confirmed')::boolean, false) then
        v_row_errors := array_append(v_row_errors, 'Authority submission confirmation is required for this completed review.');
      end if;
      if coalesce((v_course.review_configuration->>'candidate_ack_required')::boolean, false)
        and not coalesce((v_row->>'student_acknowledged')::boolean, false) then
        v_row_errors := array_append(v_row_errors, 'Candidate acknowledgement is required for this completed review.');
      end if;
      if (
        v_ground < coalesce((v_course.review_configuration->>'minimum_ground_minutes')::integer, 0)
        or v_flight < coalesce((v_course.review_configuration->>'minimum_flight_minutes')::integer, 0)
      ) and length(btrim(coalesce(v_row->>'minimums_override_reason', ''))) = 0 then
        v_row_errors := array_append(v_row_errors, 'A minimums override reason is required.');
      end if;
    end if;

    if array_length(v_row_errors, 1) is not null then
      v_errors := v_errors + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'error',
        'messages', to_jsonb(v_row_errors)
      ));
      continue;
    end if;

    v_fingerprint := public.student_record_import_fingerprint(p_student_id, 'review', v_row);
    v_duplicate := exists (
      select 1 from public.student_record_import_rows
      where fingerprint = v_fingerprint and outcome = 'imported'
    ) or exists (
      select 1 from public.flight_review_records record
      where record.candidate_id = p_student_id
        and record.template_course_id = p_course_id
        and lower(btrim(coalesce(record.source_reference, ''))) =
            lower(btrim(coalesce(v_row->>'source_reference', '')))
    );
    if v_duplicate then
      v_duplicates := v_duplicates + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'duplicate',
        'messages', jsonb_build_array('This review record already exists and will be skipped.')
      ));
    else
      v_ready := v_ready + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'ready',
        'messages', '[]'::jsonb
      ));
    end if;
  end loop;

  if v_errors > 0 or not p_commit then
    return jsonb_build_object(
      'can_import', v_errors = 0,
      'committed', false,
      'total_rows', v_count,
      'ready_rows', v_ready,
      'duplicate_rows', v_duplicates,
      'error_rows', v_errors,
      'rows', v_results
    );
  end if;

  insert into public.student_record_import_batches (
    student_id, record_type, source_filename, total_rows, imported_rows,
    duplicate_rows, imported_by, request_student_acknowledgement,
    course_id, course_version
  ) values (
    p_student_id, 'review', btrim(p_filename), v_count, 0,
    v_duplicates, v_actor, false, p_course_id, v_course.version
  ) returning id into v_batch_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_source_row := (v_row->>'source_row')::integer;
    v_fingerprint := public.student_record_import_fingerprint(p_student_id, 'review', v_row);
    v_duplicate := exists (
      select 1 from public.student_record_import_rows
      where fingerprint = v_fingerprint and outcome = 'imported'
    ) or exists (
      select 1 from public.flight_review_records record
      where record.candidate_id = p_student_id
        and record.template_course_id = p_course_id
        and lower(btrim(coalesce(record.source_reference, ''))) =
            lower(btrim(coalesce(v_row->>'source_reference', '')))
    );
    if v_duplicate then
      insert into public.student_record_import_rows (
        batch_id, source_row, fingerprint, normalized_data, outcome
      ) values (
        v_batch_id, v_source_row, v_fingerprint, v_row, 'skipped_duplicate'
      );
      continue;
    end if;

    insert into public.flight_review_records (
      template_course_id, template_snapshot, candidate_id,
      reviewer_user_id, external_examiner_name, external_examiner_identifier,
      external_examiner_organisation, review_type, authority, status,
      review_date, completion_date, aircraft_type, registration, aircraft_group,
      ground_minutes, flight_minutes, candidate_objectives, assessment_details,
      emergency_plan_confirmed, reviewer_summary, remedial_plan,
      minimums_override_reason, logbook_entry_confirmed,
      authority_submission_confirmed, candidate_ack, candidate_ack_name,
      candidate_ack_at, reviewer_sign_name, reviewer_sign_at, next_review_due,
      created_by, updated_by, record_origin, import_batch_id, imported_by,
      import_source_row, source_reference
    ) values (
      p_course_id,
      jsonb_build_object(
        'title', v_course.title,
        'version', v_course.version,
        'course_purpose', v_course.course_purpose,
        'review_configuration', v_course.review_configuration,
        'captured_at', now(),
        'imported_historical_record', true
      ),
      p_student_id,
      null,
      btrim(v_row->>'instructor_name'),
      nullif(btrim(coalesce(v_row->>'reviewer_identifier', '')), ''),
      nullif(btrim(coalesce(v_row->>'source_organisation', '')), ''),
      v_course.review_configuration->>'review_type',
      coalesce(v_course.review_configuration->>'authority', 'club'),
      v_row->>'status',
      (v_row->>'date')::date,
      case when v_row->>'status' = 'completed' then (v_row->>'date')::date else null end,
      coalesce(v_row->>'aircraft_type', ''),
      upper(coalesce(v_row->>'aircraft_registration', '')),
      nullif(btrim(coalesce(v_row->>'aircraft_group', '')), ''),
      (v_row->>'ground_time_min')::integer,
      (v_row->>'flight_time_min')::integer,
      coalesce(v_row->>'candidate_objectives', ''),
      jsonb_build_object(
        'historicalEvidenceReference', coalesce(v_row->>'evidence_reference', ''),
        'importBatchId', v_batch_id,
        'importSourceRow', v_source_row
      ),
      coalesce((v_row->>'emergency_plan_confirmed')::boolean, false),
      coalesce(v_row->>'reviewer_summary', ''),
      coalesce(v_row->>'remedial_plan', ''),
      coalesce(v_row->>'minimums_override_reason', ''),
      coalesce((v_row->>'logbook_entry_confirmed')::boolean, false),
      coalesce((v_row->>'authority_submission_confirmed')::boolean, false),
      coalesce((v_row->>'student_acknowledged')::boolean, false),
      case when coalesce((v_row->>'student_acknowledged')::boolean, false)
        then 'Historical acknowledgement (imported)' else null end,
      case when coalesce((v_row->>'student_acknowledged')::boolean, false) then now() else null end,
      case when v_row->>'status' in ('completed', 'further_training_required')
        then btrim(v_row->>'instructor_name') || ' (historical import)' else null end,
      case when v_row->>'status' in ('completed', 'further_training_required') then now() else null end,
      nullif(v_row->>'next_review_due', '')::date,
      v_actor, v_actor, 'csv_import', v_batch_id, v_actor,
      v_source_row, btrim(v_row->>'source_reference')
    )
    returning id into v_record_id;

    for v_item in
      select entry.value || jsonb_build_object('sort_order', (entry.ordinality - 1) * 10)
      from jsonb_array_elements(coalesce(v_course.review_configuration->'checklist', '[]'::jsonb))
        with ordinality as entry(value, ordinality)
    loop
      select value into v_result
      from jsonb_array_elements(coalesce(v_row->'checklist_results', '[]'::jsonb))
      where value->>'key' = v_item->>'key'
      limit 1;
      insert into public.flight_review_record_items (
        review_record_id, template_item_key, section, code, title, guidance,
        required, result, notes, sort_order
      ) values (
        v_record_id,
        v_item->>'key',
        coalesce(v_item->>'section', ''),
        coalesce(v_item->>'code', ''),
        coalesce(v_item->>'title', ''),
        coalesce(v_item->>'guidance', ''),
        coalesce((v_item->>'required')::boolean, true),
        v_result->>'result',
        coalesce(v_result->>'notes', ''),
        coalesce((v_item->>'sort_order')::integer, 0)
      );
      v_result := null;
    end loop;

    insert into public.student_record_import_rows (
      batch_id, source_row, fingerprint, normalized_data, outcome,
      target_table, target_id
    ) values (
      v_batch_id, v_source_row, v_fingerprint, v_row, 'imported',
      'flight_review_records', v_record_id
    );
    v_imported := v_imported + 1;
  end loop;

  update public.student_record_import_batches
  set imported_rows = v_imported
  where id = v_batch_id;

  return jsonb_build_object(
    'can_import', true,
    'committed', true,
    'batch_id', v_batch_id,
    'total_rows', v_count,
    'ready_rows', v_imported,
    'imported_rows', v_imported,
    'duplicate_rows', v_count - v_imported,
    'error_rows', 0
  );
end;
$$;

revoke all on function public.process_student_review_record_import(
  uuid, uuid, text, text, jsonb, boolean
) from public, anon;
grant execute on function public.process_student_review_record_import(
  uuid, uuid, text, text, jsonb, boolean
) to authenticated;

comment on function public.process_student_review_record_import(
  uuid, uuid, text, text, jsonb, boolean
) is 'Previews and atomically imports version-bound historical review/test records with checklist results, idempotency, provenance and no operational or financial side effects.';

create or replace function public.rollback_student_record_import(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.student_record_import_batches%rowtype;
  v_training_deleted integer := 0;
  v_exams_deleted integer := 0;
  v_reviews_deleted integer := 0;
begin
  if v_actor is null or not public.current_user_is_admin() then
    raise exception 'Only an administrator can undo a student record import.';
  end if;
  if coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'Multi-factor authentication is required to undo an import.';
  end if;

  select * into v_batch
  from public.student_record_import_batches
  where id = p_batch_id
  for update;

  if v_batch.id is null then
    raise exception 'Import batch not found.';
  end if;
  if v_batch.status = 'rolled_back' then
    return jsonb_build_object('rolled_back', true, 'already_rolled_back', true);
  end if;

  delete from public.training_records where import_batch_id = p_batch_id;
  get diagnostics v_training_deleted = row_count;
  delete from public.student_exam_results where import_batch_id = p_batch_id;
  get diagnostics v_exams_deleted = row_count;
  delete from public.flight_review_records where import_batch_id = p_batch_id;
  get diagnostics v_reviews_deleted = row_count;

  update public.student_record_import_rows
  set outcome = 'rolled_back'
  where batch_id = p_batch_id and outcome = 'imported';

  update public.student_record_import_batches
  set status = 'rolled_back',
      rolled_back_by = v_actor,
      rolled_back_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'rolled_back', true,
    'already_rolled_back', false,
    'deleted_records', v_training_deleted + v_exams_deleted + v_reviews_deleted
  );
end;
$$;

revoke all on function public.rollback_student_record_import(uuid) from public, anon;
grant execute on function public.rollback_student_record_import(uuid) to authenticated;

-- Refuse the release if any currently published course is structurally unable
-- to produce a complete, readable and version-bound transfer template.
do $$
declare
  v_issues text;
begin
  with issues as (
    select course.title || ': training course has no lessons' issue
    from public.training_courses course
    where course.status = 'published'
      and course.course_purpose = 'training'
      and not exists (
        select 1 from public.training_lessons lesson where lesson.course_id = course.id
      )
    union all
    select course.title || ': add course objectives and evaluation criteria'
    from public.training_courses course
    where course.status = 'published'
      and course.course_purpose = 'training'
      and (
        coalesce(cardinality(course.objectives), 0) = 0
        or coalesce(cardinality(course.evaluation_criteria), 0) = 0
      )
    union all
    select course.title || ': incomplete lesson ' || coalesce(lesson.sequence_code, lesson.name, lesson.id::text)
    from public.training_courses course
    join public.training_lessons lesson on lesson.course_id = course.id
    where course.status = 'published'
      and course.course_purpose = 'training'
      and (
        nullif(btrim(lesson.name), '') is null
        or nullif(btrim(lesson.sequence_code), '') is null
        or nullif(btrim(lesson.sequence_title), '') is null
        or nullif(btrim(lesson.objective), '') is null
        or lesson.duration_minutes <= 0
        or coalesce(array_length(lesson.key_exercises, 1), 0) = 0
        or nullif(btrim(lesson.student_preparation), '') is null
        or nullif(btrim(lesson.instructor_notes), '') is null
        or nullif(btrim(lesson.theory), '') is null
        or nullif(btrim(lesson.flight_exercises), '') is null
        or exists (
          select 1
          from jsonb_array_elements(coalesce(course.assessment_criteria, '[]'::jsonb)) criterion
          where not coalesce(lesson.pass_marks, '{}'::jsonb) ? (criterion->>'id')
        )
      )
    union all
    select course.title || ': incomplete review/test configuration'
    from public.training_courses course
    where course.status = 'published'
      and course.course_purpose <> 'training'
      and (
        jsonb_array_length(coalesce(course.review_configuration->'checklist', '[]'::jsonb)) = 0
        or jsonb_array_length(coalesce(course.review_configuration->'source_documents', '[]'::jsonb)) = 0
        or jsonb_array_length(coalesce(course.review_configuration->'allowed_reviewer_roles', '[]'::jsonb)) = 0
      )
    union all
    select course.title || ': incomplete checklist item ' || coalesce(item->>'code', item->>'key', 'unknown')
    from public.training_courses course
    cross join lateral jsonb_array_elements(
      coalesce(course.review_configuration->'checklist', '[]'::jsonb)
    ) item
    where course.status = 'published'
      and course.course_purpose <> 'training'
      and (
        nullif(btrim(item->>'key'), '') is null
        or nullif(btrim(item->>'code'), '') is null
        or nullif(btrim(item->>'section'), '') is null
        or nullif(btrim(item->>'title'), '') is null
        or nullif(btrim(item->>'guidance'), '') is null
      )
  )
  select string_agg(issue, '; ' order by issue) into v_issues from issues;

  if v_issues is not null then
    raise exception 'Published course quality audit failed: %', v_issues;
  end if;
end;
$$;
