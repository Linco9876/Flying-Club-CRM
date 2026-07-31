-- Keep RAAus syllabus codes stable while giving every RPC lesson a plain-English name.

do $$
declare
  v_course_id uuid;
  v_mapping record;
  v_lesson_id uuid;
  v_updated integer;
begin
  select id into v_course_id
  from public.training_courses
  where title = 'RAAus Ab-Initio'
  order by created_at
  limit 1;

  if v_course_id is null then
    raise exception 'RAAus Ab-Initio training course was not found';
  end if;

  for v_mapping in
    select *
    from (values
      ('TIF', 'Trial Instruction Flight'),
      ('1.01-3', 'Effects of Controls'),
      ('1.01-4', 'Straight and Level'),
      ('1.01-5', 'Climbing and Descending'),
      ('1.01-6', 'Medium, Climbing and Descending Turns'),
      ('1.01-7', 'Slow Flight and Basic Stalls'),
      ('1.01-8.1/8.3', 'Circuit Introduction'),
      ('1.01-8.6', 'Flapless Circuits and Missed Approaches'),
      ('1.01-8.5', 'Circuit Emergencies'),
      ('SOLO-1', 'Circuit Consolidation and Supervised Solo'),
      ('1.01-6A', 'Advanced Turns'),
      ('1.01-7S', 'Scenario-Based Stalls'),
      ('1.01-10 / 2.04', 'Training Area Operations and Radio Procedures'),
      ('1.01-9.2/9.3', 'Forced Landings, Glide Approaches and Sideslip Awareness'),
      ('1.01-9.4', 'Precautionary Search and Landing'),
      ('1.01-11', 'Abnormal Situations and Emergency Management'),
      ('RPC-CONSOL', 'RPC Consolidation and Flight Test Profile Practice'),
      ('RPC-REVIEW', 'CFI Recommendation and Pilot Certificate Readiness Review'),
      ('RPC-FLT-TEST', 'Pilot Certificate Flight Test')
    ) as readable(sequence_code, title)
  loop
    update public.training_lessons
    set name = v_mapping.title,
        sequence_title = v_mapping.title
    where course_id = v_course_id
      and sequence_code = v_mapping.sequence_code
    returning id into v_lesson_id;

    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Expected exactly one RPC lesson for code %, found %', v_mapping.sequence_code, v_updated;
    end if;

    update public.syllabus_matrix_requirements
    set lesson_column_title = v_mapping.title
    where course_id = v_course_id
      and lesson_id = v_lesson_id;
  end loop;

  update public.training_courses
  set last_updated = now()
  where id = v_course_id;
end;
$$;
