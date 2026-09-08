-- This reserved row is a configuration/foreign-key anchor, not an individual fleet aircraft.
alter table public.aircraft add column private_booking_enabled boolean not null default false;
insert into public.aircraft(id, registration, make, model, type, status, total_hours)
values ('00000000-0000-4000-8000-000000000001', 'Private aircraft', '', 'Instruction only', 'single-engine', 'serviceable', 0);
alter table public.bookings add column private_aircraft_type text, add column private_aircraft_registration text;
alter table public.flight_logs add column private_aircraft_type text, add column private_aircraft_registration text,
  add column private_aircraft_rate_snapshot jsonb;

create or replace function public.validate_private_aircraft_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.aircraft_id = '00000000-0000-4000-8000-000000000001'::uuid then
    if tg_op = 'INSERT' or old.aircraft_id is distinct from new.aircraft_id then
      if not (select private_booking_enabled from public.aircraft where id = new.aircraft_id) then
        raise exception 'Private aircraft bookings are disabled in Settings.';
      end if;
    end if;
    new.private_aircraft_type := nullif(btrim(new.private_aircraft_type), '');
    new.private_aircraft_registration := nullif(upper(regexp_replace(new.private_aircraft_registration, '\s+', '', 'g')), '');
    if new.instructor_id is null or new.private_aircraft_type is null or new.private_aircraft_registration is null then
      raise exception 'Private aircraft instruction requires an instructor, aircraft type and registration.';
    end if;
    if length(new.private_aircraft_type) > 100 or length(new.private_aircraft_registration) > 30 then
      raise exception 'Aircraft type must be at most 100 characters and registration at most 30 characters.';
    end if;
    if new.trial_flight_voucher_id is not null then
      raise exception 'Private aircraft instruction cannot use a club-aircraft trial flight voucher.';
    end if;
    new.booking_kind := 'flight';
  else
    new.private_aircraft_type := null;
    new.private_aircraft_registration := null;
  end if;
  return new;
end;
$$;
create trigger aa_validate_private_aircraft_booking before insert or update on public.bookings
for each row execute function public.validate_private_aircraft_booking();

create or replace function public.validate_private_aircraft_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings%rowtype;
  v_rate jsonb;
  v_cost numeric;
