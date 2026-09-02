-- Reconcile resource-conflict waitlists in the database. This makes promotion
-- independent of a particular browser session and serialises competing
-- aircraft/instructor bookings so an opened slot goes to the oldest eligible
-- waitlisted booking.

create index if not exists idx_bookings_resource_waitlist_queue
  on public.bookings(created_at, start_time, id)
  where deleted_at is null
    and has_conflict
    and waitlist_reason = 'resource_conflict'
    and status in ('confirmed', 'pending_approval', 'pending_supervision');

create or replace function public.apply_booking_conflict_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy text := 'waitlist';
  v_has_conflict boolean := false;
  v_lock_key text;
begin
  -- Lock every old/new resource in a stable order. This closes the race where
  -- two browsers can both observe an empty slot and confirm simultaneously.
  if tg_op = 'UPDATE' then
    for v_lock_key in
      select distinct resource_key
      from (
        values
          (case when new.aircraft_id is not null then 'aircraft:' || new.aircraft_id::text end),
          (case when new.instructor_id is not null then 'instructor:' || new.instructor_id::text end),
          (case when old.aircraft_id is not null then 'aircraft:' || old.aircraft_id::text end),
          (case when old.instructor_id is not null then 'instructor:' || old.instructor_id::text end)
      ) resources(resource_key)
      where resource_key is not null
      order by resource_key
    loop
      perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
    end loop;
  else
    for v_lock_key in
      select distinct resource_key
      from (
        values
          (case when new.aircraft_id is not null then 'aircraft:' || new.aircraft_id::text end),
          (case when new.instructor_id is not null then 'instructor:' || new.instructor_id::text end)
      ) resources(resource_key)
      where resource_key is not null
      order by resource_key
    loop
      perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
    end loop;
  end if;

  if new.deleted_at is not null
     or new.status in ('cancelled', 'completed', 'no-show') then
    return new;
  end if;

  select coalesce(conflict_rules, 'waitlist')
    into v_policy
  from public.calendar_settings
  order by updated_at desc nulls last
  limit 1;

  select exists (
    select 1
    from public.bookings existing
    where existing.id is distinct from new.id
      and existing.deleted_at is null
      and existing.status in ('confirmed', 'pending_approval', 'pending_supervision')
      and coalesce(existing.has_conflict, false) is false
      and existing.start_time < new.end_time
      and existing.end_time > new.start_time
      and (
        (new.aircraft_id is not null and existing.aircraft_id = new.aircraft_id)
        or (new.instructor_id is not null and existing.instructor_id = new.instructor_id)
      )
  ) into v_has_conflict;

  if v_has_conflict then
    if v_policy in ('block', 'hard-block') then
      raise exception 'This booking conflicts with an existing confirmed booking'
        using errcode = 'P0001';
    end if;

    new.has_conflict := true;
    new.waitlist_reason := 'resource_conflict';
    if v_policy in ('approval', 'staff-approval') then
      new.status := 'pending_approval';
    end if;
  elsif new.waitlist_reason = 'resource_conflict'
     or (
       coalesce(new.has_conflict, false)
       and new.waitlist_reason is null
       and new.waitlisted_by_defect_id is null
       and new.waitlisted_by_milestone_id is null
     ) then
    new.has_conflict := false;
    new.waitlist_reason := null;
  end if;

  return new;
end;
$$;

create or replace function public.promote_available_resource_waitlist()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  v_lock_key text;
  v_has_blocker boolean;
  v_aircraft_unavailable boolean;
  v_instructor_unavailable boolean;
  v_promoted integer := 0;
  v_updated integer := 0;
begin
  for candidate in
    select
      booking.id,
      booking.aircraft_id,
      booking.instructor_id,
      booking.start_time,
      booking.end_time,
      booking.location_id
    from public.bookings booking
    where booking.deleted_at is null
      and coalesce(booking.has_conflict, false)
      and booking.waitlist_reason = 'resource_conflict'
      and booking.status in ('confirmed', 'pending_approval', 'pending_supervision')
      and booking.end_time > now()
    order by booking.created_at nulls last, booking.id
  loop
    -- Use the same stable resource locks as booking creation/update. Candidates
    -- sharing either resource therefore cannot be promoted concurrently.
    for v_lock_key in
      select distinct resource_key
      from (
        values
          (case when candidate.aircraft_id is not null then 'aircraft:' || candidate.aircraft_id::text end),
          (case when candidate.instructor_id is not null then 'instructor:' || candidate.instructor_id::text end)
      ) resources(resource_key)
      where resource_key is not null
      order by resource_key
    loop
      perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
    end loop;

    select exists (
      select 1
      from public.bookings blocker
      where blocker.id <> candidate.id
        and blocker.deleted_at is null
        and blocker.status in ('confirmed', 'pending_approval', 'pending_supervision')
        and coalesce(blocker.has_conflict, false) is false
        and blocker.start_time < candidate.end_time
        and blocker.end_time > candidate.start_time
        and (
          (candidate.aircraft_id is not null and blocker.aircraft_id = candidate.aircraft_id)
          or (candidate.instructor_id is not null and blocker.instructor_id = candidate.instructor_id)
        )
    ) into v_has_blocker;

    select exists (
      select 1
      from public.aircraft aircraft
      where aircraft.id = candidate.aircraft_id
        and (
          aircraft.status <> 'serviceable'
          or coalesce(aircraft.is_archived, false)
          or coalesce(aircraft.maintenance_grounded, false)
          or aircraft.auto_grounded_until > now()
        )
    ) into v_aircraft_unavailable;

    v_instructor_unavailable := candidate.instructor_id is not null
      and not public.instructor_available_at_location_for_slot(
        candidate.instructor_id,
        candidate.start_time,
        candidate.end_time,
        candidate.location_id
      );

    if not v_has_blocker
       and not coalesce(v_aircraft_unavailable, false)
       and not coalesce(v_instructor_unavailable, false) then
      update public.bookings booking
      set has_conflict = false,
          waitlist_reason = null,
          updated_at = now()
      where booking.id = candidate.id
        and booking.deleted_at is null
        and coalesce(booking.has_conflict, false)
        and booking.waitlist_reason = 'resource_conflict';

      get diagnostics v_updated = row_count;
      v_promoted := v_promoted + v_updated;
    end if;
  end loop;

  return v_promoted;
