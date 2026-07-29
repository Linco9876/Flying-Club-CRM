-- Tenant-bound, auditable and fail-closed Xero integration foundation.
-- This migration deliberately leaves the existing connection available only
-- for read-only inventory while Stripe remains in Test Mode.

alter table public.xero_connection_settings
  add column if not exists expected_tenant_id text,
  add column if not exists connection_mode text not null default 'inventory_only',
  add column if not exists posting_enabled boolean not null default false,
  add column if not exists access_token_ciphertext text,
  add column if not exists refresh_token_ciphertext text,
  add column if not exists id_token_ciphertext text,
  add column if not exists token_encryption_version integer,
  add column if not exists refresh_lock_id uuid,
  add column if not exists refresh_lock_expires_at timestamptz,
  add column if not exists last_inventory_at timestamptz,
  add column if not exists last_inventory_summary jsonb not null default '{}'::jsonb;

alter table public.xero_connection_settings
  drop constraint if exists xero_connection_settings_connection_mode_check,
  add constraint xero_connection_settings_connection_mode_check
    check (connection_mode in ('disconnected', 'inventory_only', 'draft_only', 'posting')),
  drop constraint if exists xero_connection_settings_encrypted_tokens_check,
  add constraint xero_connection_settings_encrypted_tokens_check
    check (
      (refresh_token is null and access_token is null and id_token is null)
      or
      (refresh_token_ciphertext is null and access_token_ciphertext is null and id_token_ciphertext is null)
    ),
  drop constraint if exists xero_connection_settings_posting_guard_check,
  add constraint xero_connection_settings_posting_guard_check
    check (
      posting_enabled is false
      or (
        connection_mode in ('draft_only', 'posting')
        and tenant_id is not null
        and expected_tenant_id is not null
        and tenant_id = expected_tenant_id
        and refresh_token_ciphertext is not null
      )
    );

alter table public.xero_oauth_states
  add column if not exists confirmation_phrase text,
  add column if not exists requested_aal text,
  add column if not exists pending_connection_id uuid,
  add column if not exists selected_tenant_id text;

create table if not exists public.xero_pending_connections (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.users(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  id_token_ciphertext text,
  token_type text,
  scope text,
  expires_at timestamptz,
  available_tenants jsonb not null default '[]'::jsonb,
  requested_aal text not null default 'aal2',
  expires_at_confirmation timestamptz not null default (now() + interval '15 minutes'),
  confirmed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint xero_pending_connections_aal2_check check (requested_aal = 'aal2')
);

create table if not exists public.xero_connection_audit (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  tenant_id text,
  tenant_name text,
  actor_id uuid references public.users(id) on delete set null,
  actor_type text not null default 'user',
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.xero_configuration_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  actor_id uuid references public.users(id) on delete set null,
  previous_settings jsonb not null default '{}'::jsonb,
  new_settings jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.xero_external_object_inventory (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  object_type text not null,
  xero_object_id text not null,
  local_table text,
  local_record_id uuid,
  source_field text,
  object_number text,
  remote_status text,
  origin_confidence text not null default 'connection_snapshot_unverified',
  quarantined boolean not null default true,
  reconciliation_status text not null default 'unreviewed',
  reconciliation_note text,
  remote_snapshot jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  unique (tenant_id, object_type, xero_object_id),
  constraint xero_inventory_reconciliation_status_check
    check (reconciliation_status in ('unreviewed', 'matched', 'test_artifact', 'voided', 'deleted', 'retained', 'difference'))
);

create table if not exists public.xero_mapping_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  version integer not null,
  status text not null default 'draft',
  effective_from timestamptz,
  created_by uuid references public.users(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  approval_note text,
  mapping_hash text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  retired_at timestamptz,
  unique (tenant_id, version),
  constraint xero_mapping_versions_status_check
    check (status in ('draft', 'approved', 'retired'))
);

create table if not exists public.xero_mapping_entries (
  id uuid primary key default gen_random_uuid(),
  mapping_version_id uuid not null references public.xero_mapping_versions(id) on delete cascade,
  resource_type text not null,
  purpose text not null,
  local_entity_type text,
  local_entity_id uuid,
  xero_object_id text not null,
  xero_code text,
  xero_name text,
  account_type text,
  tax_type text,
  effective_from timestamptz,
  impact_preview jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (mapping_version_id, resource_type, purpose, local_entity_type, local_entity_id)
);

create table if not exists public.xero_operation_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  operation_id text not null,
  queue_id uuid,
  action text not null,
  request_method text,
  request_path text,
  request_fingerprint text,
  xero_object_type text,
  xero_object_id text,
  status text not null default 'reserved',
  response_summary jsonb not null default '{}'::jsonb,
  correlation_id text,
  minute_limit_remaining integer,
  day_limit_remaining integer,
  retry_after_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, operation_id),
  constraint xero_operation_log_status_check
    check (status in ('reserved', 'submitted', 'confirmed', 'needs_review', 'failed'))
);

