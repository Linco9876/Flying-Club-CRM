create table if not exists public.integration_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  is_active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint integration_api_keys_name_check check (length(trim(name)) between 3 and 80)
);

create table if not exists public.integration_api_request_log (
  id bigint generated always as identity primary key,
  api_key_id uuid not null references public.integration_api_keys(id) on delete cascade,
  method text not null,
  path text not null,
  response_status integer not null,
  occurred_at timestamptz not null default now()
);
create index if not exists integration_api_request_log_rate_idx on public.integration_api_request_log(api_key_id, occurred_at desc);

create table if not exists public.integration_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  subscribed_events text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  constraint integration_webhook_endpoint_https check (url ~ '^https://[^[:space:]]+$')
);

-- Deliberately has no authenticated policy. Only service-role workers and the
-- SECURITY DEFINER creation RPC can access signing material.
create table if not exists public.integration_webhook_secrets (
  endpoint_id uuid primary key references public.integration_webhook_endpoints(id) on delete cascade,
  signing_secret text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  subject_id text,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  expanded_at timestamptz
);
create index if not exists integration_webhook_events_pending_idx on public.integration_webhook_events(occurred_at) where expanded_at is null;

create table if not exists public.integration_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.integration_webhook_endpoints(id) on delete cascade,
  event_id uuid not null references public.integration_webhook_events(id) on delete cascade,
  attempt_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'delivering', 'succeeded', 'failed', 'abandoned')),
  next_attempt_at timestamptz not null default now(),
  response_status integer,
  response_excerpt text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(endpoint_id, event_id)
);
create index if not exists integration_webhook_deliveries_retry_idx
  on public.integration_webhook_deliveries(next_attempt_at)
  where status in ('pending', 'failed');

alter table public.integration_api_keys enable row level security;
alter table public.integration_api_request_log enable row level security;
alter table public.integration_webhook_endpoints enable row level security;
alter table public.integration_webhook_secrets enable row level security;
alter table public.integration_webhook_events enable row level security;
alter table public.integration_webhook_deliveries enable row level security;

create policy integration_api_keys_admin on public.integration_api_keys for select to authenticated
  using (public.current_user_is_admin() and public.staff_session_has_required_assurance());
create policy integration_webhook_endpoints_admin on public.integration_webhook_endpoints for select to authenticated
  using (public.current_user_is_admin() and public.staff_session_has_required_assurance());
create policy integration_webhook_deliveries_admin on public.integration_webhook_deliveries for select to authenticated
  using (public.current_user_is_admin() and public.staff_session_has_required_assurance());
create policy integration_webhook_events_admin on public.integration_webhook_events for select to authenticated
  using (public.current_user_is_admin() and public.staff_session_has_required_assurance());

grant select on public.integration_api_keys, public.integration_webhook_endpoints,
  public.integration_webhook_events, public.integration_webhook_deliveries to authenticated;
grant all on public.integration_api_keys, public.integration_api_request_log,
  public.integration_webhook_endpoints, public.integration_webhook_secrets,
  public.integration_webhook_events, public.integration_webhook_deliveries to service_role;
grant usage, select on sequence public.integration_api_request_log_id_seq to service_role;

create or replace function public.create_integration_api_key(
  p_name text,
  p_scopes text[] default array['availability:read']::text[],
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_id uuid;
  v_allowed constant text[] := array['availability:read', 'aircraft:read', 'bookings:read'];
begin
  if not public.current_user_is_admin() or not public.staff_session_has_required_assurance() then
    raise exception 'Administrator MFA verification is required';
  end if;
  if p_scopes is null or cardinality(p_scopes) = 0 or not p_scopes <@ v_allowed then
    raise exception 'Select one or more supported API scopes';
  end if;
  v_token := 'bfc_' || encode(gen_random_bytes(32), 'hex');
  insert into public.integration_api_keys(name, key_prefix, key_hash, scopes, expires_at, created_by)
  values (trim(p_name), left(v_token, 12), encode(digest(v_token, 'sha256'), 'hex'), p_scopes, p_expires_at, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'prefix', left(v_token, 12), 'scopes', p_scopes);
end;
$$;

create or replace function public.revoke_integration_api_key(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() or not public.staff_session_has_required_assurance() then
    raise exception 'Administrator MFA verification is required';
  end if;
  update public.integration_api_keys
  set is_active = false, revoked_at = now()
  where id = p_key_id;
end;
$$;

create or replace function public.create_integration_webhook(
  p_name text,
  p_url text,
  p_events text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_secret text := 'whsec_' || encode(gen_random_bytes(32), 'hex');
begin
  if not public.current_user_is_admin() or not public.staff_session_has_required_assurance() then
    raise exception 'Administrator MFA verification is required';
  end if;
  if p_url !~ '^https://[^[:space:]]+$'
     or lower(p_url) ~ 'https://(localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' then
    raise exception 'Webhook URL must be a public HTTPS address';
  end if;
  if p_events is null or cardinality(p_events) = 0 then
    raise exception 'Choose at least one event';
  end if;
  insert into public.integration_webhook_endpoints(name, url, subscribed_events, created_by)
  values (trim(p_name), trim(p_url), p_events, auth.uid())
  returning id into v_id;
  insert into public.integration_webhook_secrets(endpoint_id, signing_secret) values (v_id, v_secret);
  return jsonb_build_object('id', v_id, 'signingSecret', v_secret);
end;
$$;

create or replace function public.set_integration_webhook_active(p_endpoint_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() or not public.staff_session_has_required_assurance() then
    raise exception 'Administrator MFA verification is required';
  end if;
  update public.integration_webhook_endpoints
  set is_active = p_active, updated_at = now()
  where id = p_endpoint_id;
end;
$$;

revoke all on function public.create_integration_api_key(text, text[], timestamptz),
  public.revoke_integration_api_key(uuid), public.create_integration_webhook(text, text, text[]),
  public.set_integration_webhook_active(uuid, boolean) from public, anon;
grant execute on function public.create_integration_api_key(text, text[], timestamptz),
  public.revoke_integration_api_key(uuid), public.create_integration_webhook(text, text, text[]),
  public.set_integration_webhook_active(uuid, boolean) to authenticated, service_role;

create or replace function public.enqueue_integration_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.integration_webhook_events(event_type, subject_id, payload)
  values (
    tg_table_name || '.' || lower(tg_op),
    v_row ->> 'id',
    jsonb_build_object('id', v_row ->> 'id', 'updated_at', coalesce(v_row ->> 'updated_at', v_row ->> 'created_at'))
  );
  return new;
end;
$$;

revoke all on function public.enqueue_integration_event() from public, anon, authenticated;
grant execute on function public.enqueue_integration_event() to service_role;

drop trigger if exists enqueue_booking_integration_event on public.bookings;
create trigger enqueue_booking_integration_event after insert or update on public.bookings
for each row execute function public.enqueue_integration_event();
drop trigger if exists enqueue_membership_integration_event on public.club_memberships;
create trigger enqueue_membership_integration_event after insert or update on public.club_memberships
for each row execute function public.enqueue_integration_event();
drop trigger if exists enqueue_membership_fee_integration_event on public.membership_financial_periods;
create trigger enqueue_membership_fee_integration_event after insert or update on public.membership_financial_periods
for each row execute function public.enqueue_integration_event();
