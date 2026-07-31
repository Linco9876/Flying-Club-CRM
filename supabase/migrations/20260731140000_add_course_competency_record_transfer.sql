-- Course-bound, round-trip student record transfer with atomic competency imports.

alter table public.student_record_import_batches
  add column if not exists course_id uuid references public.training_courses(id) on delete set null,
  add column if not exists course_version text,
  add column if not exists competency_rows integer not null default 0
    check (competency_rows >= 0);

create index if not exists student_record_import_batches_student_course_idx
  on public.student_record_import_batches (student_id, course_id, imported_at desc);

alter table public.student_matrix_assessments
  add column if not exists record_origin text not null default 'portal'
    check (record_origin in ('portal', 'csv_import')),
  add column if not exists import_batch_id uuid references public.student_record_import_batches(id),
  add column if not exists import_source_row integer;

create index if not exists student_matrix_assessments_import_batch_idx
  on public.student_matrix_assessments (import_batch_id)
  where import_batch_id is not null;

create or replace function public.protect_student_matrix_import_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.import_batch_id is not null and (
    new.import_batch_id is distinct from old.import_batch_id
    or new.import_source_row is distinct from old.import_source_row
    or new.record_origin is distinct from old.record_origin
  ) then
    raise exception 'Imported competency provenance cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_student_matrix_import_provenance on public.student_matrix_assessments;
create trigger protect_student_matrix_import_provenance
before update on public.student_matrix_assessments
for each row execute function public.protect_student_matrix_import_provenance();