begin
  if new.aircraft_id is distinct from '00000000-0000-4000-8000-000000000001'::uuid then
    new.private_aircraft_type := null; new.private_aircraft_registration := null; new.private_aircraft_rate_snapshot := null;
    return new;
  end if;
  if new.booking_id is not null then
    select * into v_booking from public.bookings where id = new.booking_id;
    if v_booking.aircraft_id is distinct from new.aircraft_id or v_booking.instructor_id is distinct from new.instructor_id
      or v_booking.student_id is distinct from new.student_id then
      raise exception 'Private flight aircraft option, instructor and member or guest must match the booking.';
    end if;
  end if;
  new.private_aircraft_type := nullif(btrim(coalesce(new.private_aircraft_type, v_booking.private_aircraft_type)), '');
  new.private_aircraft_registration := nullif(upper(regexp_replace(coalesce(new.private_aircraft_registration, v_booking.private_aircraft_registration), '\s+', '', 'g')), '');
  if new.instructor_id is null or new.private_aircraft_type is null or new.private_aircraft_registration is null
    or length(new.private_aircraft_type) > 100 or length(new.private_aircraft_registration) > 30 then
    raise exception 'Private aircraft logs require an instructor, aircraft type (up to 100 characters) and registration (up to 30 characters).';
  end if;
  if coalesce(new.flight_duration,0) <= 0 or new.dual_time is null or coalesce(new.solo_time, 0) <> 0 or abs(new.dual_time - new.flight_duration) > 0.001 then
    raise exception 'Private aircraft instruction requires positive flying hours allocated entirely to dual time.';
  end if;
  -- There is no cumulative fleet meter for this system option.
  new.start_tach := 0; new.end_tach := new.flight_duration;
  if tg_op = 'UPDATE' and old.private_aircraft_rate_snapshot is not null
    and old.flight_type_id is not distinct from new.flight_type_id then
    v_rate := old.private_aircraft_rate_snapshot;
  elsif not new.financial_capture_suppressed then
    select to_jsonb(r) into v_rate from public.aircraft_rates r
      join public.flight_types ft on ft.id = r.flight_type_id and ft.active
      where r.aircraft_id = new.aircraft_id and r.flight_type_id = new.flight_type_id;
    if v_rate is null or v_rate->>'charge_type' = 'not_used' then
      raise exception 'Configure an available private aircraft rate for the selected Payment Type before logging.';
    end if;
  end if;
  new.private_aircraft_rate_snapshot := v_rate;
  if not new.financial_capture_suppressed then
    v_cost := case v_rate->>'charge_type'
      when 'free' then 0
      when 'flat' then (v_rate->>'dual_rate')::numeric
      else (v_rate->>'dual_rate')::numeric * new.flight_duration end;
    if v_rate->>'charge_type' <> 'free' then
      v_cost := v_cost + coalesce((v_rate->>'flat_surcharge')::numeric, 0)
        + case when extract(isodow from new.start_time at time zone 'Australia/Sydney') in (6,7)
          then coalesce((v_rate->>'weekend_surcharge')::numeric, 0) else 0 end;
    end if;
    -- Metadata-only edits preserve the amount originally billed.
    if tg_op = 'UPDATE' and new.flight_duration = old.flight_duration and new.flight_type_id is not distinct from old.flight_type_id
      and new.start_time = old.start_time then
      v_cost := old.calculated_cost;
    end if;
    v_cost := round(greatest(v_cost, 0), 2);
    if tg_op = 'INSERT' and new.calculated_cost is distinct from v_cost then
      raise exception 'The private aircraft rate has changed. Reload the flight log and review the charge before saving.';
    end if;
    if tg_op = 'UPDATE' and v_cost is distinct from old.calculated_cost
      and (old.payment_status = 'paid' or old.xero_invoice_id is not null or old.stripe_checkout_session_id is not null) then
      raise exception 'This flight has a payment or invoice. Reverse the linked billing before changing its charge.';
    end if;
    new.calculated_cost := v_cost;
    new.total_cost := new.calculated_cost;
  end if;
  return new;
end;
$$;
create trigger aa_validate_private_aircraft_log before insert or update on public.flight_logs
for each row execute function public.validate_private_aircraft_log();

create or replace function public.hydrate_private_aircraft_training_record()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text; v_registration text;
begin
  if new.flight_log_id is not null then
    select private_aircraft_type, private_aircraft_registration into v_type, v_registration
      from public.flight_logs where id = new.flight_log_id;
  elsif new.booking_id is not null and (tg_op = 'INSERT' or new.booking_id is distinct from old.booking_id) then
    select private_aircraft_type, private_aircraft_registration into v_type, v_registration
      from public.bookings where id = new.booking_id;
  end if;
  if v_registration is not null then
    new.aircraft_type := v_type; new.registration := v_registration;
    new.aircraft_id := '00000000-0000-4000-8000-000000000001'::uuid;
  end if;
  return new;
end;
$$;
create trigger zz_hydrate_private_aircraft_training_record before insert or update on public.training_records
for each row execute function public.hydrate_private_aircraft_training_record();

create or replace function public.sync_private_aircraft_training_records()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.private_aircraft_registration is not null then
    update public.training_records set registration = new.private_aircraft_registration, aircraft_type = new.private_aircraft_type
      where flight_log_id = new.id;
  end if;
  return new;
end;
$$;
create trigger sync_private_aircraft_training_records after insert or update of private_aircraft_type, private_aircraft_registration on public.flight_logs
for each row execute function public.sync_private_aircraft_training_records();

