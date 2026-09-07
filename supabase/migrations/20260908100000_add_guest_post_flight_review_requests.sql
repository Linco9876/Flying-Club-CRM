-- Consent-based, idempotent post-flight review requests for guest bookings.
-- Review requests are deliberately separate from operational confirmation mail.

alter table public.organisation_settings
  add column if not exists guest_review_requests_enabled boolean not null default false,
  add column if not exists google_review_url text not null default '',
  add column if not exists guest_review_delay_minutes integer not null default 120,
  add column if not exists guest_review_private_feedback_email text not null default '';

alter table public.organisation_settings
  drop constraint if exists organisation_settings_guest_review_delay_check,
  add constraint organisation_settings_guest_review_delay_check
    check (guest_review_delay_minutes between 0 and 10080),
  drop constraint if exists organisation_settings_google_review_url_check,
  add constraint organisation_settings_google_review_url_check
    check (
      not guest_review_requests_enabled
      or google_review_url ~* '^https://([^/]+\.)?(google\.com|g\.page)/'
      or google_review_url ~* '^https://(maps\.app\.goo\.gl|goo\.gl)/'
    );

alter table public.bookings
  add column if not exists guest_review_consent boolean not null default false,
  add column if not exists guest_review_consent_at timestamptz;

create or replace function private.set_guest_review_consent_timestamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(new.is_guest_booking, false)
    or nullif(btrim(coalesce(new.guest_email, '')), '') is null
    or not coalesce(new.guest_review_consent, false)
  then
    new.guest_review_consent := false;
    new.guest_review_consent_at := null;
  elsif tg_op = 'INSERT'
    or not coalesce(old.guest_review_consent, false)
    or lower(btrim(coalesce(old.guest_email, ''))) is distinct from lower(btrim(coalesce(new.guest_email, '')))
  then
    new.guest_review_consent_at := clock_timestamp();
  else
    new.guest_review_consent_at := old.guest_review_consent_at;
  end if;
  return new;
end;
$$;

revoke all on function private.set_guest_review_consent_timestamp()
  from public, anon, authenticated, service_role;

drop trigger if exists set_guest_review_consent_timestamp_trigger on public.bookings;
create trigger set_guest_review_consent_timestamp_trigger
before insert or update of is_guest_booking, guest_email, guest_review_consent
on public.bookings
for each row execute function private.set_guest_review_consent_timestamp();

create table if not exists public.guest_review_email_suppressions (
  email text primary key check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  suppressed_at timestamptz not null default clock_timestamp(),
  source_delivery_id uuid,
  reason text not null default 'recipient_unsubscribed',
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.guest_review_email_suppressions enable row level security;
revoke all on table public.guest_review_email_suppressions from public, anon, authenticated;
grant select, insert, update, delete on table public.guest_review_email_suppressions to service_role;

alter table public.guest_booking_email_deliveries
  add column if not exists flight_log_id uuid,
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'guest_booking_email_deliveries_flight_log_id_fkey'
      and conrelid = 'public.guest_booking_email_deliveries'::regclass
  ) then
    alter table public.guest_booking_email_deliveries
      add constraint guest_booking_email_deliveries_flight_log_id_fkey
      foreign key (flight_log_id) references public.flight_logs(id) on delete set null;
  end if;
end;
$$;

alter table public.guest_review_email_suppressions
  drop constraint if exists guest_review_email_suppressions_source_delivery_id_fkey,
  add constraint guest_review_email_suppressions_source_delivery_id_fkey
    foreign key (source_delivery_id) references public.guest_booking_email_deliveries(id) on delete set null;

alter table public.guest_booking_email_deliveries
  drop constraint if exists guest_booking_email_deliveries_delivery_kind_check,
  add constraint guest_booking_email_deliveries_delivery_kind_check
    check (delivery_kind in ('confirmation', 'day_prior_reminder', 'guest_review_request'));

create unique index if not exists guest_booking_email_deliveries_unsubscribe_token_key
  on public.guest_booking_email_deliveries(unsubscribe_token);
create index if not exists guest_booking_email_deliveries_flight_log_idx
  on public.guest_booking_email_deliveries(flight_log_id)
  where delivery_kind = 'guest_review_request';

create or replace function private.queue_guest_review_request_after_flight_log()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_email text;
  v_name text;
  v_delay integer;
  v_enabled boolean;
  v_review_url text;
  v_scheduled_for timestamptz;
  v_delivery_id uuid;
