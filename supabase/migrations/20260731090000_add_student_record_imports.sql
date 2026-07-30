-- Auditable, tenant-local historical student record imports.
-- Imports deliberately exclude flight_logs so they cannot affect aircraft time,
-- billing, Stripe, prepaid balances, or Xero.

create table if not exists public.student_record_import_batches (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id) on delete cascade,
  record_type text not null check (record_type in ('lesson', 'exam')),
  source_filename text not null,
  status text not null default 'committed' check (status in ('committed', 'rolled_back')),
  total_rows integer not null check (total_rows between 1 and 500),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  imported_by uuid not null references public.users(id),
  imported_at timestamptz not null default now(),
  request_student_acknowledgement boolean not null default false,
  rolled_back_by uuid references public.users(id),
  rolled_back_at timestamptz,
  constraint student_record_import_batches_filename_check
    check (length(btrim(source_filename)) between 1 and 255)
);

create table if not exists public.student_record_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.student_record_import_batches(id) on delete cascade,
  source_row integer not null check (source_row >= 2),
  fingerprint text not null check (length(fingerprint) = 64),
  normalized_data jsonb not null,
  outcome text not null check (outcome in ('imported', 'skipped_duplicate', 'rolled_back')),
  target_table text check (target_table in ('training_records', 'student_exam_results')),
  target_id uuid,
  created_at timestamptz not null default now(),
  unique (batch_id, source_row)
);

create unique index if not exists student_record_import_rows_active_fingerprint_uidx
  on public.student_record_import_rows (fingerprint)
  where outcome = 'imported';

create index if not exists student_record_import_batches_student_idx
  on public.student_record_import_batches (student_id, imported_at desc);

alter table public.training_records
  add column if not exists record_origin text not null default 'portal'
    check (record_origin in ('portal', 'csv_import')),
  add column if not exists import_batch_id uuid references public.student_record_import_batches(id),
  add column if not exists imported_by uuid references public.users(id),
  add column if not exists import_source_row integer,
  add column if not exists source_instructor_name text,
  add column if not exists source_organisation text,
  add column if not exists source_reference text;

alter table public.student_exam_results
  add column if not exists record_origin text not null default 'portal'
    check (record_origin in ('portal', 'csv_import')),
  add column if not exists import_batch_id uuid references public.student_record_import_batches(id),
  add column if not exists imported_by uuid references public.users(id),
  add column if not exists import_source_row integer,
  add column if not exists source_instructor_name text,
  add column if not exists source_organisation text,
  add column if not exists source_reference text;

create index if not exists training_records_import_batch_idx
  on public.training_records (import_batch_id)
  where import_batch_id is not null;

create index if not exists student_exam_results_import_batch_idx
  on public.student_exam_results (import_batch_id)
  where import_batch_id is not null;

create or replace function public.protect_student_record_import_provenance()
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
    or new.source_instructor_name is distinct from old.source_instructor_name
    or new.source_organisation is distinct from old.source_organisation
    or new.source_reference is distinct from old.source_reference
  ) then
    raise exception 'Imported record provenance cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_training_record_import_provenance on public.training_records;
create trigger protect_training_record_import_provenance
before update on public.training_records
for each row execute function public.protect_student_record_import_provenance();

drop trigger if exists protect_exam_result_import_provenance on public.student_exam_results;
create trigger protect_exam_result_import_provenance
before update on public.student_exam_results
for each row execute function public.protect_student_record_import_provenance();