create or replace function public.protect_private_aircraft_option()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.id = '00000000-0000-4000-8000-000000000001'::uuid then
    if tg_op = 'DELETE' then raise exception 'The system Private aircraft option cannot be deleted.'; end if;
    if new.id <> old.id or new.registration <> old.registration or new.is_archived or new.status <> 'serviceable' then
      raise exception 'The system Private aircraft option can only be enabled or disabled in Settings.';
    end if;
    new.total_hours := 0;
  end if;
  return new;
end;
$$;
create trigger aa_protect_private_aircraft_option before update or delete on public.aircraft
for each row execute function public.protect_private_aircraft_option();

create or replace function public.save_private_aircraft_configuration(p_enabled boolean, p_rates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not coalesce(public.current_user_is_admin(), false) then raise exception 'Administrator access required.'; end if;
  if jsonb_typeof(p_rates) <> 'array' then raise exception 'Rates must be an array.'; end if;
  for r in select value from jsonb_array_elements(p_rates) loop
    if r->>'chargeType' not in ('tach','flat','free','not_used')
      or coalesce((r->>'dualRate')::numeric, -1) < 0
      or coalesce((r->>'flatSurcharge')::numeric, -1) < 0
      or coalesce((r->>'weekendSurcharge')::numeric, -1) < 0 then
      raise exception 'Private aircraft rates and surcharges must be non-negative with a supported charge basis.';
    end if;
    if r->>'chargeType' in ('tach','flat') and (r->>'dualRate')::numeric <= 0 then
      raise exception 'Enter a positive instruction rate, or explicitly select No charge.';
    end if;
    insert into public.aircraft_rates(aircraft_id, flight_type_id, charge_type, solo_rate, dual_rate, flat_surcharge, weekend_surcharge, default_payment_method_id, included_taxes)
    values ('00000000-0000-4000-8000-000000000001', (r->>'flightTypeId')::uuid, r->>'chargeType', 0,
      (r->>'dualRate')::numeric, (r->>'flatSurcharge')::numeric, (r->>'weekendSurcharge')::numeric,
      nullif(r->>'defaultPaymentMethodId','')::uuid, 0)
    on conflict (aircraft_id, flight_type_id) where flight_type_id is not null do update set charge_type = excluded.charge_type, solo_rate = 0,
      dual_rate = excluded.dual_rate, flat_surcharge = excluded.flat_surcharge, weekend_surcharge = excluded.weekend_surcharge,
      default_payment_method_id = excluded.default_payment_method_id, updated_at = now();
  end loop;
  update public.aircraft set private_booking_enabled = p_enabled, updated_at = now()
    where id = '00000000-0000-4000-8000-000000000001';
end;
$$;

revoke all on function public.validate_private_aircraft_booking(), public.validate_private_aircraft_log(),
  public.hydrate_private_aircraft_training_record(), public.sync_private_aircraft_training_records(),
  public.protect_private_aircraft_option() from public, anon, authenticated, service_role;
revoke all on function public.save_private_aircraft_configuration(boolean,jsonb) from public, anon;
grant execute on function public.save_private_aircraft_configuration(boolean,jsonb) to authenticated, service_role;


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
          (case when new.aircraft_id is not null and new.aircraft_id <> '00000000-0000-4000-8000-000000000001'::uuid then 'aircraft:' || new.aircraft_id::text end),
          (case when new.instructor_id is not null then 'instructor:' || new.instructor_id::text end),
          (case when old.aircraft_id is not null and old.aircraft_id <> '00000000-0000-4000-8000-000000000001'::uuid then 'aircraft:' || old.aircraft_id::text end),
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
          (case when new.aircraft_id is not null and new.aircraft_id <> '00000000-0000-4000-8000-000000000001'::uuid then 'aircraft:' || new.aircraft_id::text end),
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
        (new.aircraft_id is not null and new.aircraft_id <> '00000000-0000-4000-8000-000000000001'::uuid and existing.aircraft_id = new.aircraft_id)
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
          (case when candidate.aircraft_id is not null and candidate.aircraft_id <> '00000000-0000-4000-8000-000000000001'::uuid then 'aircraft:' || candidate.aircraft_id::text end),
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
          (candidate.aircraft_id is not null and candidate.aircraft_id <> '00000000-0000-4000-8000-000000000001'::uuid and blocker.aircraft_id = candidate.aircraft_id)
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

create or replace function public.find_next_available_slots(
  p_after timestamptz default now(),
  p_duration_minutes integer default 120,
  p_search_days integer default 30,
  p_aircraft_ids uuid[] default null,
  p_instructor_ids uuid[] default null,
  p_location_id uuid default null,
  p_limit integer default 8
) returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  aircraft_id uuid,
  aircraft_registration text,
  aircraft_description text,
  instructor_id uuid,
  instructor_name text,
  location_id uuid,
  location_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_location_id uuid;
  v_location_name text;
  v_local_start timestamp;
  v_candidate_start timestamptz;
  v_candidate_end timestamptz;
  v_match record;
  v_match_limit integer := least(greatest(p_limit, 1), 20);
  v_match_count integer := 0;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Authentication required';
  end if;
  if p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'Duration must be between 15 minutes and 8 hours';
  end if;
  if p_search_days < 1 or p_search_days > 90 then
    raise exception 'Search range must be between 1 and 90 days';
  end if;

  select l.id, l.name
    into v_location_id, v_location_name
  from public.duty_clock_locations l
  where l.is_active
    and (p_location_id is null or l.id = p_location_id)
  order by
    case when p_location_id is not null and l.id = p_location_id then 0 else 1 end,
    l.is_primary desc,
    l.name
  limit 1;

  if v_location_id is null then
    return;
  end if;

  -- Search chronologically and stop as soon as the requested number of matches
  -- is found. The previous cross-product built and sorted every slot, aircraft
  -- and instructor combination for the whole range before applying LIMIT.
  for v_local_start in
    select generated
    from generate_series(
      date_trunc('day', p_after at time zone 'Australia/Sydney') + interval '6 hours',
      date_trunc('day', p_after at time zone 'Australia/Sydney')
        + make_interval(days => p_search_days - 1) + interval '20 hours',
      interval '15 minutes'
    ) generated
    where generated::time >= time '06:00'
      and generated::time + make_interval(mins => p_duration_minutes) <= time '20:00'
  loop
    v_candidate_start := v_local_start at time zone 'Australia/Sydney';
    v_candidate_end := (v_local_start + make_interval(mins => p_duration_minutes))
      at time zone 'Australia/Sydney';

    if v_candidate_start < p_after then
      continue;
    end if;

    for v_match in
      with eligible_instructors as materialized (
        select u.id, u.name
        from public.users u
        where coalesce(u.is_active, true)
          and (p_instructor_ids is null or u.id = any(p_instructor_ids))
          and exists (
            select 1
            from public.user_roles ur
            where ur.user_id = u.id
              and ur.role in ('instructor', 'senior_instructor', 'admin')
          )
          and public.instructor_available_at_location_for_slot(
            u.id,
            v_candidate_start,
            v_candidate_end,
            v_location_id
          )
      )
      select
        a.id as aircraft_id,
        a.registration,
        concat_ws(' ', a.make, a.model) as aircraft_description,
        i.id as instructor_id,
        i.name as instructor_name
      from public.aircraft a
      cross join eligible_instructors i
      where a.status = 'serviceable'
        and (a.id <> '00000000-0000-4000-8000-000000000001'::uuid or a.private_booking_enabled)
        and not coalesce(a.is_archived, false)
        and (p_aircraft_ids is null or a.id = any(p_aircraft_ids))
        and not exists (
          select 1
          from public.bookings b
          where b.deleted_at is null
            and b.status not in ('cancelled', 'no-show')
            and b.start_time < v_candidate_end
            and b.end_time > v_candidate_start
            and (
              (b.aircraft_id = a.id and a.id <> '00000000-0000-4000-8000-000000000001'::uuid)
              or b.instructor_id = i.id
            )
        )
      order by a.registration, i.name
      limit v_match_limit - v_match_count
    loop
      slot_start := v_candidate_start;
      slot_end := v_candidate_end;
      aircraft_id := v_match.aircraft_id;
      aircraft_registration := v_match.registration;
      aircraft_description := v_match.aircraft_description;
      instructor_id := v_match.instructor_id;
      instructor_name := v_match.instructor_name;
      location_id := v_location_id;
      location_name := v_location_name;
      return next;

      v_match_count := v_match_count + 1;
      if v_match_count >= v_match_limit then
        return;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.update_recurring_booking_series_with_aircraft_details(
  p_booking_id uuid,
  p_new_start timestamptz,
  p_new_end timestamptz,
  p_student_id uuid,
  p_instructor_id uuid,
  p_aircraft_id uuid,
  p_payment_type text,
  p_notes text,
  p_booking_kind text,
  p_flight_type_id uuid,
  p_is_guest_booking boolean,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_trial_flight_voucher_id uuid,
  p_casual_contact_id uuid,
  p_booking_purpose text,
  p_location text,
  p_location_id uuid,
  p_duty_override_reason text default null,
  p_membership_override_reason text default null,
  p_private_aircraft_type text default null,
  p_private_aircraft_registration text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source public.bookings%rowtype;
  v_target public.bookings%rowtype;
  v_is_staff boolean := false;
  v_start_delta interval;
  v_end_delta interval;
  v_updated_count integer := 0;
  v_batch_id uuid := gen_random_uuid();
  v_old_recipients uuid[] := array[]::uuid[];
  v_first_start timestamptz;
  v_last_start timestamptz;
  v_local_timezone text := 'Australia/Sydney';
  v_summary_message text;
begin
  if p_booking_id is null then
    raise exception 'A booking is required' using errcode = '22023';
  end if;
  if p_new_start is null or p_new_end is null or p_new_end <= p_new_start then
    raise exception 'End time must be after start time' using errcode = '22023';
  end if;
  if p_student_id is null then
    raise exception 'A pilot or student is required' using errcode = '22023';
  end if;
  if p_booking_kind not in ('flight', 'ground') then
    raise exception 'Booking kind must be flight or ground' using errcode = '22023';
  end if;
  if p_booking_kind = 'flight' and p_aircraft_id is null then
    raise exception 'Aircraft is required for a flight booking' using errcode = '22023';
  end if;
  if p_booking_kind = 'ground' and p_instructor_id is null then
    raise exception 'Instructor is required for a ground session' using errcode = '22023';
  end if;

  select * into v_source
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_source.recurrence_series_id is null or v_source.recurrence_occurrence_index is null then
    raise exception 'This booking is not linked to a recurring series' using errcode = '22023';
  end if;
  if v_source.deleted_at is not null or v_source.status in ('cancelled', 'no-show', 'completed') then
    raise exception 'Only an active recurring booking can be edited' using errcode = '22023';
  end if;

  v_is_staff := public.current_user_has_staff_role();
  if auth.role() <> 'service_role' and (
    v_actor_id is null
    or not (
      v_is_staff
      or (
        public.current_user_has_full_portal_access()
        and v_source.student_id = v_actor_id
        and p_student_id = v_actor_id
      )
    )
  ) then
    raise exception 'You cannot update this recurring booking series' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_source.recurrence_series_id::text, 0));

  if exists (
    select 1
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
      and (
        coalesce(b.flight_logged, false)
        or coalesce(b.ground_session_logged, false)
        or exists (select 1 from public.flight_logs fl where fl.booking_id = b.id)
        or exists (select 1 from public.ground_session_logs gl where gl.booking_id = b.id)
      )
  ) then
    raise exception 'A future occurrence already has a flight or ground-session log. Edit that occurrence separately.'
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct recipient_id) filter (where recipient_id is not null), array[]::uuid[])
    into v_old_recipients
  from (
    select b.student_id as recipient_id
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
    union
    select b.instructor_id
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
    union
    select b.supervising_instructor_id
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
  ) recipients;

  v_start_delta := p_new_start - v_source.start_time;
  v_end_delta := p_new_end - v_source.end_time;
  perform set_config('bfc.recurring_edit_series_id', v_source.recurrence_series_id::text, true);

  -- Directional ordering prevents a shifted occurrence from colliding with the
  -- old slot of another occurrence that is also moving in this transaction.
  for v_target in
    select b.*
    from public.bookings b
    where b.recurrence_series_id = v_source.recurrence_series_id
      and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
      and b.deleted_at is null
      and b.status not in ('cancelled', 'no-show', 'completed')
    order by
      case when v_start_delta >= interval '0' then b.recurrence_occurrence_index end desc nulls last,
      case when v_start_delta < interval '0' then b.recurrence_occurrence_index end asc nulls last,
      b.id
    for update
  loop
    if v_target.end_time + v_end_delta <= v_target.start_time + v_start_delta then
      raise exception 'The requested change would make an occurrence end before it starts'
        using errcode = '22023';
    end if;

    update public.bookings b
       set student_id = p_student_id,
           instructor_id = p_instructor_id,
           aircraft_id = case when p_booking_kind = 'ground' then null else p_aircraft_id end,
           private_aircraft_type = p_private_aircraft_type,
           private_aircraft_registration = p_private_aircraft_registration,
           start_time = v_target.start_time + v_start_delta,
           end_time = v_target.end_time + v_end_delta,
           payment_type = coalesce(p_payment_type, ''),
           notes = nullif(btrim(coalesce(p_notes, '')), ''),
           booking_kind = p_booking_kind,
           flight_type_id = p_flight_type_id,
           is_guest_booking = coalesce(p_is_guest_booking, false),
           guest_name = nullif(btrim(coalesce(p_guest_name, '')), ''),
           guest_email = nullif(btrim(coalesce(p_guest_email, '')), ''),
           guest_phone = nullif(btrim(coalesce(p_guest_phone, '')), ''),
           trial_flight_voucher_id = p_trial_flight_voucher_id,
           casual_contact_id = p_casual_contact_id,
           booking_purpose = coalesce(nullif(btrim(p_booking_purpose), ''), 'standard'),
           location = nullif(btrim(coalesce(p_location, '')), ''),
           location_id = p_location_id,
           duty_override_reason = nullif(btrim(coalesce(p_duty_override_reason, '')), ''),
           membership_override_reason = coalesce(
             nullif(btrim(coalesce(p_membership_override_reason, '')), ''),
             b.membership_override_reason
           ),
           updated_at = now()
     where b.id = v_target.id;

    v_updated_count := v_updated_count + 1;
  end loop;

  if v_updated_count = 0 then
    raise exception 'No active future occurrences were found' using errcode = 'P0002';
  end if;

  -- Re-open any genuinely available slots only after the full final schedule
  -- exists. Notifications for unrelated promoted bookings remain enabled.
  perform public.promote_available_resource_waitlist();

  select min(b.start_time), max(b.start_time)
    into v_first_start, v_last_start
  from public.bookings b
  where b.recurrence_series_id = v_source.recurrence_series_id
    and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
    and b.deleted_at is null
    and b.status not in ('cancelled', 'no-show', 'completed');

  select coalesce(nullif(timezone, ''), v_local_timezone)
    into v_local_timezone
  from public.organisation_settings
  order by updated_at desc nulls last
  limit 1;

  v_summary_message := format(
    '%s recurring %s updated from %s to %s.',
    v_updated_count,
    case when v_updated_count = 1 then 'booking was' else 'bookings were' end,
    to_char(v_first_start at time zone v_local_timezone, 'DD Mon YYYY HH24:MI'),
    to_char(v_last_start at time zone v_local_timezone, 'DD Mon YYYY HH24:MI')
  );

  perform set_config('bfc.recurring_edit_series_id', '', true);

  with recipients as (
    select unnest(v_old_recipients) as user_id
    union select b.student_id
      from public.bookings b
     where b.recurrence_series_id = v_source.recurrence_series_id
       and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
       and b.deleted_at is null and b.status not in ('cancelled', 'no-show', 'completed')
    union select b.instructor_id
      from public.bookings b
     where b.recurrence_series_id = v_source.recurrence_series_id
       and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
       and b.deleted_at is null and b.status not in ('cancelled', 'no-show', 'completed')
    union select b.supervising_instructor_id
      from public.bookings b
     where b.recurrence_series_id = v_source.recurrence_series_id
       and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
       and b.deleted_at is null and b.status not in ('cancelled', 'no-show', 'completed')
    union select u.id
      from public.users u
     where coalesce(u.is_active, true)
       and exists (
         select 1 from public.bookings b
          where b.recurrence_series_id = v_source.recurrence_series_id
            and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
            and b.deleted_at is null and b.status = 'pending_approval'
       )
       and (
         u.role = 'admin'
         or exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin')
       )
    union select u.id
      from public.users u
     where coalesce(u.is_active, true)
       and exists (
         select 1 from public.bookings b
          where b.recurrence_series_id = v_source.recurrence_series_id
            and b.recurrence_occurrence_index >= v_source.recurrence_occurrence_index
            and b.deleted_at is null and b.status = 'pending_supervision'
       )
       and (
         u.role in ('admin', 'cfi')
         or exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role in ('admin', 'cfi'))
         or exists (
           select 1 from public.senior_instructor_authorisations a
            where a.instructor_id = u.id and a.is_active
         )
       )
  )
  insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
  select recipient.user_id,
         'booking',
         'Recurring booking series updated',
         v_summary_message,
         p_booking_id,
         jsonb_build_object(
           'notification_kind', 'booking_change',
           'recurring_series_update', true,
           'recurring_edit_batch_id', v_batch_id::text,
           'recurrence_series_id', v_source.recurrence_series_id::text,
           'occurrence_count', v_updated_count,
           'booking_id', p_booking_id::text,
           'route', '/calendar'
         ),
         false
    from recipients recipient
   where recipient.user_id is not null
  on conflict do nothing;

  return jsonb_build_object(
    'seriesId', v_source.recurrence_series_id,
    'updatedCount', v_updated_count,
    'firstStart', v_first_start,
    'lastStart', v_last_start,
    'batchId', v_batch_id
  );
