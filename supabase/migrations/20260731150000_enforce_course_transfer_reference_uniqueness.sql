-- Enforce record-reference uniqueness in the database even when a client bypasses browser validation.

alter function public.process_student_course_record_import(
  uuid, uuid, text, text, text, jsonb, boolean, boolean
) rename to process_student_course_record_import_core;

revoke all on function public.process_student_course_record_import_core(
  uuid, uuid, text, text, text, jsonb, boolean, boolean
) from public, anon, authenticated;

create function public.process_student_course_record_import(
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
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Transfer rows must be a JSON array.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_reference := lower(btrim(coalesce(v_row->>'source_reference', '')));
    if length(v_reference) > 0 and v_reference = any(v_seen_references) then
      v_errors := v_errors + 1;
      v_source_row := case
        when coalesce(v_row->>'source_row', '') ~ '^[0-9]+$' then (v_row->>'source_row')::integer
        else 0
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'source_row', v_source_row,
        'status', 'error',
        'messages', jsonb_build_array('Record references must be unique within the import.')
      ));
    elsif length(v_reference) > 0 then
      v_seen_references := array_append(v_seen_references, v_reference);
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

  return public.process_student_course_record_import_core(
    p_student_id,
    p_course_id,
    p_course_version,
    p_record_type,
    p_filename,
    p_rows,
    p_commit,
    p_request_student_acknowledgement
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
) is 'Rejects duplicate references before invoking the tenant-safe atomic course record and competency transfer core.';
