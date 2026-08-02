create table if not exists public.training_record_acknowledgement_tokens (
  id uuid primary key default gen_random_uuid(),
  training_record_id uuid not null references public.training_records(id) on delete cascade,
  student_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  recipient_email text not null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz,
  superseded_at timestamptz,
  sent_at timestamptz,
  send_error text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint training_record_ack_token_hash_length check (length(token_hash) = 64)
);

create index if not exists idx_training_record_ack_tokens_record
  on public.training_record_acknowledgement_tokens(training_record_id, created_at desc);

create index if not exists idx_training_record_ack_tokens_active
  on public.training_record_acknowledgement_tokens(token_hash)
  where used_at is null and superseded_at is null;

alter table public.training_record_acknowledgement_tokens enable row level security;
revoke all on table public.training_record_acknowledgement_tokens from anon, authenticated;
grant all on table public.training_record_acknowledgement_tokens to service_role;

create or replace function public.get_training_record_acknowledgement(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token public.training_record_acknowledgement_tokens%rowtype;
  v_result jsonb;
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('valid', false, 'error', 'Invalid lesson approval link');
  end if;

  select * into v_token
  from public.training_record_acknowledgement_tokens
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    return jsonb_build_object('valid', false, 'error', 'Invalid lesson approval link');
  end if;
  if v_token.used_at is not null then
    return jsonb_build_object('valid', false, 'error', 'This lesson record has already been approved');
  end if;
  if v_token.superseded_at is not null then
    return jsonb_build_object('valid', false, 'error', 'This lesson record was updated. Please use the newest email link');
  end if;
  if v_token.expires_at < now() then
    return jsonb_build_object('valid', false, 'error', 'This lesson approval link has expired');
  end if;

  select jsonb_build_object(
    'valid', true,
    'expiresAt', v_token.expires_at,
    'recordId', r.id,
    'studentName', student.name,
    'instructorName', instructor.name,
    'courseTitle', coalesce(nullif(course.title, ''), 'Flight training'),
    'lessonTitle', coalesce(nullif(lesson.name, ''), nullif(lesson.sequence_title, ''), nullif(lesson.sequence_code, ''), 'Flight lesson'),
    'lessonCode', coalesce(nullif(lesson.sequence_code, ''), array_to_string(r.lesson_codes, ', '), ''),
    'lessonDate', r.date,
    'aircraftType', r.aircraft_type,
    'registration', r.registration,
    'dualTimeMin', r.dual_time_min,
    'soloTimeMin', r.solo_time_min,
    'comments', r.comments,
    'formalBriefing', r.formal_briefing,
    'briefingComments', case when r.formal_briefing then r.briefing_comments else '' end,
    'nextLesson', r.next_lesson,
    'criteriaGrades', r.criteria_grades,
    'courseCriteria', coalesce(course.assessment_criteria, '[]'::jsonb),
    'sequenceResults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', sr.sequence_code,
        'title', sr.sequence_title,
        'competence', sr.competence
      ) order by sr.sequence_code, sr.sequence_title)
      from public.training_sequence_results sr
      where sr.training_record_id = r.id
    ), '[]'::jsonb),
    'isFlightReview', r.is_flight_review,
    'reviewType', r.flight_review_type,
    'reviewResult', r.flight_review_result,
    'formalFindings', r.flight_review_notes
  ) into v_result
  from public.training_records r
  join public.users student on student.id = r.student_id
  join public.users instructor on instructor.id = r.instructor_id
  left join public.training_courses course on course.id = r.course_id
  left join public.training_lessons lesson on lesson.id = r.lesson_id
  where r.id = v_token.training_record_id
    and r.student_id = v_token.student_id
    and r.status = 'submitted'
    and coalesce(r.student_ack, false) = false;

  if v_result is null then
    return jsonb_build_object('valid', false, 'error', 'This lesson record no longer requires approval');
  end if;

  return v_result;
end;
$$;

create or replace function public.acknowledge_training_record_with_token(
  p_token text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token public.training_record_acknowledgement_tokens%rowtype;
  v_record public.training_records%rowtype;
  v_student_name text;
  v_lock_after_ack boolean := true;
  v_now timestamptz := now();
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('success', false, 'error', 'Invalid lesson approval link');
  end if;

  select * into v_token
  from public.training_record_acknowledgement_tokens
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid lesson approval link');
  end if;
  if v_token.used_at is not null then
    return jsonb_build_object('success', false, 'error', 'This lesson record has already been approved');
  end if;
  if v_token.superseded_at is not null then
    return jsonb_build_object('success', false, 'error', 'This lesson record was updated. Please use the newest email link');
  end if;
  if v_token.expires_at < v_now then
    return jsonb_build_object('success', false, 'error', 'This lesson approval link has expired');
  end if;

  select * into v_record
  from public.training_records
  where id = v_token.training_record_id
    and student_id = v_token.student_id
  for update;

  if not found or v_record.status <> 'submitted' or coalesce(v_record.student_ack, false) then
    return jsonb_build_object('success', false, 'error', 'This lesson record no longer requires approval');
  end if;

  select coalesce(nullif(name, ''), nullif(email, ''), 'Student') into v_student_name
  from public.users
  where id = v_record.student_id;

  select coalesce(lock_record_after_student_ack, true) into v_lock_after_ack
  from public.training_syllabus_settings
  limit 1;
  v_lock_after_ack := coalesce(v_lock_after_ack, true);

  -- Present the token holder to the existing training-record guard as the record's
  -- student for this transaction only. The guard still restricts the update to the
  -- established acknowledgement fields and writes the normal student audit event.
  perform set_config('request.jwt.claim.sub', v_record.student_id::text, true);

  update public.training_records
  set
    student_ack = true,
    student_ack_name = v_student_name,
    student_ack_timestamp = v_now,
    status = case when v_lock_after_ack then 'locked' else 'submitted' end
  where id = v_record.id;

  update public.training_record_acknowledgement_tokens
  set
    used_at = v_now,
    metadata = metadata || jsonb_build_object(
      'approvedAt', v_now,
      'approvedUserAgent', nullif(left(coalesce(p_user_agent, ''), 500), '')
    )
  where id = v_token.id;

  update public.training_record_acknowledgement_tokens
  set superseded_at = v_now
  where training_record_id = v_record.id
    and id <> v_token.id
    and used_at is null
    and superseded_at is null;

  return jsonb_build_object('success', true, 'approvedAt', v_now, 'recordId', v_record.id);
end;
$$;

revoke all on function public.get_training_record_acknowledgement(text) from public;
grant execute on function public.get_training_record_acknowledgement(text) to anon, authenticated, service_role;

revoke all on function public.acknowledge_training_record_with_token(text, text) from public;
grant execute on function public.acknowledge_training_record_with_token(text, text) to anon, authenticated, service_role;

comment on table public.training_record_acknowledgement_tokens is
  'One-time, revocable email links that expose only one submitted lesson record for student acknowledgement.';
