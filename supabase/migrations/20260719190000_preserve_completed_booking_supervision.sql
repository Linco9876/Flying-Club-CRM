-- Keep the assigned senior instructor on completed bookings for historical
-- visibility and auditability. Cancelled/no-show bookings can still release
-- their supervision assignment.
create or replace function public.prepare_booking_duty_and_supervision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment jsonb;
  v_requirement public.instructor_supervision_requirements%rowtype;
  v_supervisor uuid;
  v_activity text;
  v_should_assess boolean;
  v_existing_supervisor uuid;
  v_existing_supervision_status text;
begin
  if tg_op = 'INSERT' then
    v_should_assess := true;
  else
    v_existing_supervisor := old.supervising_instructor_id;
    v_existing_supervision_status := old.supervision_status;
    v_should_assess := old.instructor_id is distinct from new.instructor_id
      or old.start_time is distinct from new.start_time
      or old.end_time is distinct from new.end_time
      or (old.status is distinct from new.status and new.status in ('confirmed', 'pending_approval', 'pending_supervision'));
  end if;

  if new.instructor_id is not null
    and v_should_assess
    and new.status not in ('cancelled', 'no-show', 'completed')
  then
    v_assessment := public.assess_instructor_duty_booking(new.instructor_id, new.start_time, new.end_time, new.id);
    new.duty_assessment := v_assessment;
    if v_assessment->>'result' = 'warning' and length(btrim(coalesce(new.duty_override_reason, ''))) < 10 then
      raise exception using
        errcode = 'P0001',
        message = 'DUTY_OVERRIDE_REQUIRED|' || v_assessment::text,
        hint = 'Review the duty warning and provide an override reason of at least 10 characters.';
    end if;
  end if;

  if new.status in ('cancelled', 'no-show') then
    new.supervision_required := false;
    new.supervision_status := 'not_required';
    new.supervising_instructor_id := null;
    return new;
  end if;

  if new.status = 'completed' then
    if tg_op = 'UPDATE' then
      new.supervision_required := old.supervision_required;
      new.supervision_status := old.supervision_status;
      new.supervising_instructor_id := old.supervising_instructor_id;
    end if;
    return new;
  end if;

  v_activity := case when coalesce(new.booking_kind, 'flight') = 'ground' then 'ground' else 'flight' end;
  select * into v_requirement
  from public.instructor_supervision_requirements r
  where r.instructor_id = new.instructor_id
    and r.supervision_required
    and r.effective_from <= (new.start_time at time zone 'Australia/Sydney')::date
    and (r.effective_to is null or r.effective_to >= (new.end_time at time zone 'Australia/Sydney')::date)
    and (cardinality(r.activity_types) = 0 or v_activity = any(r.activity_types))
    and (cardinality(r.locations) = 0 or new.location = any(r.locations));

  if not found then
    new.supervision_required := false;
    new.supervision_status := 'not_required';
    new.supervising_instructor_id := null;
    return new;
  end if;

  new.supervision_required := true;
  v_supervisor := public.find_available_supervisor(
    new.instructor_id,
    new.start_time - make_interval(mins => v_requirement.preflight_minutes),
    new.end_time + make_interval(mins => v_requirement.postflight_minutes),
    new.location,
    v_activity,
    new.id
  );
  new.supervising_instructor_id := v_supervisor;

  if v_supervisor is null then
    new.supervision_status := 'pending';
    if new.status = 'confirmed' then
      new.status := 'pending_supervision';
    end if;
  else
    new.supervision_status := case
      when new.supervision_status = 'acknowledged'
        and coalesce(v_existing_supervisor, v_supervisor) = v_supervisor then 'acknowledged'
      when v_existing_supervision_status = 'acknowledged'
        and v_existing_supervisor = v_supervisor then 'acknowledged'
      else 'assigned'
    end;
    if new.status = 'pending_supervision' then
      new.status := 'confirmed';
    end if;
  end if;

  return new;
end;
$$;
