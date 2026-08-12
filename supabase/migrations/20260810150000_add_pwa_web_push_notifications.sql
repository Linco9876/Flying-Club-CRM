-- Deliver each in-app notification to every active PWA subscription owned by
-- the recipient. Subscription secrets are service-only and delivery is
-- idempotent per notification/device.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  app_scope text not null default 'portal'
    check (app_scope in ('portal', 'duty_clock')),
  device_label text,
  user_agent text,
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  revoked_at timestamptz,
  check (length(endpoint) between 20 and 4096),
  check (length(p256dh) between 20 and 1024),
  check (length(auth_key) between 8 and 512)
);

create index if not exists idx_push_subscriptions_active_user
  on public.push_subscriptions(user_id, updated_at desc)
  where revoked_at is null;

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant all on public.push_subscriptions to service_role;

create table if not exists public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  push_status_code integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id, subscription_id)
);

create index if not exists idx_notification_push_deliveries_pending
  on public.notification_push_deliveries(next_attempt_at, created_at)
  where status in ('pending', 'processing');

alter table public.notification_push_deliveries enable row level security;
revoke all on public.notification_push_deliveries from public, anon, authenticated;
grant all on public.notification_push_deliveries to service_role;

create or replace function public.claim_notification_push_deliveries(
  p_limit integer default 25
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  notification_id uuid,
  user_id uuid,
  endpoint text,
  p256dh text,
  auth_key text,
  title text,
  message text,
  notification_type text,
  booking_id uuid,
  metadata jsonb,
  attempt_number integer,
  unread_count integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required to claim push deliveries';
  end if;

  update public.notification_push_deliveries delivery
  set status = 'cancelled',
      last_error = 'Notification was read before push delivery',
      updated_at = now()
  from public.notifications notification
  where notification.id = delivery.notification_id
    and notification.is_read
    and delivery.status in ('pending', 'processing');

  update public.notification_push_deliveries
  set status = 'pending',
      next_attempt_at = now(),
      last_error = 'Recovered an interrupted push delivery',
      updated_at = now()
  where status = 'processing'
    and last_attempt_at < now() - interval '5 minutes'
    and attempts < 5;

  return query
  with candidates as (
    select delivery.id
    from public.notification_push_deliveries delivery
    join public.notifications notification on notification.id = delivery.notification_id
    join public.push_subscriptions subscription on subscription.id = delivery.subscription_id
    where delivery.status = 'pending'
      and delivery.next_attempt_at <= now()
      and delivery.attempts < 5
      and not notification.is_read
      and subscription.revoked_at is null
      and (subscription.expiration_time is null or subscription.expiration_time > now())
    order by delivery.created_at
    for update of delivery skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ), claimed as (
    update public.notification_push_deliveries delivery
    set status = 'processing',
        attempts = delivery.attempts + 1,
        last_attempt_at = now(),
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    subscription.id,
    notification.id,
    notification.user_id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_key,
    notification.title,
    notification.message,
    notification.type,
    notification.booking_id,
    coalesce(notification.metadata, '{}'::jsonb),
    claimed.attempts,
    (
      select count(*)::integer
      from public.notifications unread
      where unread.user_id = notification.user_id
        and not unread.is_read
    )
  from claimed
  join public.notifications notification on notification.id = claimed.notification_id
  join public.push_subscriptions subscription on subscription.id = claimed.subscription_id;
end;
$$;

revoke all on function public.claim_notification_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_push_deliveries(integer) to service_role;

create or replace function public.invoke_notification_push_worker(
  p_notification_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  worker_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into worker_secret
  from vault.decrypted_secrets
  where name = 'notification_push_worker_secret'
  limit 1;

  if nullif(worker_secret, '') is null then
    return null;
  end if;

  select net.http_post(
    url := 'https://kcfjnpngnouyvcuvfleu.supabase.co/functions/v1/push-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Push-Worker-Secret', worker_secret
    ),
    body := jsonb_build_object(
      'action', 'process',
      'notificationId', p_notification_id
    ),
    timeout_milliseconds := 10000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_notification_push_worker(uuid) from public, anon, authenticated;
grant execute on function public.invoke_notification_push_worker(uuid) to service_role;

create or replace function public.enqueue_notification_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if new.is_read
     or lower(coalesce(new.metadata ->> 'suppress_push', 'false')) in ('true', '1', 'yes') then
    return new;
  end if;

  insert into public.notification_push_deliveries(notification_id, subscription_id)
  select new.id, subscription.id
  from public.push_subscriptions subscription
  where subscription.user_id = new.user_id
    and subscription.revoked_at is null
    and (subscription.expiration_time is null or subscription.expiration_time > now())
  on conflict (notification_id, subscription_id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count > 0 then
    perform public.invoke_notification_push_worker(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_notification_push_deliveries() from public, anon, authenticated, service_role;

drop trigger if exists enqueue_notification_push_deliveries_trigger on public.notifications;
create trigger enqueue_notification_push_deliveries_trigger
after insert on public.notifications
for each row execute function public.enqueue_notification_push_deliveries();

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'process-notification-push-deliveries';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'process-notification-push-deliveries',
    '* * * * *',
    'select public.invoke_notification_push_worker(null::uuid)'
  );
end;
$$;

comment on table public.push_subscriptions is
  'Service-only Web Push subscriptions for installed portal and duty-clock PWAs.';
comment on table public.notification_push_deliveries is
  'Idempotent delivery outbox connecting CRM notifications to subscribed PWA devices.';

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale
) values
  (
    'public.claim_notification_push_deliveries(p_limit integer)',
    'claim_notification_push_deliveries',
    'service_worker',
    array['service_role']::text[],
    true,
    true,
    'Claims queued Web Push deliveries for the authenticated background worker.'
  ),
  (
    'public.invoke_notification_push_worker(p_notification_id uuid)',
    'invoke_notification_push_worker',
    'service_worker',
    array['service_role']::text[],
    true,
    true,
    'Invokes the protected notification delivery worker from triggers and cron.'
  ),
  (
    'public.enqueue_notification_push_deliveries()',
    'enqueue_notification_push_deliveries',
    'trigger_internal',
    array[]::text[],
    true,
    true,
    'Creates an idempotent push outbox entry when an in-app notification is inserted.'
  )
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale;

select private.assert_function_permission_manifest();