create table if not exists public.xero_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  event_id text not null,
  event_type text,
  signature_valid boolean not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  unique (tenant_id, event_id),
  constraint xero_webhook_events_status_check
    check (status in ('pending', 'processing', 'processed', 'failed', 'needs_review'))
);

alter table public.xero_sync_queue
  add column if not exists tenant_id_snapshot text,
  add column if not exists operation_id text,
  add column if not exists mapping_version_id uuid references public.xero_mapping_versions(id) on delete restrict,
  add column if not exists lease_token uuid,
  add column if not exists leased_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists xero_correlation_id text,
  add column if not exists origin_verified boolean not null default false;

alter table public.users
  add column if not exists xero_tenant_id text,
  add column if not exists xero_origin_verified boolean not null default false;
alter table public.flight_logs
  add column if not exists xero_tenant_id text,
  add column if not exists xero_origin_verified boolean not null default false;
alter table public.ground_session_logs
  add column if not exists xero_tenant_id text,
  add column if not exists xero_origin_verified boolean not null default false;
alter table public.account_transactions
  add column if not exists xero_tenant_id text,
  add column if not exists xero_origin_verified boolean not null default false;
alter table public.aircraft
  add column if not exists xero_tenant_id text,
  add column if not exists xero_origin_verified boolean not null default false;
alter table public.trial_flight_vouchers
  add column if not exists xero_tenant_id text,
  add column if not exists xero_origin_verified boolean not null default false;
alter table public.membership_financial_periods
  add column if not exists xero_tenant_id text,
  add column if not exists xero_origin_verified boolean not null default false;
alter table public.xero_invoice_portal_payments
  add column if not exists xero_tenant_id text,
  add column if not exists xero_origin_verified boolean not null default false;

-- Containment: retain the connection for GET-only inventory but stop every
-- automatic producer and leave all invoice defaults in draft/manual review.
update public.stripe_connect_settings
set
  stripe_mode = 'test',
  allow_test_mode_xero_sync = false,
  mode_updated_at = now(),
  updated_at = now()
where id = true;

update public.xero_connection_settings
set
  connection_mode = case when tenant_id is null then 'disconnected' else 'inventory_only' end,
  posting_enabled = false,
  updated_at = now()
where id = true;

update public.xero_sync_settings
set
  sync_flight_charges = false,
  sync_account_topups = false,
  sync_gift_vouchers = false,
  default_sync_mode = 'manual-review',
  default_invoice_status = 'DRAFT',
  auto_queue_flight_invoices = false,
  auto_apply_verified_payments = false,
  updated_at = now()
where id = true;

update public.xero_sync_queue
set
  tenant_id_snapshot = coalesce(
    tenant_id_snapshot,
    (select tenant_id from public.xero_connection_settings where id = true)
  ),
  operation_id = coalesce(operation_id, 'legacy:' || id::text),
  status = case when status in ('pending', 'processing') then 'needs_review' else status end,
  last_error = case
    when status in ('pending', 'processing')
      then 'Contained before tenant-safe Xero rollout. Inventory and reconcile this item before retrying.'
    else last_error
  end,
  lease_token = null,
  leased_at = null,
  lease_expires_at = null,
  worker_id = null,
  updated_at = now();

-- Snapshot each local Xero identifier against the tenant active at containment
-- time. These claims are deliberately unverified and quarantined.
insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field)
select c.tenant_id, 'contact', u.xero_contact_id, 'users', u.id, 'xero_contact_id'
from public.users u
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and u.xero_contact_id is not null
on conflict do nothing;

insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field, object_number)
select c.tenant_id, 'invoice', f.xero_invoice_id, 'flight_logs', f.id, 'xero_invoice_id', f.xero_invoice_number
from public.flight_logs f
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and f.xero_invoice_id is not null
on conflict do nothing;

insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field, object_number)
select c.tenant_id, 'invoice', g.xero_invoice_id, 'ground_session_logs', g.id, 'xero_invoice_id', g.xero_invoice_number
from public.ground_session_logs g
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and g.xero_invoice_id is not null
on conflict do nothing;

insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field, object_number)
select c.tenant_id, 'invoice', m.xero_invoice_id, 'membership_financial_periods', m.id, 'xero_invoice_id', m.xero_invoice_number
from public.membership_financial_periods m
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and m.xero_invoice_id is not null
on conflict do nothing;

insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field)
select c.tenant_id, 'payment', t.xero_payment_id, 'account_transactions', t.id, 'xero_payment_id'
from public.account_transactions t
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and t.xero_payment_id is not null
  and t.xero_payment_id not like 'credit-allocation:%'
on conflict do nothing;

insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field)
select c.tenant_id, 'bank_transaction', t.xero_bank_transaction_id, 'account_transactions', t.id, 'xero_bank_transaction_id'
from public.account_transactions t
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and t.xero_bank_transaction_id is not null
on conflict do nothing;

insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field)
select c.tenant_id, 'manual_journal', v.xero_sale_journal_id, 'trial_flight_vouchers', v.id, 'xero_sale_journal_id'
from public.trial_flight_vouchers v
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and v.xero_sale_journal_id is not null
on conflict do nothing;

insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field)
select c.tenant_id, 'manual_journal', v.xero_redemption_journal_id, 'trial_flight_vouchers', v.id, 'xero_redemption_journal_id'
from public.trial_flight_vouchers v
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and v.xero_redemption_journal_id is not null
on conflict do nothing;

insert into public.xero_external_object_inventory
  (tenant_id, object_type, xero_object_id, local_table, local_record_id, source_field)
select c.tenant_id, 'tracking_option', a.xero_tracking_option_id, 'aircraft', a.id, 'xero_tracking_option_id'
from public.aircraft a
cross join public.xero_connection_settings c
where c.id = true and c.tenant_id is not null and a.xero_tracking_option_id is not null
on conflict do nothing;

create or replace function public.prevent_expected_xero_tenant_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.expected_tenant_id is not null
    and new.expected_tenant_id is distinct from old.expected_tenant_id then
    raise exception 'The expected Xero tenant is immutable once pinned.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_expected_xero_tenant_change on public.xero_connection_settings;
create trigger trg_prevent_expected_xero_tenant_change
before update of expected_tenant_id on public.xero_connection_settings
for each row execute function public.prevent_expected_xero_tenant_change();

