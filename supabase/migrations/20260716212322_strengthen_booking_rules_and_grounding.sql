alter table public.booking_rules_settings
  add column if not exists max_active_bookings_per_member integer not null default 0;

alter table public.booking_rules_settings
  drop constraint if exists booking_rules_settings_max_active_bookings_check;

alter table public.booking_rules_settings
  add constraint booking_rules_settings_max_active_bookings_check
  check (max_active_bookings_per_member >= 0 and max_active_bookings_per_member <= 100);

comment on column public.booking_rules_settings.max_active_bookings_per_member is
  'Maximum active future bookings per member. Zero means unlimited.';

update public.calendar_settings
set conflict_rules = 'waitlist'
where conflict_rules is null
   or conflict_rules not in ('waitlist', 'block', 'approval');

alter table public.calendar_settings
  drop constraint if exists calendar_settings_conflict_rules_check;

alter table public.calendar_settings
  add constraint calendar_settings_conflict_rules_check
  check (conflict_rules in ('waitlist', 'block', 'approval'));

create table if not exists public.booking_cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  fee_type text not null default 'none',
  fee_amount numeric(10,2) not null default 0,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_cancellation_reasons_name_not_blank check (length(trim(name)) > 0),
  constraint booking_cancellation_reasons_fee_type_check
    check (fee_type in ('none', 'late_cancel', 'no_show')),
  constraint booking_cancellation_reasons_fee_amount_check check (fee_amount >= 0)
);

alter table public.booking_cancellation_reasons enable row level security;

drop policy if exists "Full portal users can read cancellation reasons" on public.booking_cancellation_reasons;
create policy "Full portal users can read cancellation reasons"
  on public.booking_cancellation_reasons
  for select
  to authenticated
  using (public.current_user_has_full_portal_access());

drop policy if exists "Admins can manage cancellation reasons" on public.booking_cancellation_reasons;
create policy "Admins can manage cancellation reasons"
  on public.booking_cancellation_reasons
  for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

grant select, insert, update, delete on public.booking_cancellation_reasons to authenticated;
grant all on public.booking_cancellation_reasons to service_role;

insert into public.booking_cancellation_reasons (name, description, fee_type, fee_amount, display_order)
select seed.name, seed.description, seed.fee_type, seed.fee_amount, seed.display_order
from (values
  ('Weather or operational conditions', 'Weather, aircraft serviceability or another operational reason outside the member''s control.', 'none', 0::numeric, 10),
  ('Medical or personal emergency', 'Unexpected illness, injury or genuine personal emergency.', 'none', 0::numeric, 20),
  ('Late cancellation', 'The booking was cancelled inside the required notice period.', 'late_cancel', 0::numeric, 30),
  ('Did not attend', 'The hirer did not attend and did not cancel the booking.', 'no_show', 0::numeric, 40),
  ('Other', 'Another reason recorded with an explanatory note.', 'none', 0::numeric, 50)
) as seed(name, description, fee_type, fee_amount, display_order)
where not exists (
  select 1 from public.booking_cancellation_reasons existing
  where lower(existing.name) = lower(seed.name)
);

alter table public.bookings
  add column if not exists cancellation_reason_id uuid references public.booking_cancellation_reasons(id) on delete set null,
  add column if not exists cancellation_reason_name text,
  add column if not exists cancellation_notes text,
  add column if not exists cancellation_fee_type text,
  add column if not exists cancellation_fee_amount numeric(10,2) not null default 0,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.users(id) on delete set null,
  add column if not exists waitlist_reason text,
  add column if not exists waitlisted_by_defect_id uuid references public.defects(id) on delete set null;

alter table public.bookings
  drop constraint if exists bookings_cancellation_fee_type_check;

alter table public.bookings
  add constraint bookings_cancellation_fee_type_check
  check (cancellation_fee_type is null or cancellation_fee_type in ('none', 'late_cancel', 'no_show'));

alter table public.bookings
  drop constraint if exists bookings_cancellation_fee_amount_check;

alter table public.bookings
  add constraint bookings_cancellation_fee_amount_check check (cancellation_fee_amount >= 0);

create index if not exists idx_bookings_member_active_future
  on public.bookings (student_id, start_time)
  where deleted_at is null and status in ('confirmed', 'pending_approval');

create index if not exists idx_bookings_waitlisted_defect
  on public.bookings (waitlisted_by_defect_id, start_time)
  where waitlisted_by_defect_id is not null;