end;
$$;

create or replace view public.calendar_booking_public
with (security_invoker = false, security_barrier = true)
as
with viewer as (
  select
    auth.uid() as uid,
    public.current_user_has_staff_role() as is_staff,
    public.current_user_has_full_portal_access() as has_full_access
)
select
  b.id,
  b.student_id,
  b.instructor_id,
  b.aircraft_id,
  b.start_time,
  b.end_time,
  case when viewer.is_staff or b.student_id = viewer.uid then b.payment_type else null end as payment_type,
  case when viewer.is_staff or b.student_id = viewer.uid then b.notes else null end as notes,
  b.status,
  coalesce(b.has_conflict, false) as has_conflict,
  b.deleted_at,
  coalesce(b.flight_logged, false) as flight_logged,
  case when viewer.is_staff or b.student_id = viewer.uid then b.flight_type_id else null end as flight_type_id,
  case when viewer.is_staff or b.student_id = viewer.uid then b.trial_flight_voucher_id else null end as trial_flight_voucher_id,
  b.is_guest_booking,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_name else null end as guest_name,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_email else null end as guest_email,
  case when viewer.is_staff or b.student_id = viewer.uid then b.guest_phone else null end as guest_phone,
  case
    when viewer.is_staff or b.student_id = viewer.uid then coalesce(b.guest_name, hirer.name)
    else null
  end as hirer_name,
  instructor.name as instructor_name,
  b.recurrence_series_id,
  b.recurrence_occurrence_index,
  b.recurrence_occurrence_count,
  b.recurrence_notifications_finalised_at,
  b.private_aircraft_type,
  b.private_aircraft_registration