create or replace function public.student_record_import_fingerprint(
  p_student_id uuid,
  p_record_type text,
  p_row jsonb
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(
    concat_ws('|',
      p_student_id::text,
      lower(p_record_type),
      coalesce(p_row->>'date', ''),
      coalesce(p_row->>'course_id', ''),
      coalesce(p_row->>'lesson_id', ''),
      lower(coalesce(p_row->>'lesson_code', '')),
      coalesce(p_row->>'exam_id', ''),
      lower(coalesce(p_row->>'aircraft_registration', '')),
      coalesce(p_row->>'dual_time_min', ''),
      coalesce(p_row->>'solo_time_min', ''),
      coalesce(p_row->>'score', ''),
      coalesce(p_row->>'pass_mark', ''),
      lower(btrim(coalesce(p_row->>'instructor_name', ''))),
      lower(btrim(coalesce(p_row->>'source_organisation', ''))),
      lower(btrim(coalesce(p_row->>'source_reference', ''))),
      lower(btrim(coalesce(p_row->>'notes', '')))
    ),
    'sha256'
  ), 'hex');
$$;

create or replace function public.process_student_record_import(
  p_student_id uuid,
  p_record_type text,
  p_filename text,
  p_rows jsonb,
  p_commit boolean default false,
  p_request_student_acknowledgement boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
  v_row jsonb;
  v_source_row integer;
  v_course_id uuid;
  v_lesson_id uuid;
  v_date date;
  v_dual integer;
  v_solo integer;
  v_score numeric;
  v_pass_mark numeric;
  v_row_errors text[];
  v_errors integer := 0;
  v_duplicates integer := 0;
  v_ready integer := 0;
  v_duplicate boolean;
  v_fingerprint text;
  v_results jsonb := '[]'::jsonb;
  v_batch_id uuid;
  v_target_id uuid;
  v_imported integer := 0;
  v_target_table text;
begin
  if v_actor is null then
    raise exception 'You must be signed in to import student records.';
  end if;
  if not public.current_user_has_staff_role() then
    raise exception 'Only authorised instructors and administrators can import student records.';
  end if;
  if p_record_type not in ('lesson', 'exam') then
    raise exception 'Unsupported student record import type.';
  end if;
  if p_filename is null or length(btrim(p_filename)) not between 1 and 255 then
    raise exception 'A valid source filename is required.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import rows must be a JSON array.';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then
    raise exception 'Import between 1 and 500 records at a time.';
  end if;
  if length(p_rows::text) > 2000000 then
    raise exception 'The import is too large. Keep the CSV below 2 MB.';
  end if;
  if not exists (
    select 1 from public.users
    where id = p_student_id and coalesce(is_active, true)
  ) then
    raise exception 'The selected student could not be found or is inactive.';
  end if;
  if p_commit and v_count > 25 and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'Multi-factor authentication is required to import more than 25 records at once.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_student_id::text || ':' || p_record_type));

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row_errors := array[]::text[];
    v_course_id := null;
    v_lesson_id := null;
    v_date := null;
    v_dual := null;
    v_solo := null;
    v_score := null;
    v_pass_mark := null;
    v_source_row := case
      when coalesce(v_row->>'source_row', '') ~ '^[0-9]+$' then (v_row->>'source_row')::integer
      else 0
    end;

    if v_source_row < 2 then
      v_row_errors := array_append(v_row_errors, 'Source row number is invalid.');
    end if;
    begin
      v_date := (v_row->>'date')::date;
      if v_date > current_date then
        v_row_errors := array_append(v_row_errors, 'Future dates cannot be imported.');
      end if;
    exception when others then
      v_row_errors := array_append(v_row_errors, 'Date is invalid.');
    end;

    select id into v_course_id
    from public.training_courses
    where id::text = coalesce(v_row->>'course_id', '');
    if v_course_id is null then
      v_row_errors := array_append(v_row_errors, 'Course does not exist.');
    end if;
    if length(btrim(coalesce(v_row->>'instructor_name', ''))) = 0 then
      v_row_errors := array_append(v_row_errors, 'Instructor name is required.');
    end if;
    if length(coalesce(v_row->>'instructor_name', '')) > 200
      or length(coalesce(v_row->>'source_organisation', '')) > 200
      or length(coalesce(v_row->>'source_reference', '')) > 200
      or length(coalesce(v_row->>'notes', '')) > 10000 then
      v_row_errors := array_append(v_row_errors, 'One or more text fields exceed the permitted length.');
    end if;

    if p_record_type = 'lesson' then
      select id into v_lesson_id
      from public.training_lessons
      where id::text = coalesce(v_row->>'lesson_id', '')
        and course_id = v_course_id;
      if v_lesson_id is null then
        v_row_errors := array_append(v_row_errors, 'Lesson does not belong to the selected course.');
      end if;
      if coalesce(v_row->>'dual_time_min', '') !~ '^[0-9]+$'
        or coalesce(v_row->>'solo_time_min', '') !~ '^[0-9]+$' then
        v_row_errors := array_append(v_row_errors, 'Dual and solo times must be whole minutes.');
      else
        v_dual := (v_row->>'dual_time_min')::integer;
        v_solo := (v_row->>'solo_time_min')::integer;
        if v_dual + v_solo <= 0 or v_dual > 1440 or v_solo > 1440 then
          v_row_errors := array_append(v_row_errors, 'Lesson time must be greater than zero and no more than 24 hours.');
        end if;
      end if;
      if length(btrim(coalesce(v_row->>'notes', ''))) = 0 then
        v_row_errors := array_append(v_row_errors, 'Lesson comments are required.');
      end if;
    else
      if not exists (
        select 1
        from public.training_courses c,
             jsonb_array_elements(coalesce(c.exam_requirements, '[]'::jsonb)) exam
        where c.id = v_course_id
          and exam->>'id' = coalesce(v_row->>'exam_id', '')
      ) then
        v_row_errors := array_append(v_row_errors, 'Exam does not belong to the selected course.');
      end if;
      begin
        v_score := (v_row->>'score')::numeric;
        v_pass_mark := (v_row->>'pass_mark')::numeric;
        if v_score < 0 or v_score > 100 or v_pass_mark < 0 or v_pass_mark > 100 then
          v_row_errors := array_append(v_row_errors, 'Score and pass mark must be between 0 and 100.');
        end if;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Score and pass mark must be valid numbers.');
      end;
    end if;

    v_fingerprint := public.student_record_import_fingerprint(p_student_id, p_record_type, v_row);
    v_duplicate := exists (
      select 1
      from public.student_record_import_rows
      where fingerprint = v_fingerprint and outcome = 'imported'
    );

    if not v_duplicate and array_length(v_row_errors, 1) is null then
      if p_record_type = 'lesson' then
        v_duplicate := exists (
          select 1 from public.training_records tr
          where tr.student_id = p_student_id
            and tr.date = v_date
            and tr.course_id = v_course_id
            and tr.lesson_id = v_lesson_id
            and tr.dual_time_min = v_dual
            and tr.solo_time_min = v_solo
            and upper(coalesce(tr.registration, '')) = upper(coalesce(v_row->>'aircraft_registration', ''))
            and lower(btrim(tr.comments)) = lower(btrim(coalesce(v_row->>'notes', '')))
        );
      else
        v_duplicate := exists (
          select 1 from public.student_exam_results er
          where er.student_id = p_student_id
            and er.exam_date = v_date
            and er.course_id = v_course_id
            and er.exam_id = v_row->>'exam_id'
            and er.score = v_score
            and er.pass_mark = v_pass_mark
        );
      end if;
    end if;

    if array_length(v_row_errors, 1) is not null then
      v_errors := v_errors + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'error',
        'messages', to_jsonb(v_row_errors)
      ));
    elsif v_duplicate then
      v_duplicates := v_duplicates + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'duplicate',
        'messages', jsonb_build_array('This record already exists and will be skipped.')
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

  if not p_commit or v_errors > 0 then
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
    student_id,
    record_type,
    source_filename,
    total_rows,
    imported_rows,
    duplicate_rows,
    imported_by,
    request_student_acknowledgement
  ) values (
    p_student_id,
    p_record_type,
    btrim(p_filename),
    v_count,
    0,
    v_duplicates,
    v_actor,
    p_request_student_acknowledgement
  )
  returning id into v_batch_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_source_row := (v_row->>'source_row')::integer;
    v_fingerprint := public.student_record_import_fingerprint(p_student_id, p_record_type, v_row);
    v_course_id := (v_row->>'course_id')::uuid;
    v_date := (v_row->>'date')::date;
    v_duplicate := exists (
      select 1
      from public.student_record_import_rows
      where fingerprint = v_fingerprint and outcome = 'imported'
    );

    if not v_duplicate then
      if p_record_type = 'lesson' then
        v_lesson_id := (v_row->>'lesson_id')::uuid;
        v_dual := (v_row->>'dual_time_min')::integer;
        v_solo := (v_row->>'solo_time_min')::integer;
        v_duplicate := exists (
          select 1 from public.training_records tr
          where tr.student_id = p_student_id
            and tr.date = v_date
            and tr.course_id = v_course_id
            and tr.lesson_id = v_lesson_id
            and tr.dual_time_min = v_dual
            and tr.solo_time_min = v_solo
            and upper(coalesce(tr.registration, '')) = upper(coalesce(v_row->>'aircraft_registration', ''))
            and lower(btrim(tr.comments)) = lower(btrim(coalesce(v_row->>'notes', '')))
        );
      else
        v_score := (v_row->>'score')::numeric;
        v_pass_mark := (v_row->>'pass_mark')::numeric;
        v_duplicate := exists (
          select 1 from public.student_exam_results er
          where er.student_id = p_student_id
            and er.exam_date = v_date
            and er.course_id = v_course_id
            and er.exam_id = v_row->>'exam_id'
            and er.score = v_score
            and er.pass_mark = v_pass_mark
        );
      end if;
    end if;

    if v_duplicate then
      insert into public.student_record_import_rows (
        batch_id, source_row, fingerprint, normalized_data, outcome
      ) values (
        v_batch_id, v_source_row, v_fingerprint, v_row, 'skipped_duplicate'
      );
      continue;
    end if;

    if p_record_type = 'lesson' then
      v_target_table := 'training_records';
      insert into public.training_records (
        student_id,
        instructor_id,
        date,
        course_id,
        lesson_id,
        aircraft_type,
        registration,
        dual_time_min,
        solo_time_min,
        comments,
        briefing_comments,
        formal_briefing,
        lesson_codes,
        next_lesson,
        status,
        instructor_sign_timestamp,
        student_ack,
        student_ack_name,
        record_origin,
        import_batch_id,
        imported_by,
        import_source_row,
        source_instructor_name,
        source_organisation,
        source_reference,
        audit_log
      ) values (
        p_student_id,
        v_actor,
        v_date,
        v_course_id,
        (v_row->>'lesson_id')::uuid,
        coalesce(v_row->>'aircraft_type', ''),
        upper(coalesce(v_row->>'aircraft_registration', '')),
        (v_row->>'dual_time_min')::integer,
        (v_row->>'solo_time_min')::integer,
        v_row->>'notes',
        '',
        coalesce((v_row->>'formal_briefing')::boolean, false),
        array[coalesce(v_row->>'lesson_code', v_row->>'lesson_name')],
        nullif(v_row->>'next_lesson', ''),
        case
          when coalesce((v_row->>'student_acknowledged')::boolean, false) then 'locked'
          when p_request_student_acknowledgement then 'submitted'
          else 'locked'
        end,
        now(),
        coalesce((v_row->>'student_acknowledged')::boolean, false),
        case when coalesce((v_row->>'student_acknowledged')::boolean, false)
          then 'Historical acknowledgement (imported)' else null end,
        'csv_import',
        v_batch_id,
        v_actor,
        v_source_row,
        btrim(v_row->>'instructor_name'),
        nullif(btrim(coalesce(v_row->>'source_organisation', '')), ''),
        nullif(btrim(coalesce(v_row->>'source_reference', '')), ''),
        jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid()::text,
          'timestamp', now(),
          'userId', v_actor,
          'userName', 'CSV importer',
          'action', 'Imported historical lesson record',
          'changes', jsonb_build_object('batchId', v_batch_id, 'sourceRow', v_source_row)
        ))
      )
      returning id into v_target_id;
    else
      v_target_table := 'student_exam_results';
      insert into public.student_exam_results (
        student_id,
        course_id,
        exam_id,
        exam_name,
        score,
        pass_mark,
        result,
        exam_date,
        notes,
        instructor_id,
        answer_sheet_only,
        kdr_required,
        kdr_completed,
        kdr_completion_method,
        kdr_signed_off_by,
        kdr_signed_off_at,
        record_origin,
        import_batch_id,
        imported_by,
        import_source_row,
        source_instructor_name,
        source_organisation,
        source_reference
      ) values (
        p_student_id,
        v_course_id,
        v_row->>'exam_id',
        v_row->>'exam_name',
        (v_row->>'score')::numeric,
        (v_row->>'pass_mark')::numeric,
        case when (v_row->>'score')::numeric >= (v_row->>'pass_mark')::numeric then 'pass' else 'fail' end,
        v_date,
        coalesce(v_row->>'notes', ''),
        v_actor,
        true,
        true,
        coalesce((v_row->>'kdr_completed')::boolean, false),
        'verbal',
        case when coalesce((v_row->>'kdr_completed')::boolean, false) then v_actor else null end,
        case when coalesce((v_row->>'kdr_completed')::boolean, false) then now() else null end,
        'csv_import',
        v_batch_id,
        v_actor,
        v_source_row,
        btrim(v_row->>'instructor_name'),
        nullif(btrim(coalesce(v_row->>'source_organisation', '')), ''),
        nullif(btrim(coalesce(v_row->>'source_reference', '')), '')
      )
      returning id into v_target_id;
    end if;

    insert into public.student_record_import_rows (
      batch_id,
      source_row,
      fingerprint,
      normalized_data,
      outcome,
      target_table,
      target_id
    ) values (
      v_batch_id,
      v_source_row,
      v_fingerprint,
      v_row,
      'imported',
      v_target_table,
      v_target_id
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
    'imported_rows', v_imported,
    'duplicate_rows', v_count - v_imported,
    'error_rows', 0
  );
