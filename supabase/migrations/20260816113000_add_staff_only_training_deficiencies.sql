create table if not exists public.training_deficiencies (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id) on delete cascade,
  course_id uuid not null references public.training_courses(id) on delete cascade,
  source_lesson_id uuid references public.training_lessons(id) on delete set null,
  source_training_record_id uuid references public.training_records(id) on delete set null,
  stage text not null check (stage in ('pre_solo', 'pre_test')),
  description text not null check (char_length(btrim(description)) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  client_reference uuid not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_training_record_id uuid references public.training_records(id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  constraint training_deficiencies_resolution_state check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or
    (status = 'resolved' and resolved_at is not null and resolved_by is not null)
  ),
  unique (created_by, client_reference)
);

create index if not exists training_deficiencies_open_gate_idx
  on public.training_deficiencies(student_id, course_id, stage)
  where status = 'open';

create index if not exists training_deficiencies_source_record_idx
  on public.training_deficiencies(source_training_record_id)
  where source_training_record_id is not null;

alter table public.training_deficiencies enable row level security;

revoke all on table public.training_deficiencies from public, anon, authenticated;
grant select on table public.training_deficiencies to authenticated;
grant all on table public.training_deficiencies to service_role;

drop policy if exists "Staff can read training deficiencies" on public.training_deficiencies;
create policy "Staff can read training deficiencies"
on public.training_deficiencies
for select
to authenticated
using (
  public.current_user_has_staff_role()
  or exists (
    select 1
    from public.user_roles role_assignment
    where role_assignment.user_id = (select auth.uid())
      and role_assignment.role = 'cfi'
  )
  or exists (
    select 1
    from public.users portal_user
    where portal_user.id = (select auth.uid())
      and portal_user.role = 'cfi'
  )
);

create or replace function private.touch_training_deficiency_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_training_deficiency_updated_at() from public, anon, authenticated;
grant execute on function private.touch_training_deficiency_updated_at() to service_role;

drop trigger if exists touch_training_deficiency_updated_at on public.training_deficiencies;
create trigger touch_training_deficiency_updated_at
before update on public.training_deficiencies
for each row execute function private.touch_training_deficiency_updated_at();