create or replace function public.prevent_xero_tenant_rebind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.xero_tenant_id is not null
    and new.xero_tenant_id is distinct from old.xero_tenant_id then
    raise exception 'A tenant-bound Xero reference cannot be rebound.';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users',
    'flight_logs',
    'ground_session_logs',
    'account_transactions',
    'aircraft',
    'trial_flight_vouchers',
    'membership_financial_periods',
    'xero_invoice_portal_payments'
  ]
  loop
    execute format('drop trigger if exists trg_prevent_xero_tenant_rebind on public.%I', table_name);
    execute format(
      'create trigger trg_prevent_xero_tenant_rebind before update of xero_tenant_id on public.%I for each row execute function public.prevent_xero_tenant_rebind()',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.audit_xero_connection_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.xero_connection_audit (
    event_type,
    tenant_id,
    tenant_name,
    actor_id,
    previous_state,
    new_state
  )
  values (
    case
      when tg_op = 'INSERT' then 'connection_created'
      when new.disconnected_at is not null and old.disconnected_at is null then 'connection_disconnected'
      when new.tenant_id is distinct from old.tenant_id then 'tenant_connection_changed'
      when new.posting_enabled is distinct from old.posting_enabled then 'posting_mode_changed'
      else 'connection_updated'
    end,
    new.tenant_id,
    new.tenant_name,
    new.connected_by,
    case when tg_op = 'INSERT' then '{}'::jsonb else
      to_jsonb(old) - array[
        'access_token', 'refresh_token', 'id_token',
        'access_token_ciphertext', 'refresh_token_ciphertext', 'id_token_ciphertext'
      ]
    end,
    to_jsonb(new) - array[
      'access_token', 'refresh_token', 'id_token',
      'access_token_ciphertext', 'refresh_token_ciphertext', 'id_token_ciphertext'
    ]
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_xero_connection_change on public.xero_connection_settings;
create trigger trg_audit_xero_connection_change
after insert or update on public.xero_connection_settings
for each row execute function public.audit_xero_connection_change();

create or replace function public.audit_xero_configuration_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.xero_configuration_audit (
    tenant_id,
    actor_id,
    previous_settings,
    new_settings
  )
  values (
    (select tenant_id from public.xero_connection_settings where id = true),
    new.updated_by,
    case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_xero_configuration_change on public.xero_sync_settings;
create trigger trg_audit_xero_configuration_change
after insert or update on public.xero_sync_settings
for each row execute function public.audit_xero_configuration_change();

create or replace function public.bind_xero_queue_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  connection_row public.xero_connection_settings%rowtype;
begin
  select * into connection_row
  from public.xero_connection_settings
  where id = true;

  new.tenant_id_snapshot := coalesce(new.tenant_id_snapshot, connection_row.tenant_id);
  new.operation_id := coalesce(
    nullif(btrim(new.operation_id), ''),
    new.entity_type || ':' || new.entity_id::text || ':' || new.action || ':' || gen_random_uuid()::text
  );
  new.origin_verified := (
    connection_row.expected_tenant_id is not null
    and new.tenant_id_snapshot = connection_row.expected_tenant_id
  );
  if new.mapping_version_id is null and new.origin_verified is true then
    select id into new.mapping_version_id
    from public.xero_mapping_versions
    where tenant_id = new.tenant_id_snapshot
      and status = 'approved'
      and effective_from <= now()
    order by version desc
    limit 1;
  end if;

  if connection_row.posting_enabled is not true then
    new.status := 'needs_review';
    new.last_error := coalesce(
      new.last_error,
      'Xero posting is contained. Review the tenant and approved mapping before processing.'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bind_xero_queue_tenant on public.xero_sync_queue;
create trigger trg_bind_xero_queue_tenant
before insert on public.xero_sync_queue
for each row execute function public.bind_xero_queue_tenant();

create or replace function public.bind_new_xero_reference_to_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_reference boolean;
  connection_row public.xero_connection_settings%rowtype;
begin
  select exists (
    select 1
    from jsonb_each_text(to_jsonb(new)) as field(key, value)
    where field.key like 'xero\_%\_id' escape '\'
      and field.key <> 'xero_tenant_id'
      and nullif(btrim(field.value), '') is not null
      and (
        tg_op = 'INSERT'
        or nullif(btrim(to_jsonb(old) ->> field.key), '') is distinct from
           nullif(btrim(field.value), '')
      )
  ) into changed_reference;

  if not changed_reference then
    return new;
  end if;

  select * into connection_row
  from public.xero_connection_settings
  where id = true;

  if connection_row.posting_enabled is not true
    or connection_row.tenant_id is null
    or connection_row.expected_tenant_id is null
    or connection_row.tenant_id <> connection_row.expected_tenant_id then
    raise exception 'Cannot store a new Xero identifier while posting is contained or the tenant is not verified.';
  end if;

  new.xero_tenant_id := connection_row.tenant_id;
  new.xero_origin_verified := true;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users',
    'flight_logs',
    'ground_session_logs',
    'account_transactions',
    'aircraft',
    'trial_flight_vouchers',
    'membership_financial_periods',
    'xero_invoice_portal_payments'
  ]
  loop
    execute format('drop trigger if exists trg_bind_new_xero_reference_to_tenant on public.%I', table_name);
    execute format(
      'create trigger trg_bind_new_xero_reference_to_tenant before insert or update on public.%I for each row execute function public.bind_new_xero_reference_to_tenant()',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.prevent_approved_xero_mapping_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  version_status text;
begin
  select status into version_status
  from public.xero_mapping_versions
  where id = coalesce(old.mapping_version_id, new.mapping_version_id);
  if version_status = 'approved' then
    raise exception 'Approved Xero mappings are immutable. Create a new version instead.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_approved_xero_mapping_change on public.xero_mapping_entries;
create trigger trg_prevent_approved_xero_mapping_change
before update or delete on public.xero_mapping_entries
for each row execute function public.prevent_approved_xero_mapping_change();

create unique index if not exists xero_sync_queue_tenant_operation_uidx
  on public.xero_sync_queue (tenant_id_snapshot, operation_id)
  where tenant_id_snapshot is not null and operation_id is not null;
create index if not exists xero_sync_queue_lease_idx
  on public.xero_sync_queue (status, next_attempt_at, lease_expires_at, priority, created_at);
create index if not exists xero_inventory_reconciliation_idx
  on public.xero_external_object_inventory (tenant_id, quarantined, reconciliation_status, object_type);

create or replace function public.lease_next_xero_sync_job(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns setof public.xero_sync_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  leased_id uuid;
  active_tenant text;
  expected_tenant text;
  can_post boolean;
begin
  select tenant_id, expected_tenant_id, posting_enabled
  into active_tenant, expected_tenant, can_post
  from public.xero_connection_settings
  where id = true;

  if can_post is not true or active_tenant is null or expected_tenant is null
    or active_tenant <> expected_tenant then
    return;
  end if;

  select queue.id into leased_id
  from public.xero_sync_queue queue
  where queue.status = 'pending'
    and queue.next_attempt_at <= now()
    and (queue.lease_expires_at is null or queue.lease_expires_at <= now())
    and queue.tenant_id_snapshot = active_tenant
    and queue.origin_verified is true
  order by queue.priority asc, queue.created_at asc
  for update skip locked
  limit 1;

  if leased_id is null then
    return;
  end if;

  return query
  update public.xero_sync_queue
  set
    status = 'processing',
    lease_token = gen_random_uuid(),
    leased_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
    worker_id = nullif(btrim(p_worker_id), ''),
    updated_at = now()
  where id = leased_id
  returning *;
end;
$$;

create or replace function public.claim_xero_token_refresh(
  p_lock_id uuid,
  p_lease_seconds integer default 45
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_rows integer := 0;
begin
  update public.xero_connection_settings
  set
    refresh_lock_id = p_lock_id,
    refresh_lock_expires_at = now() + make_interval(secs => greatest(15, least(p_lease_seconds, 120))),
    updated_at = now()
  where id = true
    and (
      refresh_lock_id is null
      or refresh_lock_expires_at is null
      or refresh_lock_expires_at <= now()
      or refresh_lock_id = p_lock_id
    );
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

create or replace function public.release_xero_token_refresh(p_lock_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.xero_connection_settings
  set refresh_lock_id = null, refresh_lock_expires_at = null, updated_at = now()
  where id = true and refresh_lock_id = p_lock_id;
$$;

-- Integration tables are Edge-Function-only. Authenticated administrators use
-- the MFA-enforced functions rather than direct table writes.
revoke all on table public.xero_connection_settings from anon, authenticated;
revoke all on table public.xero_sync_settings from anon, authenticated;
revoke all on table public.xero_oauth_states from anon, authenticated;
revoke all on table public.xero_pending_connections from anon, authenticated;
revoke all on table public.xero_connection_audit from anon, authenticated;
revoke all on table public.xero_configuration_audit from anon, authenticated;
revoke all on table public.xero_external_object_inventory from anon, authenticated;
revoke all on table public.xero_mapping_versions from anon, authenticated;
revoke all on table public.xero_mapping_entries from anon, authenticated;
revoke all on table public.xero_operation_log from anon, authenticated;
revoke all on table public.xero_webhook_events from anon, authenticated;
revoke all on table public.xero_sync_queue from anon, authenticated;

grant all on table public.xero_connection_settings, public.xero_sync_settings,
  public.xero_oauth_states, public.xero_pending_connections,
  public.xero_connection_audit, public.xero_configuration_audit,
  public.xero_external_object_inventory, public.xero_mapping_versions,
  public.xero_mapping_entries, public.xero_operation_log,
  public.xero_webhook_events, public.xero_sync_queue to service_role;

revoke all on function public.lease_next_xero_sync_job(text, integer) from public, anon, authenticated;
revoke all on function public.claim_xero_token_refresh(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_xero_token_refresh(uuid) from public, anon, authenticated;
grant execute on function public.lease_next_xero_sync_job(text, integer) to service_role;
grant execute on function public.claim_xero_token_refresh(uuid, integer) to service_role;
grant execute on function public.release_xero_token_refresh(uuid) to service_role;

alter table public.xero_pending_connections enable row level security;
alter table public.xero_connection_audit enable row level security;
alter table public.xero_configuration_audit enable row level security;
alter table public.xero_external_object_inventory enable row level security;
alter table public.xero_mapping_versions enable row level security;
alter table public.xero_mapping_entries enable row level security;
alter table public.xero_operation_log enable row level security;
alter table public.xero_webhook_events enable row level security;

comment on column public.xero_connection_settings.expected_tenant_id is
  'Immutable Bendigo Flying Club Xero tenant ID. It may be pinned once and never switched in place.';
comment on column public.xero_sync_queue.tenant_id_snapshot is
  'Tenant captured when the operation was created. Workers refuse jobs that differ from the active expected tenant.';
comment on table public.xero_external_object_inventory is
  'Tenant-scoped quarantine and reconciliation inventory for every known local or remote Xero identifier.';