end;
$$;

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
    'deleted_records', v_training_deleted + v_exams_deleted
  );
end;
$$;

alter table public.student_record_import_batches enable row level security;
alter table public.student_record_import_rows enable row level security;

drop policy if exists "Staff can read student import batches" on public.student_record_import_batches;
create policy "Staff can read student import batches"
on public.student_record_import_batches
for select to authenticated
using (public.current_user_has_staff_role());

drop policy if exists "Staff can read student import rows" on public.student_record_import_rows;
create policy "Staff can read student import rows"
on public.student_record_import_rows
for select to authenticated
using (public.current_user_has_staff_role());

revoke all on table public.student_record_import_batches from anon, authenticated;
revoke all on table public.student_record_import_rows from anon, authenticated;
grant select on table public.student_record_import_batches to authenticated;
grant select on table public.student_record_import_rows to authenticated;

revoke all on function public.process_student_record_import(uuid, text, text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.process_student_record_import(uuid, text, text, jsonb, boolean, boolean) to authenticated;
revoke all on function public.rollback_student_record_import(uuid) from public, anon;
grant execute on function public.rollback_student_record_import(uuid) to authenticated;
revoke all on function public.student_record_import_fingerprint(uuid, text, jsonb) from public, anon, authenticated;

comment on function public.process_student_record_import(uuid, text, text, jsonb, boolean, boolean)
is 'Validates or atomically imports historical lesson/exam records with duplicate prevention and immutable provenance. Does not touch flight logs or finance.';
