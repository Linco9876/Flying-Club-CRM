-- Keep every calendar client in sync with booking-linked flight-log changes,
-- and treat a senior's ordinary bookable roster availability as supervision
-- availability. The senior does not need a separate booking in the slot.

create or replace function private.sync_booking_flight_log_calendar_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    tg_op = 'DELETE'
    or (tg_op = 'UPDATE' and old.booking_id is distinct from new.booking_id)
  ) and old.booking_id is not null then
    update public.bookings booking
    set flight_logged = exists (
          select 1
          from public.flight_logs flight_log
          where flight_log.booking_id = old.booking_id
        ),
        updated_at = clock_timestamp()
    where booking.id = old.booking_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.booking_id is not null then
    update public.bookings booking
    set flight_logged = exists (
          select 1
          from public.flight_logs flight_log
          where flight_log.booking_id = new.booking_id
        ),
        updated_at = clock_timestamp()
    where booking.id = new.booking_id;
  end if;

  return null;
end;
$$;

revoke all on function private.sync_booking_flight_log_calendar_state()
  from public, anon, authenticated, service_role;

drop trigger if exists sync_booking_flight_log_calendar_state
  on public.flight_logs;
create trigger sync_booking_flight_log_calendar_state
after insert or update or delete
on public.flight_logs
for each row execute function private.sync_booking_flight_log_calendar_state();

-- An authorised senior is available at the place they are rostered to work.
-- Explicit supervision locations remain useful as optional additional coverage,
-- but are no longer required for the senior's normal working location.
create or replace function public.find_available_supervisor(
  p_trainee_instructor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_location text default 'Bendigo',
  p_activity_type text default 'flight',
  p_exclude_booking_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select authorisation.instructor_id
  from public.senior_instructor_authorisations authorisation
  where authorisation.is_active
    and authorisation.instructor_id <> p_trainee_instructor_id
    and (
      p_end < now()
      or authorisation.effective_from <= (p_start at time zone 'Australia/Sydney')::date
    )
    and (
      authorisation.effective_to is null
      or authorisation.effective_to >= (p_end at time zone 'Australia/Sydney')::date
    )
    and (
      authorisation.qualification_expires_on is null
      or authorisation.qualification_expires_on >= (p_end at time zone 'Australia/Sydney')::date
    )
    and (
      authorisation.remote_supervision_allowed
      or cardinality(authorisation.locations) = 0
      or p_location = any(authorisation.locations)
    )
    and (
      cardinality(authorisation.activity_types) = 0
      or p_activity_type = any(authorisation.activity_types)
    )
    and exists (
      select 1
      from public.duty_clock_locations location
      where location.is_active
        and lower(location.name) = lower(p_location)
        and (
          public.instructor_available_at_location_for_slot(
            authorisation.instructor_id,
            p_start,
            p_end,
            location.id
          )
          or location.id = any(
            public.supervisor_roster_locations_for_slot(
              authorisation.instructor_id,
              p_start,
              p_end
            )
          )
        )
    )
    and public.supervisor_available_for_slot(
      authorisation.instructor_id,
      p_start,
      p_end,
      p_exclude_booking_id
    )
  order by authorisation.priority, authorisation.instructor_id
  limit 1;
$$;

comment on function public.find_available_supervisor(uuid, timestamptz, timestamptz, text, text, uuid) is
  'Finds authorised supervision using ordinary bookable roster availability at the booking location or optional additional coverage. The senior needs no overlapping booking.';

-- Roster and authorisation edits must immediately approve, reassign, or return
-- unresolved bookings to pending supervision. Touching the booking intentionally
-- invokes prepare_booking_duty_and_supervision and emits a booking realtime row.
create or replace function private.refresh_open_booking_supervision_from_availability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.bookings booking
  set updated_at = clock_timestamp()
  where booking.instructor_id is not null
    and booking.deleted_at is null
    and booking.status not in ('cancelled', 'no-show', 'completed')
    and (
      booking.supervision_required
      or public.instructor_requires_role_supervision(booking.instructor_id)
      or exists (
        select 1
        from public.instructor_supervision_requirements requirement
        where requirement.instructor_id = booking.instructor_id
          and requirement.supervision_required
          and requirement.effective_from <= (
            booking.start_time at time zone 'Australia/Sydney'
          )::date
          and (
            requirement.effective_to is null
            or requirement.effective_to >= (
              booking.end_time at time zone 'Australia/Sydney'
            )::date
          )
      )
    );

  return null;
end;
$$;

revoke all on function private.refresh_open_booking_supervision_from_availability()
  from public, anon, authenticated, service_role;

drop trigger if exists refresh_booking_supervision_after_weekly_roster
  on public.instructor_weekly_schedules;
create trigger refresh_booking_supervision_after_weekly_roster
after insert or update or delete
on public.instructor_weekly_schedules
for each statement execute function private.refresh_open_booking_supervision_from_availability();

drop trigger if exists refresh_booking_supervision_after_schedule_change
  on public.instructor_schedule_changes;
create trigger refresh_booking_supervision_after_schedule_change
after insert or update or delete
on public.instructor_schedule_changes
for each statement execute function private.refresh_open_booking_supervision_from_availability();

drop trigger if exists refresh_booking_supervision_after_absence
  on public.instructor_absences;
create trigger refresh_booking_supervision_after_absence
after insert or update or delete
on public.instructor_absences
for each statement execute function private.refresh_open_booking_supervision_from_availability();

drop trigger if exists refresh_booking_supervision_after_authorisation
  on public.senior_instructor_authorisations;
create trigger refresh_booking_supervision_after_authorisation
after insert or update or delete
on public.senior_instructor_authorisations
for each statement execute function private.refresh_open_booking_supervision_from_availability();

drop trigger if exists refresh_booking_supervision_after_requirement
  on public.instructor_supervision_requirements;
create trigger refresh_booking_supervision_after_requirement
after insert or update or delete
on public.instructor_supervision_requirements
for each statement execute function private.refresh_open_booking_supervision_from_availability();

-- Reconsider existing unresolved bookings under the corrected availability rule.
update public.bookings booking
set updated_at = clock_timestamp()
where booking.instructor_id is not null
  and booking.deleted_at is null
  and booking.supervision_required
  and booking.status not in ('cancelled', 'no-show', 'completed');

select private.assert_function_permission_manifest();