from public.bookings b
cross join viewer
left join public.users hirer on hirer.id = b.student_id
left join public.users instructor on instructor.id = b.instructor_id
where viewer.has_full_access;


revoke all on function public.update_recurring_booking_series_with_aircraft_details(uuid,timestamptz,timestamptz,uuid,uuid,uuid,text,text,text,uuid,boolean,text,text,text,uuid,uuid,text,text,uuid,text,text,text,text) from public, anon;
grant execute on function public.update_recurring_booking_series_with_aircraft_details(uuid,timestamptz,timestamptz,uuid,uuid,uuid,text,text,text,uuid,boolean,text,text,text,uuid,uuid,text,text,uuid,text,text,text,text) to authenticated, service_role;

insert into private.function_permission_manifest(signature,function_name,classification,allowed_roles,security_definer,fixed_search_path,rationale,reviewed_at) values
('public.validate_private_aircraft_booking()','validate_private_aircraft_booking','trigger_internal',array[]::text[],true,true,'Requires actual aircraft details and an instructor; preserves disabled historical bookings.',date '2026-09-09'),
('public.validate_private_aircraft_log()','validate_private_aircraft_log','trigger_internal',array[]::text[],true,true,'Validates private instruction and snapshots authoritative rates before billing.',date '2026-09-09'),
('public.hydrate_private_aircraft_training_record()','hydrate_private_aircraft_training_record','trigger_internal',array[]::text[],true,true,'Copies actual private aircraft details into linked training records.',date '2026-09-09'),
('public.sync_private_aircraft_training_records()','sync_private_aircraft_training_records','trigger_internal',array[]::text[],true,true,'Keeps training records aligned with corrected logged aircraft details.',date '2026-09-09'),
('public.protect_private_aircraft_option()','protect_private_aircraft_option','trigger_internal',array[]::text[],false,true,'Protects the preloaded booking option from fleet mutations.',date '2026-09-09'),
('public.save_private_aircraft_configuration(p_enabled boolean, p_rates jsonb)','save_private_aircraft_configuration','authenticated_self_service',array['authenticated','service_role']::text[],true,true,'Administrator-only atomic private aircraft configuration.',date '2026-09-09'),
('public.update_recurring_booking_series_with_aircraft_details(p_booking_id uuid, p_new_start timestamp with time zone, p_new_end timestamp with time zone, p_student_id uuid, p_instructor_id uuid, p_aircraft_id uuid, p_payment_type text, p_notes text, p_booking_kind text, p_flight_type_id uuid, p_is_guest_booking boolean, p_guest_name text, p_guest_email text, p_guest_phone text, p_trial_flight_voucher_id uuid, p_casual_contact_id uuid, p_booking_purpose text, p_location text, p_location_id uuid, p_duty_override_reason text, p_membership_override_reason text, p_private_aircraft_type text, p_private_aircraft_registration text)','update_recurring_booking_series_with_aircraft_details','authenticated_self_service',array['authenticated','service_role']::text[],true,true,'Authorised atomic recurring edits including private aircraft identity.',date '2026-09-09');

select private.assert_function_permission_manifest();
