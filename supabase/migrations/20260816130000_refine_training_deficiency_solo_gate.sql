-- A pre-solo assessment is where an instructor can demonstrate that a
-- deficiency has been corrected. Only an actual solo lesson should be gated.
create or replace function private.enforce_training_deficiency_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

comment on function private.enforce_training_deficiency_gate() is
  'Blocks actual solo and explicit flight-test records while the course has unresolved required deficiencies; pre-solo assessments remain available to resolve them.';