create or replace function public.apply_training_deficiency_changes(
  p_training_record_id uuid,
  p_new_deficiencies jsonb default '[]'::jsonb,
  p_resolved_deficiency_ids uuid[] default array[]::uuid[],
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_record public.training_records%rowtype;
  v_is_service_role boolean := coalesce(auth.role(), '') = 'service_role';
  v_can_manage boolean := false;
  v_inserted integer := 0;
  v_resolved integer := 0;
begin
  if p_training_record_id is null then
    raise exception 'A training record is required';
  end if;

  select * into v_record
  from public.training_records
  where id = p_training_record_id;

  if not found then
    raise exception 'Training record not found';
  end if;

  if v_is_service_role then
    v_actor_id := coalesce(v_record.instructor_id, v_record.student_id);
    v_can_manage := true;
  elsif v_actor_id is not null then
    v_can_manage := public.current_user_has_staff_role()
      or exists (
        select 1 from public.user_roles role_assignment
        where role_assignment.user_id = v_actor_id and role_assignment.role = 'cfi'
      )
      or exists (
        select 1 from public.users portal_user
        where portal_user.id = v_actor_id and portal_user.role = 'cfi'
      );
  end if;

  if not v_can_manage then
    raise exception 'Only instructors, CFI users and administrators can manage training deficiencies';
  end if;

  if not v_is_service_role
    and v_record.instructor_id <> v_actor_id
    and not public.current_user_is_admin()
    and not exists (
      select 1 from public.user_roles role_assignment
      where role_assignment.user_id = v_actor_id and role_assignment.role = 'cfi'
    )
    and not exists (
      select 1 from public.users portal_user
      where portal_user.id = v_actor_id and portal_user.role = 'cfi'
    ) then
    raise exception 'You are not authorised to change deficiencies for this training record';
  end if;

  if jsonb_typeof(coalesce(p_new_deficiencies, '[]'::jsonb)) <> 'array' then
    raise exception 'New deficiencies must be supplied as an array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_new_deficiencies, '[]'::jsonb)) item
    where item->>'stage' not in ('pre_solo', 'pre_test')
      or char_length(btrim(coalesce(item->>'description', ''))) not between 3 and 2000
      or (
        nullif(item->>'clientReference', '') is not null
        and not (item->>'clientReference' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      )
  ) then
    raise exception 'Each deficiency needs a valid stage, client reference and description';
  end if;

  with incoming as (
    select
      nullif(item->>'clientReference', '')::uuid as client_reference,
      case item->>'stage'
        when 'pre_solo' then 'pre_solo'
        when 'pre_test' then 'pre_test'
        else null
      end as stage,
      nullif(btrim(item->>'description'), '') as description
    from jsonb_array_elements(coalesce(p_new_deficiencies, '[]'::jsonb)) item
  ), inserted as (
    insert into public.training_deficiencies (
      student_id,
      course_id,
      source_lesson_id,
      source_training_record_id,
      stage,
      description,
      client_reference,
      created_by
    )
    select
      v_record.student_id,
      v_record.course_id,
      v_record.lesson_id,
      v_record.id,
      incoming.stage,
      incoming.description,
      coalesce(incoming.client_reference, gen_random_uuid()),
      v_actor_id
    from incoming
    where incoming.stage is not null
      and char_length(incoming.description) between 3 and 2000
    on conflict (created_by, client_reference) do update set
      source_training_record_id = excluded.source_training_record_id,
      source_lesson_id = excluded.source_lesson_id,
      description = excluded.description,
      stage = excluded.stage,
      updated_at = now()
    returning id
  )
  select count(*) into v_inserted from inserted;

  if cardinality(coalesce(p_resolved_deficiency_ids, array[]::uuid[])) > 0 then
    if v_record.status = 'draft' then
      raise exception 'Submit the lesson record before marking deficiencies as fixed';
    end if;

    update public.training_deficiencies deficiency
    set status = 'resolved',
        resolved_by = v_actor_id,
        resolved_at = now(),
        resolution_training_record_id = v_record.id,
        resolution_note = nullif(btrim(p_resolution_note), '')
    where deficiency.id = any(p_resolved_deficiency_ids)
      and deficiency.student_id = v_record.student_id
      and deficiency.course_id = v_record.course_id
      and deficiency.status = 'open';
    get diagnostics v_resolved = row_count;
  end if;

  return jsonb_build_object(
    'createdOrUpdated', v_inserted,
    'resolved', v_resolved,
    'trainingRecordId', v_record.id
  );
end;
$$;

revoke all on function public.apply_training_deficiency_changes(uuid, jsonb, uuid[], text) from public, anon;
grant execute on function public.apply_training_deficiency_changes(uuid, jsonb, uuid[], text) to authenticated, service_role;

create or replace function private.enforce_training_deficiency_gate()
returns trigger
language plpgsql
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

revoke all on function private.enforce_training_deficiency_gate() from public, anon, authenticated;
grant execute on function private.enforce_training_deficiency_gate() to service_role;

drop trigger if exists enforce_training_deficiency_gate on public.training_records;
create trigger enforce_training_deficiency_gate
before insert or update of status, student_id, course_id, lesson_id
on public.training_records
for each row execute function private.enforce_training_deficiency_gate();

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values (
  'public.apply_training_deficiency_changes(p_training_record_id uuid, p_new_deficiencies jsonb, p_resolved_deficiency_ids uuid[], p_resolution_note text)',
  'apply_training_deficiency_changes',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Instructor-only idempotent deficiency creation and resolution tied to an authorised training record. Students have no table read policy.',
  date '2026-08-16'
)
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

select private.assert_function_permission_manifest();

comment on table public.training_deficiencies is
  'Structured instructor-only training deficiencies. Students cannot select these rows; lesson comments and grades remain student-visible through training_records.';

comment on column public.training_deficiencies.stage is
  'pre_solo blocks solo gate lessons; pre_test blocks course flight-test or review gate lessons until separately resolved.';