begin
  if new.booking_id is null then return new; end if;

  select * into v_booking from public.bookings where id = new.booking_id;
  if not found then return new; end if;
  select
    coalesce(settings.guest_review_requests_enabled, false),
    coalesce(settings.guest_review_delay_minutes, 120),
    nullif(btrim(coalesce(settings.google_review_url, '')), '')
  into v_enabled, v_delay, v_review_url
  from public.organisation_settings settings
  order by settings.updated_at desc nulls last, settings.id
  limit 1;

  v_email := lower(nullif(btrim(coalesce(v_booking.guest_email, '')), ''));
  v_name := nullif(btrim(coalesce(v_booking.guest_name, '')), '');
  if not coalesce(v_enabled, false)
    or v_review_url is null
    or not coalesce(v_booking.is_guest_booking, false)
    or not coalesce(v_booking.guest_review_consent, false)
    or v_booking.guest_review_consent_at is null
    or v_email is null
    or v_booking.deleted_at is not null
    or v_booking.status in ('cancelled', 'no-show')
    or v_booking.end_time < clock_timestamp() - interval '7 days'
    or exists (select 1 from public.guest_review_email_suppressions suppression where suppression.email = v_email)
  then
    return new;
  end if;

  v_scheduled_for := greatest(clock_timestamp(), v_booking.end_time) + make_interval(mins => greatest(0, least(v_delay, 10080)));
  insert into public.guest_booking_email_deliveries(
    booking_id, flight_log_id, delivery_kind, recipient_email, recipient_name,
    booking_start_time, booking_end_time, scheduled_for, next_attempt_at,
    dedupe_key, source
  ) values (
    v_booking.id, new.id, 'guest_review_request', v_email, v_name,
    v_booking.start_time, v_booking.end_time, v_scheduled_for, v_scheduled_for,
    concat('guest-review:', v_booking.id, ':', v_email), 'flight_log_post_flight_review'
  )
  on conflict (dedupe_key) do nothing
  returning id into v_delivery_id;

  if v_delivery_id is not null and v_scheduled_for <= clock_timestamp() then
    perform public.invoke_guest_booking_email_worker(v_delivery_id);
  end if;
  return new;
end;
$$;

revoke all on function private.queue_guest_review_request_after_flight_log()
  from public, anon, authenticated, service_role;

drop trigger if exists queue_guest_review_request_after_flight_log_trigger on public.flight_logs;
create trigger queue_guest_review_request_after_flight_log_trigger
after insert or update of booking_id on public.flight_logs
for each row execute function private.queue_guest_review_request_after_flight_log();

create or replace function private.cancel_guest_review_request_after_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(nullif(btrim(coalesce(new.guest_email, '')), ''));
begin
  update public.guest_booking_email_deliveries delivery
  set status = 'cancelled',
      suppression_reason = 'Guest review consent, email or booking eligibility changed before delivery',
      processing_started_at = null,
      updated_at = clock_timestamp()
  where delivery.booking_id = new.id
    and delivery.delivery_kind = 'guest_review_request'
    and delivery.status in ('pending', 'retry', 'processing')
    and (
      not coalesce(new.is_guest_booking, false)
      or not coalesce(new.guest_review_consent, false)
      or new.deleted_at is not null
      or new.status in ('cancelled', 'no-show')
      or v_email is null
      or lower(delivery.recipient_email) <> v_email
    );
  return new;
end;
$$;

revoke all on function private.cancel_guest_review_request_after_change()
  from public, anon, authenticated, service_role;

drop trigger if exists cancel_guest_review_request_after_change_trigger on public.bookings;
create trigger cancel_guest_review_request_after_change_trigger
after update of is_guest_booking, guest_email, guest_review_consent, status, deleted_at
on public.bookings
for each row execute function private.cancel_guest_review_request_after_change();

create or replace function private.cancel_guest_review_request_before_flight_log_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.guest_booking_email_deliveries delivery
  set status = 'cancelled',
      suppression_reason = 'Flight log was removed before the review request was sent',
      processing_started_at = null,
      updated_at = clock_timestamp()
  where delivery.flight_log_id = old.id
    and delivery.delivery_kind = 'guest_review_request'
    and delivery.status in ('pending', 'retry', 'processing');
  return old;
end;
$$;