end;
$$;

create or replace function public.reconcile_resource_waitlist_after_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A promotion updates has_conflict itself. Avoid recursively rescanning the
  -- queue while still allowing the normal conflict-cleared notification.
  if pg_trigger_depth() <= 1 then
    perform public.promote_available_resource_waitlist();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.reconcile_resource_waitlist_after_availability_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.promote_available_resource_waitlist();
  return null;
end;
$$;

drop trigger if exists reconcile_resource_waitlist_after_booking_update on public.bookings;
create trigger reconcile_resource_waitlist_after_booking_update
after update of aircraft_id, instructor_id, start_time, end_time, status, deleted_at, has_conflict, waitlist_reason
on public.bookings
for each row execute function public.reconcile_resource_waitlist_after_booking_change();

drop trigger if exists reconcile_resource_waitlist_after_booking_delete on public.bookings;
create trigger reconcile_resource_waitlist_after_booking_delete
after delete on public.bookings
for each row execute function public.reconcile_resource_waitlist_after_booking_change();

drop trigger if exists reconcile_resource_waitlist_after_weekly_schedule on public.instructor_weekly_schedules;
create trigger reconcile_resource_waitlist_after_weekly_schedule
after insert or update or delete on public.instructor_weekly_schedules
for each statement execute function public.reconcile_resource_waitlist_after_availability_change();

drop trigger if exists reconcile_resource_waitlist_after_schedule_change on public.instructor_schedule_changes;
create trigger reconcile_resource_waitlist_after_schedule_change
after insert or update or delete on public.instructor_schedule_changes
for each statement execute function public.reconcile_resource_waitlist_after_availability_change();

drop trigger if exists reconcile_resource_waitlist_after_absence on public.instructor_absences;
create trigger reconcile_resource_waitlist_after_absence
after insert or update or delete on public.instructor_absences
for each statement execute function public.reconcile_resource_waitlist_after_availability_change();

drop trigger if exists reconcile_resource_waitlist_after_aircraft_availability on public.aircraft;
create trigger reconcile_resource_waitlist_after_aircraft_availability
after update of status, is_archived, auto_grounded_until, maintenance_grounded
on public.aircraft
for each statement execute function public.reconcile_resource_waitlist_after_availability_change();

revoke all on function public.promote_available_resource_waitlist() from public, anon, authenticated, service_role;
revoke all on function public.reconcile_resource_waitlist_after_booking_change() from public, anon, authenticated, service_role;
revoke all on function public.reconcile_resource_waitlist_after_availability_change() from public, anon, authenticated, service_role;

comment on function public.promote_available_resource_waitlist() is
  'Promotes the oldest eligible future resource-conflict booking when its aircraft and instructor slot are genuinely available.';
comment on function public.reconcile_resource_waitlist_after_booking_change() is
  'Automatically rechecks the resource waitlist after a booking can release or consume a slot.';
comment on function public.apply_booking_conflict_policy() is
  'Serialises aircraft/instructor resource checks and applies the configured block, waitlist, or approval policy.';

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
    'public.promote_available_resource_waitlist()',
    'promote_available_resource_waitlist',
    'trigger_internal',
    array[]::text[],
    true,
    true,
    'Internal waitlist reconciler invoked only by protected database triggers.',
    date '2026-09-01'
  ),
  (
    'public.reconcile_resource_waitlist_after_booking_change()',
    'reconcile_resource_waitlist_after_booking_change',
    'trigger_internal',
    array[]::text[],
    true,
    true,
    'Invoked only by booking change triggers.',
    date '2026-09-01'
  ),
  (
    'public.reconcile_resource_waitlist_after_availability_change()',
    'reconcile_resource_waitlist_after_availability_change',
    'trigger_internal',
    array[]::text[],
    true,
    true,
    'Invoked only by aircraft and instructor availability triggers.',
    date '2026-09-01'
  )
on conflict(signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

-- Reconcile any legacy waitlisted booking that no longer has a blocker as
-- soon as the migration is applied.
select public.promote_available_resource_waitlist();

select private.assert_function_permission_manifest();