create or replace function public.process_student_course_record_import(
  p_student_id uuid,
  p_course_id uuid,
  p_course_version text,
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
  v_actual_course_version text;
  v_row jsonb;
  v_competency jsonb;
  v_source_row integer;
  v_lesson_id uuid;
  v_matrix_row_id uuid;
  v_seen_matrix_rows uuid[];
  v_row_errors text[];
  v_errors integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_base_result jsonb;
  v_batch_id uuid;
  v_training_record_id uuid;
  v_competency_count integer := 0;
begin
  if v_actor is null then
    raise exception 'You must be signed in to transfer student records.';
  end if;
  if not public.current_user_has_staff_role() then
    raise exception 'Only authorised instructors and administrators can transfer student records.';
  end if;
  if p_record_type not in ('lesson', 'exam') then
    raise exception 'Unsupported student record transfer type.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Transfer rows must be a JSON array.';
  end if;

  select version into v_actual_course_version
  from public.training_courses
  where id = p_course_id;
  if v_actual_course_version is null then
    raise exception 'The selected course no longer exists.';
  end if;
  if btrim(coalesce(p_course_version, '')) <> btrim(v_actual_course_version) then
    raise exception 'The course version changed. Download a fresh template before importing.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row_errors := array[]::text[];
    v_seen_matrix_rows := array[]::uuid[];
    v_source_row := case
      when coalesce(v_row->>'source_row', '') ~ '^[0-9]+$' then (v_row->>'source_row')::integer
      else 0
    end;

    if coalesce(v_row->>'student_portal_id', '') <> p_student_id::text then
      v_row_errors := array_append(v_row_errors, 'Student identity does not match the open Pilot File.');
    end if;
    if coalesce(v_row->>'course_id', '') <> p_course_id::text then
      v_row_errors := array_append(v_row_errors, 'The row is not for the selected course.');
    end if;
    if btrim(coalesce(v_row->>'course_version', '')) <> btrim(v_actual_course_version) then
      v_row_errors := array_append(v_row_errors, 'The row uses a different course version.');
    end if;
    if length(btrim(coalesce(v_row->>'source_reference', ''))) = 0 then
      v_row_errors := array_append(v_row_errors, 'A record reference is required.');
    end if;

    if p_record_type = 'lesson' then
      begin
        v_lesson_id := (v_row->>'lesson_id')::uuid;
      exception when others then
        v_lesson_id := null;
      end;
      if v_lesson_id is null then
        v_row_errors := array_append(v_row_errors, 'Lesson identity is invalid.');
      end if;

      if v_row ? 'competencies'
        and jsonb_typeof(v_row->'competencies') <> 'array' then
        v_row_errors := array_append(v_row_errors, 'Competency results must be an array.');
      elsif jsonb_array_length(coalesce(v_row->'competencies', '[]'::jsonb)) > 250 then
        v_row_errors := array_append(v_row_errors, 'A lesson cannot contain more than 250 competency results.');
      else
        for v_competency in
          select value from jsonb_array_elements(coalesce(v_row->'competencies', '[]'::jsonb))
        loop
          begin
            v_matrix_row_id := (v_competency->>'matrix_row_id')::uuid;
          exception when others then
            v_matrix_row_id := null;
          end;

          if v_matrix_row_id is null or not exists (
            select 1
            from public.syllabus_matrix_rows mr
            where mr.id = v_matrix_row_id
              and mr.course_id = p_course_id
              and mr.code = coalesce(v_competency->>'code', '')
          ) then
            v_row_errors := array_append(v_row_errors, 'A competency code is invalid for this course.');
          elsif v_matrix_row_id = any(v_seen_matrix_rows) then
            v_row_errors := array_append(v_row_errors, 'A competency code is repeated on the same row.');
          else
            v_seen_matrix_rows := array_append(v_seen_matrix_rows, v_matrix_row_id);
            if exists (
              select 1
              from public.syllabus_matrix_requirements requirement
              where requirement.course_id = p_course_id
                and requirement.matrix_row_id = v_matrix_row_id
            ) and not exists (
              select 1
              from public.syllabus_matrix_requirements requirement
              where requirement.course_id = p_course_id
                and requirement.matrix_row_id = v_matrix_row_id
                and requirement.lesson_id = v_lesson_id
            ) then
              v_row_errors := array_append(
                v_row_errors,
                format('Competency %s is not configured for this lesson.', coalesce(v_competency->>'code', ''))
              );
            end if;
          end if;

          if coalesce(v_competency->>'achieved_standard', '') not in ('1', '2', '3') then
            v_row_errors := array_append(v_row_errors, 'Competency standards must be 1, 2 or 3.');
          end if;
          if length(coalesce(v_competency->>'comments', '')) > 2000 then
            v_row_errors := array_append(v_row_errors, 'Competency comments cannot exceed 2,000 characters.');
          end if;
        end loop;
      end if;
    end if;

    if array_length(v_row_errors, 1) is not null then
      v_errors := v_errors + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'error',
        'messages', to_jsonb(v_row_errors)
      ));
    end if;
  end loop;

  if v_errors > 0 then
    return jsonb_build_object(
      'can_import', false,
      'committed', false,
      'total_rows', jsonb_array_length(p_rows),
      'ready_rows', jsonb_array_length(p_rows) - v_errors,
      'duplicate_rows', 0,
      'error_rows', v_errors,
      'rows', v_results
    );
  end if;

  v_base_result := public.process_student_record_import(
    p_student_id,
    p_record_type,
    p_filename,
    p_rows,
    p_commit,
    p_request_student_acknowledgement
  );

  if not p_commit or not coalesce((v_base_result->>'committed')::boolean, false) then
    return v_base_result || jsonb_build_object(
      'course_id', p_course_id,
      'course_version', v_actual_course_version,
      'competency_rows', 0
    );
  end if;

  v_batch_id := (v_base_result->>'batch_id')::uuid;
  update public.student_record_import_batches
  set course_id = p_course_id,
      course_version = v_actual_course_version
  where id = v_batch_id;

  if p_record_type = 'lesson' then
    for v_row in select value from jsonb_array_elements(p_rows)
    loop
      v_source_row := (v_row->>'source_row')::integer;
      select target_id into v_training_record_id
      from public.student_record_import_rows
      where batch_id = v_batch_id
        and source_row = v_source_row
        and outcome = 'imported'
        and target_table = 'training_records';

      if v_training_record_id is null then
        continue;
      end if;

      for v_competency in
        select value from jsonb_array_elements(coalesce(v_row->'competencies', '[]'::jsonb))
      loop
        insert into public.student_matrix_assessments (
          student_id,
          course_id,
          lesson_id,
          training_record_id,
          matrix_row_id,
          achieved_standard,
          comments,
          instructor_id,
          assessed_at,
          record_origin,
          import_batch_id,
          import_source_row
        ) values (
          p_student_id,
          p_course_id,
          (v_row->>'lesson_id')::uuid,
          v_training_record_id,
          (v_competency->>'matrix_row_id')::uuid,
          (v_competency->>'achieved_standard')::integer,
          coalesce(v_competency->>'comments', ''),
          v_actor,
          (v_row->>'date')::date,
          'csv_import',
          v_batch_id,
          v_source_row
        );
        v_competency_count := v_competency_count + 1;
      end loop;
    end loop;
  end if;

  update public.student_record_import_batches
  set competency_rows = v_competency_count
  where id = v_batch_id;

  return v_base_result || jsonb_build_object(
    'course_id', p_course_id,
    'course_version', v_actual_course_version,
    'competency_rows', v_competency_count
  );
end;
$$;

revoke all on function public.process_student_course_record_import(
  uuid, uuid, text, text, text, jsonb, boolean, boolean
) from public, anon;
grant execute on function public.process_student_course_record_import(
  uuid, uuid, text, text, text, jsonb, boolean, boolean
) to authenticated;

comment on function public.process_student_course_record_import(
  uuid, uuid, text, text, text, jsonb, boolean, boolean
) is 'Atomically validates and transfers course-version-bound student lesson/exam data, including applicable competency results, without creating operational or financial records.';
