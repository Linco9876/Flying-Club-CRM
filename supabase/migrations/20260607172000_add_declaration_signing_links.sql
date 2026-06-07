/*
  Add secure one-time declaration signing links.

  Students and parents/guardians can sign course declarations from a tokenised
  public link. The token table stores only a SHA-256 hash of the raw token.
*/

create extension if not exists pgcrypto;

create table if not exists public.declaration_signing_tokens (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.student_course_enrolments(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('student', 'guardian')),
  delivery_method text not null default 'email' check (delivery_method in ('email', 'sms', 'manual')),
  token_hash text not null unique,
  recipient_email text,
  recipient_phone text,
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz,
  sent_at timestamptz,
  send_error text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.declaration_signing_tokens enable row level security;

create index if not exists idx_declaration_signing_tokens_enrolment
  on public.declaration_signing_tokens(enrolment_id);

create index if not exists idx_declaration_signing_tokens_token_hash
  on public.declaration_signing_tokens(token_hash)
  where used_at is null;

drop policy if exists "Staff can read declaration signing tokens" on public.declaration_signing_tokens;
create policy "Staff can read declaration signing tokens"
  on public.declaration_signing_tokens for select to authenticated
  using (
    exists (
      select 1 from public.users
      where id = (select auth.uid())
        and role in ('admin', 'instructor', 'senior_instructor')
    )
    or exists (
      select 1 from public.user_roles
      where user_id = (select auth.uid())
        and role in ('admin', 'instructor', 'senior_instructor')
    )
  );

grant select on table public.declaration_signing_tokens to authenticated;

create or replace function public.get_declaration_signing_request(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token public.declaration_signing_tokens%rowtype;
  v_result jsonb;
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('valid', false, 'error', 'Invalid signing link');
  end if;

  select *
  into v_token
  from public.declaration_signing_tokens
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    return jsonb_build_object('valid', false, 'error', 'Invalid signing link');
  end if;

  if v_token.used_at is not null then
    return jsonb_build_object('valid', false, 'error', 'This signing link has already been used');
  end if;

  if v_token.expires_at < now() then
    return jsonb_build_object('valid', false, 'error', 'This signing link has expired');
  end if;

  select jsonb_build_object(
    'valid', true,
    'tokenId', v_token.id,
    'recipientType', v_token.recipient_type,
    'expiresAt', v_token.expires_at,
    'enrolmentId', sce.id,
    'courseId', tc.id,
    'courseTitle', tc.title,
    'studentId', u.id,
    'studentName', u.name,
    'studentEmail', u.email,
    'studentDateOfBirth', coalesce(u.date_of_birth, s.date_of_birth),
    'memberNumber', s.raaus_id,
    'studentDeclarationTitle', tc.flying_declaration_title,
    'studentDeclarationText', tc.flying_declaration_text,
    'guardianDeclarationTitle', tc.guardian_declaration_title,
    'guardianDeclarationText', tc.guardian_declaration_text,
    'declarationVersion', tc.flying_declaration_version,
    'studentSigned', sce.declaration_signed_at is not null
      and coalesce(sce.declaration_version, 0) >= coalesce(tc.flying_declaration_version, 1),
    'guardianSigned', sce.guardian_declaration_signed_at is not null
      and coalesce(sce.guardian_declaration_version, 0) >= coalesce(tc.flying_declaration_version, 1),
    'guardianRequired', coalesce(tc.requires_guardian_declaration_for_minors, true)
      and coalesce(u.date_of_birth, s.date_of_birth) is not null
      and (coalesce(u.date_of_birth, s.date_of_birth) + interval '18 years')::date > current_date,
    'recipientEmail', v_token.recipient_email,
    'recipientPhone', v_token.recipient_phone
  )
  into v_result
  from public.student_course_enrolments sce
  join public.training_courses tc on tc.id = sce.course_id
  join public.users u on u.id = sce.student_id
  left join public.students s on s.id = sce.student_id
  where sce.id = v_token.enrolment_id
    and coalesce(tc.requires_flying_declaration, false) = true;

  if v_result is null then
    return jsonb_build_object('valid', false, 'error', 'Declaration is no longer required');
  end if;

  return v_result;
end;
$$;

create or replace function public.sign_course_declaration_with_token(
  p_token text,
  p_signature_name text,
  p_member_number text default null,
  p_guardian_relationship text default null,
  p_guardian_email text default null,
  p_guardian_phone text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token public.declaration_signing_tokens%rowtype;
  v_enrolment public.student_course_enrolments%rowtype;
  v_course public.training_courses%rowtype;
  v_now timestamptz := now();
  v_name text := trim(coalesce(p_signature_name, ''));
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('success', false, 'error', 'Invalid signing link');
  end if;

  if v_name = '' then
    return jsonb_build_object('success', false, 'error', 'Signature name is required');
  end if;

  select *
  into v_token
  from public.declaration_signing_tokens
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid signing link');
  end if;

  if v_token.used_at is not null then
    return jsonb_build_object('success', false, 'error', 'This signing link has already been used');
  end if;

  if v_token.expires_at < v_now then
    return jsonb_build_object('success', false, 'error', 'This signing link has expired');
  end if;

  select * into v_enrolment
  from public.student_course_enrolments
  where id = v_token.enrolment_id
  for update;

  select * into v_course
  from public.training_courses
  where id = v_enrolment.course_id;

  if not coalesce(v_course.requires_flying_declaration, false) then
    return jsonb_build_object('success', false, 'error', 'Declaration is no longer required');
  end if;

  if v_token.recipient_type = 'student' then
    update public.student_course_enrolments
    set
      declaration_signed_at = v_now,
      declaration_signed_name = v_name,
      declaration_member_number = nullif(trim(coalesce(p_member_number, '')), ''),
      declaration_text_snapshot = v_course.flying_declaration_text,
      declaration_version = coalesce(v_course.flying_declaration_version, 1),
      updated_at = v_now
    where id = v_token.enrolment_id;
  elsif v_token.recipient_type = 'guardian' then
    if trim(coalesce(p_guardian_relationship, '')) = '' then
      return jsonb_build_object('success', false, 'error', 'Parent/guardian relationship is required');
    end if;

    update public.student_course_enrolments
    set
      guardian_declaration_signed_at = v_now,
      guardian_declaration_signed_name = v_name,
      guardian_declaration_relationship = trim(p_guardian_relationship),
      guardian_declaration_email = coalesce(nullif(trim(coalesce(p_guardian_email, '')), ''), v_token.recipient_email, guardian_declaration_email),
      guardian_declaration_phone = coalesce(nullif(trim(coalesce(p_guardian_phone, '')), ''), v_token.recipient_phone, guardian_declaration_phone),
      guardian_declaration_text_snapshot = v_course.guardian_declaration_text,
      guardian_declaration_version = coalesce(v_course.flying_declaration_version, 1),
      updated_at = v_now
    where id = v_token.enrolment_id;
  end if;

  update public.declaration_signing_tokens
  set
    used_at = v_now,
    metadata = metadata || jsonb_build_object(
      'signedUserAgent', nullif(left(coalesce(p_user_agent, ''), 500), ''),
      'signedAt', v_now
    )
  where id = v_token.id;

  return jsonb_build_object(
    'success', true,
    'recipientType', v_token.recipient_type,
    'signedAt', v_now
  );
end;
$$;

revoke execute on function public.get_declaration_signing_request(text) from public;
revoke execute on function public.sign_course_declaration_with_token(text, text, text, text, text, text, text) from public;

grant execute on function public.get_declaration_signing_request(text) to anon, authenticated;
grant execute on function public.sign_course_declaration_with_token(text, text, text, text, text, text, text) to anon, authenticated;