alter table public.aircraft
  add column if not exists auto_grounded_until timestamptz,
  add column if not exists auto_grounded_by_defect_id uuid references public.defects(id) on delete set null,
  add column if not exists status_before_auto_grounding text;

comment on column public.aircraft.auto_grounded_until is
  'Temporary automatic grounding expiry. Manual unserviceability remains separate.';

create or replace function public.enforce_member_active_booking_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.is_guest_booking is true
     or new.deleted_at is not null
     or new.status not in ('confirmed', 'pending_approval')
     or new.start_time < now() then
    return new;
  end if;

  select max_active_bookings_per_member
    into v_limit
  from public.booking_rules_settings
  order by updated_at desc nulls last
  limit 1;

  if coalesce(v_limit, 0) <= 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.student_id::text, 0));

  select count(*)
    into v_count
  from public.bookings booking
  where booking.student_id = new.student_id
    and booking.id is distinct from new.id
    and booking.is_guest_booking is not true
    and booking.deleted_at is null
    and booking.status in ('confirmed', 'pending_approval')
    and booking.start_time >= now();

  if v_count >= v_limit then
    raise exception 'This member already has the maximum of % active future bookings', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_member_active_booking_limit_trigger on public.bookings;
create trigger enforce_member_active_booking_limit_trigger
before insert or update of student_id, start_time, status, deleted_at, is_guest_booking
on public.bookings
for each row execute function public.enforce_member_active_booking_limit();

create or replace function public.apply_booking_conflict_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy text := 'waitlist';
  v_has_conflict boolean := false;
begin
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
      and existing.status = 'confirmed'
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
  elsif new.waitlist_reason = 'resource_conflict' then
    new.has_conflict := false;
    new.waitlist_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists apply_booking_conflict_policy_trigger on public.bookings;
create trigger apply_booking_conflict_policy_trigger
before insert or update of aircraft_id, instructor_id, start_time, end_time, status, deleted_at
on public.bookings
for each row execute function public.apply_booking_conflict_policy();

create or replace function public.notify_booking_cancellation_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hirer_name text;
begin
  if old.deleted_at is null
     and new.deleted_at is not null
     and coalesce(new.cancellation_fee_amount, 0) > 0 then
    select coalesce(nullif(trim(name), ''), email, 'Member')
      into v_hirer_name
    from public.users
    where id = new.student_id;

    insert into public.notifications (user_id, type, title, message, booking_id, metadata)
    select admin_id,
           'billing',
           'Cancellation fee requires review',
           coalesce(v_hirer_name, new.guest_name, 'A hirer') || ' cancelled a booking with a '
             || to_char(new.cancellation_fee_amount, 'FM$999,999,990.00') || ' '
             || replace(coalesce(new.cancellation_fee_type, 'cancellation'), '_', ' ') || ' fee.',
           new.id,
           jsonb_build_object(
             'booking_id', new.id,
             'reason', new.cancellation_reason_name,
             'fee_type', new.cancellation_fee_type,
             'fee_amount', new.cancellation_fee_amount
           )
    from (
      select id as admin_id from public.users where role = 'admin'
      union
      select user_id from public.user_roles where role = 'admin'
    ) admins;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_booking_cancellation_fee_trigger on public.bookings;
create trigger notify_booking_cancellation_fee_trigger
after update of deleted_at, cancellation_fee_amount on public.bookings
for each row execute function public.notify_booking_cancellation_fee();

drop policy if exists "Admins and instructors can insert instructor_weekly_schedules" on public.instructor_weekly_schedules;
drop policy if exists "Admins and instructors can update instructor_weekly_schedules" on public.instructor_weekly_schedules;
drop policy if exists "Admins and instructors can delete instructor_weekly_schedules" on public.instructor_weekly_schedules;

create policy "Admins can insert any instructor weekly schedule"
  on public.instructor_weekly_schedules for insert to authenticated
  with check (public.current_user_is_admin());
create policy "Admins can update any instructor weekly schedule"
  on public.instructor_weekly_schedules for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Admins can delete any instructor weekly schedule"
  on public.instructor_weekly_schedules for delete to authenticated
  using (public.current_user_is_admin());
create policy "Instructors can insert own weekly schedule"
  on public.instructor_weekly_schedules for insert to authenticated
  with check (
    coalesce(user_id, instructor_id) = (select auth.uid())
    and public.current_user_has_staff_role()
  );
