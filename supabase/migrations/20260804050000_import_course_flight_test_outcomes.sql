-- Course lesson CSVs can contain a course-defined flight test. The live lesson
-- editor already collects its outcome, but the historical importer previously
-- inserted a locked record without supplying the same mandatory fields.
-- Validate the outcome in the public import wrapper, then hydrate the row inside
-- the same transaction before the existing flight-test guard and sync triggers.

create or replace function private.hydrate_imported_course_flight_test_outcome()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rows_text text;
  v_rows jsonb;
  v_import_row jsonb;
begin
  if new.record_origin <> 'csv_import' or new.import_source_row is null then
    return new;
  end if;

  v_rows_text := current_setting('app.course_record_import_rows', true);
  if nullif(v_rows_text, '') is null then
    return new;
  end if;

  begin
    v_rows := v_rows_text::jsonb;
  exception when others then
    raise exception 'The protected course import context is invalid.';
  end;

  select import_row.value
  into v_import_row
  from jsonb_array_elements(v_rows) import_row(value)
  where coalesce(import_row.value->>'source_row', '') = new.import_source_row::text
  limit 1;

  if v_import_row is null then
    return new;
  end if;

  if exists (
    select 1
    from public.training_lessons lesson
    where lesson.id = new.lesson_id
      and lesson.course_id = new.course_id
      and lesson.is_flight_test
  ) then
    new.is_flight_review := true;
    new.flight_review_type := coalesce(
      nullif(btrim(v_import_row->>'flight_review_type'), ''),
      'Flight Test'
    );
    new.flight_review_result := nullif(btrim(v_import_row->>'flight_review_result'), '');
    new.flight_review_notes := coalesce(v_import_row->>'flight_review_notes', '');
  end if;

  return new;
end;
$$;

revoke all on function private.hydrate_imported_course_flight_test_outcome()
  from public, anon, authenticated;
grant execute on function private.hydrate_imported_course_flight_test_outcome()
  to service_role;

