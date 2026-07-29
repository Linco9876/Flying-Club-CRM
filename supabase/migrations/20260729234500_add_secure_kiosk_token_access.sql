create table if not exists public.kiosk_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token_prefix text not null,
  token_hash text not null unique,
  token_ciphertext text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null
);

create unique index if not exists kiosk_access_tokens_one_active_idx
  on public.kiosk_access_tokens ((true))
  where revoked_at is null;

create index if not exists kiosk_access_tokens_hash_active_idx
  on public.kiosk_access_tokens (token_hash)
  where revoked_at is null;

create table if not exists public.kiosk_access_sessions (
  id uuid primary key default gen_random_uuid(),
  access_token_id uuid not null references public.kiosk_access_tokens(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  session_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists kiosk_access_sessions_active_hash_idx
  on public.kiosk_access_sessions (session_hash, expires_at)
  where revoked_at is null;

create index if not exists kiosk_access_sessions_token_idx
  on public.kiosk_access_sessions (access_token_id, created_at desc);

comment on table public.kiosk_access_tokens is
  'Encrypted, revocable kiosk access keys. Plaintext is only returned by the MFA-protected kiosk access Edge Function.';
comment on table public.kiosk_access_sessions is
  'Revocable kiosk browser grants linked to the access key that created them.';

alter table public.kiosk_access_tokens enable row level security;
alter table public.kiosk_access_sessions enable row level security;

revoke all on table public.kiosk_access_tokens from public, anon, authenticated;
revoke all on table public.kiosk_access_sessions from public, anon, authenticated;
grant all on table public.kiosk_access_tokens to service_role;
grant all on table public.kiosk_access_sessions to service_role;

create or replace function public.rotate_kiosk_access_token_internal(
  p_token_prefix text,
  p_token_hash text,
  p_token_ciphertext text,
  p_actor_user_id uuid
) returns table(id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role access is required';
  end if;

  update public.kiosk_access_sessions s
  set revoked_at = v_now
  where s.revoked_at is null
    and exists (
      select 1
      from public.kiosk_access_tokens t
      where t.id = s.access_token_id
        and t.revoked_at is null
    );

  update public.kiosk_access_tokens
  set revoked_at = v_now,
      revoked_by = p_actor_user_id
  where revoked_at is null;

  return query
  insert into public.kiosk_access_tokens (
    token_prefix,
    token_hash,
    token_ciphertext,
    created_by
  )
  values (
    p_token_prefix,
    p_token_hash,
    p_token_ciphertext,
    p_actor_user_id
  )
  returning kiosk_access_tokens.id, kiosk_access_tokens.created_at;
end;
$$;

create or replace function public.disable_kiosk_access_internal(
  p_actor_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role access is required';
  end if;

  update public.kiosk_access_sessions s
  set revoked_at = v_now
  where s.revoked_at is null
    and exists (
      select 1
      from public.kiosk_access_tokens t
      where t.id = s.access_token_id
        and t.revoked_at is null
    );

  update public.kiosk_access_tokens
  set revoked_at = v_now,
      revoked_by = p_actor_user_id
  where revoked_at is null;
end;
$$;

revoke all on function public.rotate_kiosk_access_token_internal(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.disable_kiosk_access_internal(uuid) from public, anon, authenticated;
grant execute on function public.rotate_kiosk_access_token_internal(text, text, text, uuid) to service_role;
grant execute on function public.disable_kiosk_access_internal(uuid) to service_role;