create policy "Instructors can update own weekly schedule"
  on public.instructor_weekly_schedules for update to authenticated
  using (
    coalesce(user_id, instructor_id) = (select auth.uid())
    and public.current_user_has_staff_role()
  )
  with check (
    coalesce(user_id, instructor_id) = (select auth.uid())
    and public.current_user_has_staff_role()
  );
create policy "Instructors can delete own weekly schedule"
  on public.instructor_weekly_schedules for delete to authenticated
  using (
    coalesce(user_id, instructor_id) = (select auth.uid())
    and public.current_user_has_staff_role()
  );

drop policy if exists "Admins and instructors can insert instructor_schedule_changes" on public.instructor_schedule_changes;
drop policy if exists "Admins and instructors can update instructor_schedule_changes" on public.instructor_schedule_changes;
drop policy if exists "Admins and instructors can delete instructor_schedule_changes" on public.instructor_schedule_changes;

create policy "Admins can insert any instructor schedule change"
  on public.instructor_schedule_changes for insert to authenticated
  with check (public.current_user_is_admin());
create policy "Admins can update any instructor schedule change"
  on public.instructor_schedule_changes for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Admins can delete any instructor schedule change"
  on public.instructor_schedule_changes for delete to authenticated
  using (public.current_user_is_admin());
create policy "Instructors can insert own schedule change"
  on public.instructor_schedule_changes for insert to authenticated
  with check (
    coalesce(user_id, instructor_id) = (select auth.uid())
    and public.current_user_has_staff_role()
  );
create policy "Instructors can update own schedule change"
  on public.instructor_schedule_changes for update to authenticated
  using (
    coalesce(user_id, instructor_id) = (select auth.uid())
    and public.current_user_has_staff_role()
  )
  with check (
    coalesce(user_id, instructor_id) = (select auth.uid())
    and public.current_user_has_staff_role()
  );
create policy "Instructors can delete own schedule change"
  on public.instructor_schedule_changes for delete to authenticated
  using (
    coalesce(user_id, instructor_id) = (select auth.uid())
    and public.current_user_has_staff_role()
  );

