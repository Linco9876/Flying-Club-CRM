-- Email a casual visitor automatically when the saved booking schedule changes.
-- Aircraft and instructor changes are deliberately absent from this trigger.

alter table public.guest_booking_email_deliveries
  add column if not exists booking_end_time timestamptz;

update public.guest_booking_email_deliveries delivery
set booking_end_time = booking.end_time
from public.bookings booking
where booking.id = delivery.booking_id
  and delivery.booking_end_time is null;

comment on column public.guest_booking_email_deliveries.booking_end_time is
  'End-time snapshot used to prevent a superseded visitor booking update from being emailed.';

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
begin
  -- If an immediate confirmation has not left yet, replace it with one clear
  -- update email instead of sending the original and update back-to-back.
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

drop trigger if exists queue_guest_booking_time_update_email_trigger
  on public.bookings;
create trigger queue_guest_booking_time_update_email_trigger
after update of start_time, end_time
on public.bookings
for each row
when (
  old.start_time is distinct from new.start_time
  or old.end_time is distinct from new.end_time
)
execute function private.queue_guest_booking_time_update_email();
