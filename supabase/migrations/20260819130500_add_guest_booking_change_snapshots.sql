-- Preserve the schedule a visitor previously knew so an update email can show
-- an accurate before-and-after summary.

alter table public.guest_booking_email_deliveries
  add column if not exists previous_booking_start_time timestamptz,
  add column if not exists previous_booking_end_time timestamptz;

comment on column public.guest_booking_email_deliveries.previous_booking_start_time is
  'Start time the visitor knew before this queued booking update.';
comment on column public.guest_booking_email_deliveries.previous_booking_end_time is
  'End time the visitor knew before this queued booking update.';

create or replace function private.queue_guest_booking_time_update_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(nullif(btrim(coalesce(new.guest_email, '')), ''));
  v_name text := nullif(btrim(coalesce(new.guest_name, '')), '');
  v_active boolean;
  v_delivery_id uuid;
  v_previous_start_time timestamptz;
  v_previous_end_time timestamptz;
begin
  -- If a previous schedule update is still queued, carry its original values
  -- forward. The visitor then sees the change from the schedule they last knew,
  -- rather than an intermediate edit that was never emailed.
  select
    coalesce((
      select delivery.previous_booking_start_time
      from public.guest_booking_email_deliveries delivery
      where delivery.booking_id = new.id
        and delivery.delivery_kind = 'confirmation'
        and delivery.source = 'booking_time_update'
        and delivery.status in ('pending', 'retry')
      order by delivery.created_at asc
      limit 1
    ), old.start_time),
    coalesce((
      select delivery.previous_booking_end_time
      from public.guest_booking_email_deliveries delivery
      where delivery.booking_id = new.id
        and delivery.delivery_kind = 'confirmation'
        and delivery.source = 'booking_time_update'
        and delivery.status in ('pending', 'retry')
      order by delivery.created_at asc
      limit 1
    ), old.end_time)
  into v_previous_start_time, v_previous_end_time;

  update public.guest_booking_email_deliveries delivery
  set status = 'cancelled',
      suppression_reason = 'Superseded by a newer booking date or time',
      updated_at = clock_timestamp()
  where delivery.booking_id = new.id
    and delivery.delivery_kind = 'confirmation'
    and delivery.status in ('pending', 'retry');

  v_active := coalesce(new.is_guest_booking, false)
    and v_email is not null
    and new.deleted_at is null
    and new.status not in ('cancelled', 'no-show', 'completed')
    and new.start_time > clock_timestamp();

  if not v_active then
    return new;
  end if;

  insert into public.guest_booking_email_deliveries(
    booking_id,
    delivery_kind,
    recipient_email,
    recipient_name,
    booking_start_time,
    booking_end_time,
    previous_booking_start_time,
    previous_booking_end_time,
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
    new.end_time,
    v_previous_start_time,
    v_previous_end_time,
    clock_timestamp(),
    clock_timestamp(),
    concat('booking-update:', new.id, ':', gen_random_uuid()),
    'booking_time_update'
  )
  returning id into v_delivery_id;

  perform public.invoke_guest_booking_email_worker(v_delivery_id);
  return new;
end;
$$;

revoke all on function private.queue_guest_booking_time_update_email()
  from public, anon, authenticated, service_role;