revoke all on function private.cancel_guest_review_request_before_flight_log_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists cancel_guest_review_request_before_flight_log_delete_trigger on public.flight_logs;
create trigger cancel_guest_review_request_before_flight_log_delete_trigger
before delete on public.flight_logs
for each row execute function private.cancel_guest_review_request_before_flight_log_delete();

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
  update public.guest_booking_email_deliveries delivery
  set status = case when delivery.attempt_count >= 5 then 'failed' else 'retry' end,
      next_attempt_at = case when delivery.attempt_count >= 5 then clock_timestamp() else clock_timestamp() + interval '5 minutes' end,
      processing_started_at = null,
      last_error = coalesce(delivery.last_error, 'Email worker claim timed out'),
      updated_at = clock_timestamp()
  where delivery.status = 'processing'
    and delivery.processing_started_at < clock_timestamp() - interval '15 minutes';

  update public.guest_booking_email_deliveries delivery
  set status = 'cancelled',
      suppression_reason = 'Booking is no longer active or no longer matches this delivery',
      updated_at = clock_timestamp()
  where delivery.delivery_kind in ('confirmation', 'day_prior_reminder')
    and delivery.status in ('pending', 'retry')
    and delivery.scheduled_for <= clock_timestamp()
    and not exists (
      select 1 from public.bookings booking
      where booking.id = delivery.booking_id
        and coalesce(booking.is_guest_booking, false)
        and booking.deleted_at is null
        and booking.status not in ('cancelled', 'no-show', 'completed')
        and booking.start_time = delivery.booking_start_time
        and booking.start_time > clock_timestamp()
        and lower(nullif(btrim(coalesce(booking.guest_email, '')), '')) = lower(delivery.recipient_email)
    );

  update public.guest_booking_email_deliveries delivery
  set status = case
        when exists (select 1 from public.guest_review_email_suppressions suppression where suppression.email = lower(delivery.recipient_email)) then 'suppressed'
        else 'cancelled'
      end,
      suppression_reason = case
        when exists (select 1 from public.guest_review_email_suppressions suppression where suppression.email = lower(delivery.recipient_email))
          then 'Recipient unsubscribed from post-flight feedback email'
        else 'Flight log, consent, review settings or booking no longer qualifies'
      end,
      updated_at = clock_timestamp()
  where delivery.delivery_kind = 'guest_review_request'
    and delivery.status in ('pending', 'retry')
    and delivery.scheduled_for <= clock_timestamp()
    and not exists (
      select 1
      from public.bookings booking
      join public.flight_logs flight on flight.id = delivery.flight_log_id and flight.booking_id = booking.id
      where booking.id = delivery.booking_id
        and coalesce(booking.is_guest_booking, false)
        and coalesce(booking.guest_review_consent, false)
        and booking.deleted_at is null
        and booking.status not in ('cancelled', 'no-show')
        and lower(nullif(btrim(coalesce(booking.guest_email, '')), '')) = lower(delivery.recipient_email)
        and not exists (select 1 from public.guest_review_email_suppressions suppression where suppression.email = lower(delivery.recipient_email))
        and exists (
          select 1 from public.organisation_settings settings
          where coalesce(settings.guest_review_requests_enabled, false)
            and nullif(btrim(coalesce(settings.google_review_url, '')), '') is not null
        )
    );

  update public.guest_booking_email_deliveries reminder
  set status = 'suppressed',
      suppression_reason = 'Confirmation email was sent within the previous 12 hours',
      updated_at = clock_timestamp()
  where reminder.delivery_kind = 'day_prior_reminder'
    and reminder.status in ('pending', 'retry')
    and reminder.scheduled_for <= clock_timestamp()
    and exists (
      select 1 from public.guest_booking_email_deliveries confirmation
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
          select 1 from public.guest_booking_email_deliveries confirmation_in_flight
          where confirmation_in_flight.booking_id = delivery.booking_id
            and confirmation_in_flight.delivery_kind = 'confirmation'
            and lower(confirmation_in_flight.recipient_email) = lower(delivery.recipient_email)
            and confirmation_in_flight.status in ('pending', 'processing', 'retry')
        )
      )
    order by
      case delivery.delivery_kind when 'confirmation' then 0 when 'day_prior_reminder' then 1 else 2 end,
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
    from due where delivery.id = due.id
    returning delivery.*
  )
  select claimed.id, claimed.booking_id, claimed.delivery_kind, claimed.recipient_email,
    claimed.recipient_name, claimed.booking_start_time, claimed.attempt_count
  from claimed
  order by case claimed.delivery_kind when 'confirmation' then 0 when 'day_prior_reminder' then 1 else 2 end,
    claimed.scheduled_for, claimed.created_at;
end;
$$;

revoke all on function public.claim_guest_booking_email_deliveries(integer)
  from public, anon, authenticated;
grant execute on function public.claim_guest_booking_email_deliveries(integer) to service_role;

insert into private.function_permission_manifest(
  signature, function_name, classification, allowed_roles, security_definer,
  fixed_search_path, rationale, reviewed_at
) values (
  'public.claim_guest_booking_email_deliveries(p_limit integer)',
  'claim_guest_booking_email_deliveries',
  'service_worker',
  array['service_role']::text[],
  true,
  true,
  'Service-only email outbox claim with booking, consent, flight-log, unsubscribe and review-setting revalidation.',
  date '2026-09-08'
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

comment on column public.bookings.guest_review_consent is
  'Explicit visitor agreement to receive one post-flight feedback email at the booking guest email address.';
comment on table public.guest_review_email_suppressions is
  'Service-only suppression list for post-flight guest feedback email. Operational booking email is unaffected.';
comment on column public.guest_booking_email_deliveries.unsubscribe_token is
  'High-entropy token for authenticated one-click review-email preference changes.';
