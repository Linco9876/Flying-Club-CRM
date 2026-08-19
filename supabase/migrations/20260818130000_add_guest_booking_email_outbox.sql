-- Reliable guest/casual booking confirmations and day-prior reminders.
-- Deliveries use a service-only outbox so browser closure, retries and booking
-- edits cannot lose or duplicate operational email.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.guest_booking_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  delivery_kind text not null
    check (delivery_kind in ('confirmation', 'day_prior_reminder')),
  recipient_email text not null,
  recipient_name text,
  booking_start_time timestamptz not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'sent', 'failed', 'suppressed', 'cancelled')),
  source text not null default 'booking_outbox',
  dedupe_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  suppression_reason text,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists guest_booking_email_deliveries_due_idx
  on public.guest_booking_email_deliveries(scheduled_for, next_attempt_at, created_at)
  where status in ('pending', 'retry');
create index if not exists guest_booking_email_deliveries_booking_idx
  on public.guest_booking_email_deliveries(booking_id, delivery_kind, sent_at desc);

alter table public.guest_booking_email_deliveries enable row level security;
revoke all on table public.guest_booking_email_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.guest_booking_email_deliveries to service_role;

create or replace function private.guest_booking_reminder_scheduled_for(
  p_start_time timestamptz
)
returns timestamptz
language sql
stable
set search_path = pg_catalog
as $$
  select (
    ((p_start_time at time zone 'Australia/Sydney')::date - 1)
    + time '09:00'
  ) at time zone 'Australia/Sydney';
$$;