create or replace function public.release_aircraft_auto_grounding(
  p_aircraft_id uuid,
  p_defect_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registration text;
begin
  update public.aircraft aircraft
  set status = coalesce(nullif(aircraft.status_before_auto_grounding, ''), 'serviceable'),
      auto_grounded_until = null,
      auto_grounded_by_defect_id = null,
      status_before_auto_grounding = null
  where aircraft.id = p_aircraft_id
    and (p_defect_id is null or aircraft.auto_grounded_by_defect_id = p_defect_id)
    and not exists (
      select 1
      from public.defects defect
      where defect.aircraft_id = aircraft.id
        and defect.id is distinct from p_defect_id
        and defect.status = 'open'
        and defect.severity in ('Major', 'Critical')
        and coalesce(defect.grounded_aircraft, false)
    )
  returning registration into v_registration;

  if v_registration is null then
    return;
  end if;

  update public.bookings candidate
  set has_conflict = exists (
        select 1
        from public.bookings confirmed
        where confirmed.id <> candidate.id
          and confirmed.deleted_at is null
          and confirmed.status = 'confirmed'
          and coalesce(confirmed.has_conflict, false) is false
          and confirmed.start_time < candidate.end_time
          and confirmed.end_time > candidate.start_time
          and (
            confirmed.aircraft_id = candidate.aircraft_id
            or (candidate.instructor_id is not null and confirmed.instructor_id = candidate.instructor_id)
          )
      ),
      waitlist_reason = case
        when exists (
          select 1
          from public.bookings confirmed
          where confirmed.id <> candidate.id
            and confirmed.deleted_at is null
            and confirmed.status = 'confirmed'
            and coalesce(confirmed.has_conflict, false) is false
            and confirmed.start_time < candidate.end_time
            and confirmed.end_time > candidate.start_time
            and (
              confirmed.aircraft_id = candidate.aircraft_id
              or (candidate.instructor_id is not null and confirmed.instructor_id = candidate.instructor_id)
            )
        ) then 'resource_conflict' else null end,
      waitlisted_by_defect_id = null
  where candidate.waitlisted_by_defect_id = p_defect_id
     or (p_defect_id is null and candidate.aircraft_id = p_aircraft_id and candidate.waitlist_reason = 'aircraft_grounding');

  insert into public.notifications (user_id, type, title, message, metadata)
  select admin_id, 'system', 'Temporary aircraft grounding ended',
         v_registration || ' has reached the end of its automatic grounding period. Review the defect and any affected bookings.',
         jsonb_build_object('aircraft_id', p_aircraft_id, 'defect_id', p_defect_id)
  from (
    select id as admin_id from public.users where role = 'admin'
    union
    select user_id from public.user_roles where role = 'admin'
  ) admins;
end;
$$;

create or replace function public.release_expired_aircraft_auto_groundings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  grounding record;
begin
  for grounding in
    select id, auto_grounded_by_defect_id
    from public.aircraft
    where auto_grounded_until is not null
      and auto_grounded_until <= now()
  loop
    perform public.release_aircraft_auto_grounding(grounding.id, grounding.auto_grounded_by_defect_id);
  end loop;
end;
$$;

create or replace function public.handle_aircraft_grounding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := true;
  v_duration_hours numeric := 24;
  v_grounded_until timestamptz;
  v_registration text;
  v_affected_bookings integer := 0;
  v_should_ground boolean;
begin
  select
    coalesce((settings ->> 'autoGroundOnMajorDefect')::boolean, true),
    greatest(1, coalesce((settings ->> 'autoGroundDurationHours')::numeric, 24))
  into v_enabled, v_duration_hours
  from public.maintenance_settings
  order by updated_at desc nulls last
  limit 1;

  v_should_ground := coalesce(v_enabled, true)
    and new.severity in ('Major', 'Critical')
    and new.status = 'open';

  if v_should_ground and (
    tg_op = 'INSERT'
    or old.severity is distinct from new.severity
    or old.status is distinct from new.status
    or coalesce(old.grounded_aircraft, false) is false
  ) then
    v_grounded_until := now() + make_interval(secs => (v_duration_hours * 3600)::integer);
    new.grounded_aircraft := true;

    update public.aircraft
    set status_before_auto_grounding = case
          when auto_grounded_until is null then status
          else status_before_auto_grounding
        end,
        status = 'unserviceable',
        auto_grounded_until = v_grounded_until,
        auto_grounded_by_defect_id = new.id
    where id = new.aircraft_id
    returning registration into v_registration;

    update public.bookings
    set has_conflict = true,
        waitlist_reason = 'aircraft_grounding',
        waitlisted_by_defect_id = new.id
    where aircraft_id = new.aircraft_id
      and deleted_at is null
      and status in ('confirmed', 'pending_approval')
      and start_time < v_grounded_until
      and end_time > now();
    get diagnostics v_affected_bookings = row_count;

    insert into public.notifications (user_id, type, title, message, metadata)
    select admin_id, 'conflict', 'Aircraft auto-grounded',
           coalesce(v_registration, 'Aircraft') || ' is temporarily grounded until '
             || to_char(v_grounded_until at time zone 'Australia/Melbourne', 'DD Mon YYYY HH24:MI')
             || '. ' || v_affected_bookings || ' affected booking(s) were moved to the waiting list.',
           jsonb_build_object(
             'aircraft_id', new.aircraft_id,
             'defect_id', new.id,
             'grounded_until', v_grounded_until,
             'affected_bookings', v_affected_bookings
           )
    from (
      select id as admin_id from public.users where role = 'admin'
      union
      select user_id from public.user_roles where role = 'admin'
    ) admins;
  elsif tg_op = 'UPDATE'
    and coalesce(old.grounded_aircraft, false)
    and (new.status <> 'open' or new.severity not in ('Major', 'Critical')) then
    new.grounded_aircraft := false;
    perform public.release_aircraft_auto_grounding(new.aircraft_id, new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trigger_aircraft_grounding on public.defects;
create trigger trigger_aircraft_grounding
before insert or update on public.defects
for each row execute function public.handle_aircraft_grounding();

revoke all on function public.release_aircraft_auto_grounding(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_expired_aircraft_auto_groundings() from public, anon, authenticated;
revoke all on function public.handle_aircraft_grounding() from public, anon, authenticated;
revoke all on function public.enforce_member_active_booking_limit() from public, anon, authenticated;
revoke all on function public.apply_booking_conflict_policy() from public, anon, authenticated;
revoke all on function public.notify_booking_cancellation_fee() from public, anon, authenticated;
grant execute on function public.release_aircraft_auto_grounding(uuid, uuid) to service_role;
grant execute on function public.release_expired_aircraft_auto_groundings() to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'release-expired-aircraft-groundings' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'release-expired-aircraft-groundings',
    '*/5 * * * *',
    'select public.release_expired_aircraft_auto_groundings()'
  );
end;
$$;