drop trigger if exists hydrate_imported_course_flight_test_outcome on public.training_records;
create trigger hydrate_imported_course_flight_test_outcome
before insert on public.training_records
for each row
execute function private.hydrate_imported_course_flight_test_outcome();

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
  v_row jsonb;
  v_reference text;
  v_seen_references text[] := array[]::text[];
  v_source_row integer;
  v_results jsonb := '[]'::jsonb;
  v_errors integer := 0;
  v_criterion_id text;
  v_grade text;
  v_grading_system text;
  v_core_result jsonb;
  v_batch_id uuid;
  v_criteria_count integer := 0;
  v_lesson_is_flight_test boolean;
  v_flight_test_result text;
  v_flight_test_findings text;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Transfer rows must be a JSON array.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_source_row := case
      when coalesce(v_row->>'source_row', '') ~ '^[0-9]+$' then (v_row->>'source_row')::integer
      else 0
    end;
    v_reference := lower(btrim(coalesce(v_row->>'source_reference', '')));

    if length(v_reference) > 0 and v_reference = any(v_seen_references) then
      v_errors := v_errors + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'error',
        'messages', jsonb_build_array('Record references must be unique within the import.')
      ));
    elsif length(v_reference) > 0 then
      v_seen_references := array_append(v_seen_references, v_reference);
    end if;

    if p_record_type = 'lesson' then
      v_lesson_is_flight_test := false;
      select lesson.is_flight_test
      into v_lesson_is_flight_test
      from public.training_lessons lesson
      where lesson.id::text = coalesce(v_row->>'lesson_id', '')
        and lesson.course_id = p_course_id;

      v_flight_test_result := lower(btrim(coalesce(v_row->>'flight_review_result', '')));
      v_flight_test_findings := btrim(coalesce(v_row->>'flight_review_notes', ''));

      if coalesce(v_lesson_is_flight_test, false) then
        if v_flight_test_result not in ('pass', 'fail') then
          v_errors := v_errors + 1;
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'source_row', v_source_row,
            'status', 'error',
            'messages', jsonb_build_array('Select Pass or Further training required for this imported course flight test.')
          ));
        elsif v_flight_test_result = 'fail' and length(v_flight_test_findings) = 0 then
          v_errors := v_errors + 1;
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'source_row', v_source_row,
            'status', 'error',
            'messages', jsonb_build_array('Record the required further training or formal findings for this flight test.')
          ));
        end if;
      elsif v_flight_test_result not in ('', 'not_assessed')
        or length(v_flight_test_findings) > 0 then
        v_errors := v_errors + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'source_row', v_source_row,
          'status', 'error',
          'messages', jsonb_build_array('Flight test outcome fields can only be used for a lesson marked as a flight test.')
        ));
      end if;
    end if;

    if p_record_type <> 'lesson' and v_row ? 'criteria_grades'
      and (select count(*) from jsonb_object_keys(coalesce(v_row->'criteria_grades', '{}'::jsonb))) > 0 then
      v_errors := v_errors + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'error',
        'messages', jsonb_build_array('Course criteria can only be attached to lesson records.')
      ));
      continue;
    end if;

    if p_record_type = 'lesson' and v_row ? 'criteria_grades' then
      if jsonb_typeof(v_row->'criteria_grades') <> 'object' then
        v_errors := v_errors + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'source_row', v_source_row,
          'status', 'error',
          'messages', jsonb_build_array('Course criteria grades must be an object.')
        ));
        continue;
      end if;

      if (select count(*) from jsonb_object_keys(v_row->'criteria_grades')) > 100 then
        v_errors := v_errors + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'source_row', v_source_row,
          'status', 'error',
          'messages', jsonb_build_array('A lesson cannot contain more than 100 course criteria grades.')
        ));
        continue;
      end if;

      for v_criterion_id, v_grade in
        select key, value
        from jsonb_each_text(v_row->'criteria_grades')
      loop
        v_grading_system := null;
        select criterion->>'gradingSystem'
        into v_grading_system
        from public.training_courses course,
          jsonb_array_elements(coalesce(course.assessment_criteria, '[]'::jsonb)) criterion
        where course.id = p_course_id
          and criterion->>'id' = v_criterion_id
        limit 1;

        if v_grading_system is null then
          v_errors := v_errors + 1;
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'source_row', v_source_row,
            'status', 'error',
            'messages', jsonb_build_array(format('Criterion %s is not configured for this course.', v_criterion_id))
          ));
          continue;
        end if;

        if (v_grading_system = 'NC/S/C/-' and v_grade not in ('NC', 'S', 'C', '-'))
          or (v_grading_system = 'Pass or Fail' and v_grade not in ('Pass', 'Fail', '-'))
          or (v_grading_system = 'Out of 100' and v_grade <> '-'
            and (v_grade !~ '^(100(?:[.]0+)?|[0-9]{1,2}(?:[.][0-9]+)?)$'
              or v_grade::numeric < 0 or v_grade::numeric > 100)) then
          v_errors := v_errors + 1;
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'source_row', v_source_row,
            'status', 'error',
            'messages', jsonb_build_array(format('Grade %s is not valid for criterion %s.', v_grade, v_criterion_id))
          ));
        end if;
      end loop;
    end if;
  end loop;

  if v_errors > 0 then
    return jsonb_build_object(
      'can_import', false,
      'committed', false,
      'total_rows', jsonb_array_length(p_rows),
      'ready_rows', greatest(jsonb_array_length(p_rows) - v_errors, 0),
      'duplicate_rows', 0,
      'error_rows', v_errors,
      'rows', v_results
    );
  end if;

  -- Transaction-local context read only by the private BEFORE INSERT trigger.
  -- The wrapper has validated these values before the core function writes.
  perform set_config('app.course_record_import_rows', p_rows::text, true);

  v_core_result := public.process_student_course_record_import_core(
    p_student_id,
    p_course_id,
    p_course_version,
    p_record_type,
    p_filename,
    p_rows,
    p_commit,
    p_request_student_acknowledgement
  );

  if not p_commit or not coalesce((v_core_result->>'committed')::boolean, false)
    or p_record_type <> 'lesson' then
    return v_core_result;
  end if;

  v_batch_id := (v_core_result->>'batch_id')::uuid;

  update public.training_records record
  set criteria_grades = coalesce(import_row.normalized_data->'criteria_grades', '{}'::jsonb)
  from public.student_record_import_rows import_row
  where import_row.batch_id = v_batch_id
    and import_row.outcome = 'imported'
    and import_row.target_table = 'training_records'
    and import_row.target_id = record.id;

  select coalesce(sum(criteria.grade_count), 0)::integer
  into v_criteria_count
  from public.student_record_import_rows import_row
  cross join lateral (
    select count(*) as grade_count
    from jsonb_object_keys(coalesce(import_row.normalized_data->'criteria_grades', '{}'::jsonb))
  ) criteria
  where import_row.batch_id = v_batch_id
    and import_row.outcome = 'imported'
    and import_row.target_table = 'training_records';

  update public.student_record_import_batches
  set competency_rows = competency_rows + v_criteria_count
  where id = v_batch_id;

  return v_core_result || jsonb_build_object(
    'competency_rows',
    coalesce((v_core_result->>'competency_rows')::integer, 0) + v_criteria_count
  );
end;
$$;

revoke all on function public.process_student_course_record_import(
  uuid, uuid, text, text, text, jsonb, boolean, boolean
) from public, anon;
grant execute on function public.process_student_course_record_import(
  uuid, uuid, text, text, text, jsonb, boolean, boolean
) to authenticated, service_role;

comment on function public.process_student_course_record_import(
  uuid, uuid, text, text, text, jsonb, boolean, boolean
) is 'Validates and imports version-bound course records, including mandatory course flight-test outcomes and formal findings.';

select private.assert_function_permission_manifest();
