-- Require complete assessments and support both single- and multiple-choice
-- automatic grading. Answers remain graded inside Postgres so a browser cannot
-- award its own score.

create or replace function public.submit_learning_quiz(
  p_step_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_step public.learning_program_steps;
  v_question jsonb;
  v_question_id text;
  v_question_type text;
  v_expected text;
  v_answer text;
  v_expected_values text[];
  v_answer_values text[];
  v_total integer := 0;
  v_correct integer := 0;
  v_score integer;
  v_passed boolean;
  v_user_id uuid := auth.uid();
begin
  v_step := public.assert_learning_step_access(p_step_id, true);
  if v_step.step_type <> 'quiz' then
    raise exception 'This learning step is not a quiz';
  end if;
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'Quiz answers must be an object';
  end if;

  for v_question in
    select value from jsonb_array_elements(v_step.quiz_questions)
  loop
    v_question_id := v_question ->> 'id';
    v_question_type := coalesce(v_question ->> 'type', '');

    if coalesce((v_question ->> 'required')::boolean, false)
      and v_question_type not in ('heading', 'text')
      and (
        not (p_answers ? v_question_id)
        or jsonb_typeof(p_answers -> v_question_id) = 'null'
        or (
          jsonb_typeof(p_answers -> v_question_id) = 'string'
          and btrim(p_answers ->> v_question_id) = ''
        )
        or (
          jsonb_typeof(p_answers -> v_question_id) = 'array'
          and jsonb_array_length(p_answers -> v_question_id) = 0
        )
      )
    then
      raise exception 'Answer every required question before submitting';
    end if;

    if v_question ? 'correctAnswer'
      and v_question_type in ('single_choice', 'image_choice', 'short_answer', 'number')
    then
      v_total := v_total + 1;
      v_expected := lower(btrim(v_question ->> 'correctAnswer'));
      v_answer := lower(btrim(coalesce(p_answers ->> v_question_id, '')));
      if v_answer = v_expected then
        v_correct := v_correct + 1;
      end if;
    elsif v_question ? 'correctAnswer'
      and v_question_type = 'multiple_choice'
      and jsonb_typeof(p_answers -> v_question_id) = 'array'
    then
      v_total := v_total + 1;
      if jsonb_typeof(v_question -> 'correctAnswer') = 'array' then
        select array_agg(lower(btrim(value)) order by lower(btrim(value)))
        into v_expected_values
        from jsonb_array_elements_text(v_question -> 'correctAnswer');
      else
        select array_agg(lower(btrim(value)) order by lower(btrim(value)))
        into v_expected_values
        from unnest(string_to_array(v_question ->> 'correctAnswer', ',')) as value;
      end if;
      select array_agg(lower(btrim(value)) order by lower(btrim(value)))
      into v_answer_values
      from jsonb_array_elements_text(p_answers -> v_question_id);
      if coalesce(v_answer_values, array[]::text[]) = coalesce(v_expected_values, array[]::text[]) then
        v_correct := v_correct + 1;
      end if;
    end if;
  end loop;

  if v_total = 0 then
    raise exception 'This quiz has no automatically gradable questions';
  end if;
  v_score := round((v_correct::numeric / v_total::numeric) * 100);
  v_passed := v_score >= coalesce(v_step.passing_score_percent, 80);

  insert into public.learning_step_progress(
    program_id, step_id, user_id, status, video_watch_percent,
    quiz_score_percent, quiz_answers, completed_at, updated_at
  ) values (
    v_step.program_id, v_step.id, v_user_id,
    case when v_passed then 'completed' else 'in_progress' end,
    0, v_score, p_answers,
    case when v_passed then now() else null end,
    now()
  )
  on conflict (step_id, user_id) do update
  set status = excluded.status,
      quiz_score_percent = excluded.quiz_score_percent,
      quiz_answers = excluded.quiz_answers,
      completed_at = case
        when excluded.status = 'completed'
          then coalesce(public.learning_step_progress.completed_at, now())
        else null
      end,
      updated_at = now();

  if v_passed then
    perform public.refresh_learning_program_completion(v_step.program_id, v_user_id);
  end if;

  return jsonb_build_object(
    'scorePercent', v_score,
    'passingScorePercent', coalesce(v_step.passing_score_percent, 80),
    'passed', v_passed,
    'correctCount', v_correct,
    'questionCount', v_total
  );
end;
$$;

revoke all on function public.submit_learning_quiz(uuid, jsonb) from public, anon;
grant execute on function public.submit_learning_quiz(uuid, jsonb) to authenticated, service_role;