revoke all on function private.guest_booking_reminder_scheduled_for(timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.invoke_guest_booking_email_worker(
  p_delivery_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  worker_secret text;
  request_id bigint;
begin
  -- Reuse the existing high-entropy database worker secret already configured
  -- for notification delivery. The email worker has its own endpoint and claim
  -- RPC, so this does not broaden data access.
  select decrypted_secret
  into worker_secret
  from vault.decrypted_secrets
  where name = 'notification_push_worker_secret'
  limit 1;

  if nullif(worker_secret, '') is null then
    return null;
  end if;

  select net.http_post(
    url := 'https://kcfjnpngnouyvcuvfleu.supabase.co/functions/v1/guest-booking-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Push-Worker-Secret', worker_secret
    ),
    body := jsonb_build_object(
      'action', 'process',
      'deliveryId', p_delivery_id
    ),
    timeout_milliseconds := 15000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_guest_booking_email_worker(uuid)
  from public, anon, authenticated;
grant execute on function public.invoke_guest_booking_email_worker(uuid)
  to service_role;

create or replace function private.queue_guest_booking_emails()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_email text := lower(nullif(btrim(coalesce(new.guest_email, '')), ''));
  v_name text := nullif(btrim(coalesce(new.guest_name, '')), '');
  v_active boolean;
  v_local_booking_date date;
  v_local_today date := (clock_timestamp() at time zone 'Australia/Sydney')::date;
  v_reminder_at timestamptz;
  v_confirmation_queued integer := 0;
  v_reminder_queued integer := 0;
  v_should_confirmation boolean := false;
begin
  v_active := coalesce(new.is_guest_booking, false)
    and v_email is not null
    and new.deleted_at is null
    and new.status not in ('cancelled', 'no-show', 'completed')
    and new.start_time > clock_timestamp();

  -- Pending deliveries are snapshots. Cancel them if the booking is no longer
  -- active or the recipient/time has changed; processing workers independently
  -- revalidate immediately before sending.
  update public.guest_booking_email_deliveries delivery
  set status = 'cancelled',
      suppression_reason = case
        when not v_active then 'Booking is no longer eligible for guest email'
        else 'Booking email or start time changed'
      end,
      updated_at = clock_timestamp()
  where delivery.booking_id = new.id
    and delivery.status in ('pending', 'retry')
    and (
      not v_active
      or lower(delivery.recipient_email) <> v_email
      or delivery.booking_start_time <> new.start_time
    );

  if not v_active then
    return new;
  end if;

  -- Trial-voucher bookings already send a richer synchronous confirmation.
  -- That sender records its successful delivery in this same table so reminder
  -- suppression still has one authoritative history.
  if new.trial_flight_voucher_id is null then
    if tg_op = 'INSERT' then
      v_should_confirmation := true;
    elsif tg_op = 'UPDATE' then
      v_should_confirmation := not coalesce(old.is_guest_booking, false)
        or lower(nullif(btrim(coalesce(old.guest_email, '')), '')) is distinct from v_email
        or not exists (
          select 1
          from public.guest_booking_email_deliveries sent_confirmation
          where sent_confirmation.booking_id = new.id
            and sent_confirmation.delivery_kind = 'confirmation'
            and sent_confirmation.status = 'sent'
            and lower(sent_confirmation.recipient_email) = v_email
        );
    end if;
  end if;

  if v_should_confirmation then
    insert into public.guest_booking_email_deliveries(
      booking_id,
      delivery_kind,
      recipient_email,
      recipient_name,
      booking_start_time,
      scheduled_for,
      next_attempt_at,
      dedupe_key
    ) values (
      new.id,
      'confirmation',
      v_email,
      v_name,
      new.start_time,
      clock_timestamp(),
      clock_timestamp(),
      concat('confirmation:', new.id, ':', v_email, ':', extract(epoch from new.start_time)::bigint)
    )
    on conflict (dedupe_key) do nothing;
    get diagnostics v_confirmation_queued = row_count;
  end if;

  -- Reserve a confirmation row for the tailored trial-voucher sender. The
  -- normal sender marks this exact row sent. If it fails or is interrupted, the
  -- generic worker becomes a safe fallback after two minutes, while a due
  -- reminder waits behind the confirmation row instead of racing it.
  if new.trial_flight_voucher_id is not null then
    insert into public.guest_booking_email_deliveries(
      booking_id,
      delivery_kind,
      recipient_email,
      recipient_name,
      booking_start_time,
      scheduled_for,
      next_attempt_at,
      dedupe_key,
      source
    ) values (
      new.id,
      'confirmation',
      v_email,
      v_name,
      new.start_time,
      clock_timestamp(),
      clock_timestamp() + interval '2 minutes',
      concat('confirmation:', new.id, ':', v_email, ':', extract(epoch from new.start_time)::bigint),
      'trial_voucher_confirmation_fallback'
    )
    on conflict (dedupe_key) do nothing;
    get diagnostics v_confirmation_queued = row_count;
  end if;

  v_local_booking_date := (new.start_time at time zone 'Australia/Sydney')::date;
  if v_local_today <= v_local_booking_date - 1 then
    v_reminder_at := private.guest_booking_reminder_scheduled_for(new.start_time);
    insert into public.guest_booking_email_deliveries(
      booking_id,
      delivery_kind,
      recipient_email,
      recipient_name,
      booking_start_time,
      scheduled_for,
      next_attempt_at,
      dedupe_key
    ) values (
      new.id,
      'day_prior_reminder',
      v_email,
      v_name,
      new.start_time,
      greatest(v_reminder_at, clock_timestamp()),
      greatest(v_reminder_at, clock_timestamp()),
      concat('day-prior:', new.id, ':', v_email, ':', extract(epoch from new.start_time)::bigint)
    )
    on conflict (dedupe_key) do nothing;
    get diagnostics v_reminder_queued = row_count;
  end if;

  if v_confirmation_queued > 0
    or (v_reminder_queued > 0 and v_reminder_at <= clock_timestamp())
  then
    perform public.invoke_guest_booking_email_worker(null::uuid);
  end if;

  return new;
end;
$$;

revoke all on function private.queue_guest_booking_emails()
  from public, anon, authenticated, service_role;

drop trigger if exists queue_guest_booking_emails_trigger on public.bookings;
create trigger queue_guest_booking_emails_trigger
after insert or update of is_guest_booking, guest_name, guest_email,
  start_time, status, deleted_at, trial_flight_voucher_id
on public.bookings
for each row execute function private.queue_guest_booking_emails();

create or replace function public.claim_guest_booking_email_deliveries(
  p_limit integer default 50
)
returns table(
  delivery_id uuid,
  booking_id uuid,
  delivery_kind text,
  recipient_email text,
  recipient_name text,
  booking_start_time timestamptz,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Recover a worker claim if its process was interrupted before completion.
  update public.guest_booking_email_deliveries delivery
  set status = case when delivery.attempt_count >= 5 then 'failed' else 'retry' end,
      next_attempt_at = case
        when delivery.attempt_count >= 5 then clock_timestamp()
        else clock_timestamp() + interval '5 minutes'
      end,
      processing_started_at = null,
      last_error = coalesce(delivery.last_error, 'Email worker claim timed out'),
      updated_at = clock_timestamp()
  where delivery.status = 'processing'
    and delivery.processing_started_at < clock_timestamp() - interval '15 minutes';

  -- Revalidate snapshots before claiming. This closes the race between a
  -- booking edit/cancellation and the AFTER trigger that cancels pending rows.
  update public.guest_booking_email_deliveries delivery
  set status = 'cancelled',
      suppression_reason = 'Booking is no longer active or no longer matches this delivery',
      updated_at = clock_timestamp()
  where delivery.status in ('pending', 'retry')
    and delivery.scheduled_for <= clock_timestamp()
    and not exists (
      select 1
      from public.bookings booking
      where booking.id = delivery.booking_id
        and coalesce(booking.is_guest_booking, false)
        and booking.deleted_at is null
        and booking.status not in ('cancelled', 'no-show', 'completed')
        and booking.start_time = delivery.booking_start_time
        and booking.start_time > clock_timestamp()
        and lower(nullif(btrim(coalesce(booking.guest_email, '')), '')) = lower(delivery.recipient_email)
    );

  -- A recent confirmation already gives the guest current booking details.
  -- Suppress, rather than delete, the reminder so staff can audit the decision.
  update public.guest_booking_email_deliveries reminder
  set status = 'suppressed',
      suppression_reason = 'Confirmation email was sent within the previous 12 hours',
      updated_at = clock_timestamp()
  where reminder.delivery_kind = 'day_prior_reminder'
    and reminder.status in ('pending', 'retry')
    and reminder.scheduled_for <= clock_timestamp()
    and exists (
      select 1
      from public.guest_booking_email_deliveries confirmation
      where confirmation.booking_id = reminder.booking_id
        and confirmation.delivery_kind = 'confirmation'
        and confirmation.status = 'sent'
        and lower(confirmation.recipient_email) = lower(reminder.recipient_email)
        and confirmation.sent_at > clock_timestamp() - interval '12 hours'
    );

  return query
  with due as (
    select delivery.id
    from public.guest_booking_email_deliveries delivery
    where delivery.status in ('pending', 'retry')
      and delivery.scheduled_for <= clock_timestamp()
      and delivery.next_attempt_at <= clock_timestamp()
      and not (
        delivery.delivery_kind = 'day_prior_reminder'
        and exists (
          select 1
          from public.guest_booking_email_deliveries confirmation_in_flight
          where confirmation_in_flight.booking_id = delivery.booking_id
            and confirmation_in_flight.delivery_kind = 'confirmation'
            and lower(confirmation_in_flight.recipient_email) = lower(delivery.recipient_email)
            and confirmation_in_flight.status in ('pending', 'processing', 'retry')
        )
      )
    order by
      case when delivery.delivery_kind = 'confirmation' then 0 else 1 end,
      delivery.scheduled_for,
      delivery.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ), claimed as (
    update public.guest_booking_email_deliveries delivery
    set status = 'processing',
        attempt_count = delivery.attempt_count + 1,
        processing_started_at = clock_timestamp(),
        updated_at = clock_timestamp()
    from due
    where delivery.id = due.id
    returning delivery.*
  )
  select
    claimed.id,
    claimed.booking_id,
    claimed.delivery_kind,
    claimed.recipient_email,
    claimed.recipient_name,
    claimed.booking_start_time,
    claimed.attempt_count
  from claimed
  order by
    case when claimed.delivery_kind = 'confirmation' then 0 else 1 end,
    claimed.scheduled_for,
    claimed.created_at;
end;
$$;

revoke all on function public.claim_guest_booking_email_deliveries(integer)
  from public, anon, authenticated;
grant execute on function public.claim_guest_booking_email_deliveries(integer)
  to service_role;

-- Existing future casual bookings should participate in the new reminder
-- workflow without generating a bulk confirmation-email event on deployment.
insert into public.guest_booking_email_deliveries(
  booking_id,
  delivery_kind,
  recipient_email,
  recipient_name,
  booking_start_time,
  scheduled_for,
  next_attempt_at,
  dedupe_key,
  source
)
select
  booking.id,
  'day_prior_reminder',
  lower(btrim(booking.guest_email)),
  nullif(btrim(coalesce(booking.guest_name, '')), ''),
  booking.start_time,
  greatest(private.guest_booking_reminder_scheduled_for(booking.start_time), clock_timestamp()),
  greatest(private.guest_booking_reminder_scheduled_for(booking.start_time), clock_timestamp()),
  concat('day-prior:', booking.id, ':', lower(btrim(booking.guest_email)), ':', extract(epoch from booking.start_time)::bigint),
  'migration_backfill'
from public.bookings booking
where coalesce(booking.is_guest_booking, false)
  and nullif(btrim(coalesce(booking.guest_email, '')), '') is not null
  and booking.deleted_at is null
  and booking.status not in ('cancelled', 'no-show', 'completed')
  and booking.start_time > clock_timestamp()
  and (clock_timestamp() at time zone 'Australia/Sydney')::date
    <= (booking.start_time at time zone 'Australia/Sydney')::date - 1
on conflict (dedupe_key) do nothing;

do $$
declare
  existing_job bigint;
begin
  select jobid
  into existing_job
  from cron.job
  where jobname = 'process-guest-booking-email-deliveries';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'process-guest-booking-email-deliveries',
    '*/5 * * * *',
    'select public.invoke_guest_booking_email_worker(null::uuid)'
  );
end;
$$;

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values
  (
    'public.claim_guest_booking_email_deliveries(p_limit integer)',
    'claim_guest_booking_email_deliveries',
    'service_worker',
    array['service_role']::text[],
    true,
    true,
    'Service-only outbox claim. It atomically suppresses recent-confirmation reminders, revalidates booking snapshots and locks due guest email deliveries.',
    date '2026-08-18'
  ),
  (
    'public.invoke_guest_booking_email_worker(p_delivery_id uuid)',
    'invoke_guest_booking_email_worker',
    'service_worker',
    array['service_role']::text[],
    true,
    true,
    'Service-only pg_net dispatcher authenticated with the existing database worker secret.',
    date '2026-08-18'
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

comment on table public.guest_booking_email_deliveries is
  'Service-only, idempotent email outbox and audit history for casual booking confirmations and day-prior reminders.';
comment on function public.claim_guest_booking_email_deliveries(integer) is
  'Claims due guest booking email deliveries and suppresses day-prior reminders when a confirmation was sent within 12 hours.';
