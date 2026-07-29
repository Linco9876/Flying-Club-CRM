-- Ordinary instructors require supervision by role. Senior Instructor and CFI
-- authority remove the automatic requirement, while separately configured
-- manual supervision requirements continue to apply.

alter table public.instructor_supervision_requirements
  add column if not exists role_mandated boolean not null default false;

create or replace function public.instructor_requires_role_supervision(
  p_instructor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      exists (
        select 1
        from public.user_roles role_row
        where role_row.user_id = p_instructor_id
          and role_row.role = 'instructor'
      )
      or exists (
        select 1
        from public.users user_row
        where user_row.id = p_instructor_id
          and user_row.role = 'instructor'
      )
    )
    and not (
      exists (
        select 1
        from public.user_roles role_row
        where role_row.user_id = p_instructor_id
          and role_row.role in ('senior_instructor', 'cfi')
      )
      or exists (
        select 1
        from public.users user_row
        where user_row.id = p_instructor_id
          and user_row.role = 'senior_instructor'
      )
    );
$$;

create or replace function public.protect_role_mandated_supervision_requirement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role_mandated
    and public.instructor_requires_role_supervision(old.instructor_id)
  then
    if tg_op = 'DELETE' then
      raise exception 'Supervision is required while this account has the Instructor role without Senior Instructor or CFI authority';
    end if;

    if not new.role_mandated
      or not new.supervision_required
      or not ('flight' = any(new.activity_types))
      or cardinality(new.locations) <> 0
      or new.effective_from > current_date
      or new.effective_to is not null
    then
      raise exception 'The role-based instructor supervision requirement must remain active for flights at all locations';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_role_mandated_supervision_requirement_trigger
  on public.instructor_supervision_requirements;
create trigger protect_role_mandated_supervision_requirement_trigger
before update or delete on public.instructor_supervision_requirements
for each row execute function public.protect_role_mandated_supervision_requirement();

create or replace function public.reconcile_role_based_supervision_requirements()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.instructor_supervision_requirements (
    instructor_id,
    supervision_required,
    activity_types,
    locations,
    preflight_minutes,
    postflight_minutes,
    effective_from,
    effective_to,
    role_mandated,
    updated_at
  )
  select
    user_row.id,
    true,
    array['flight']::text[],
    '{}'::text[],
    30,
    30,
    current_date,
    null,
    true,
    now()
  from public.users user_row
  where public.instructor_requires_role_supervision(user_row.id)
  on conflict (instructor_id) do update
  set supervision_required = true,
      activity_types = array['flight']::text[],
      locations = '{}'::text[],
      effective_from = least(
        public.instructor_supervision_requirements.effective_from,
        current_date
      ),
      effective_to = null,
      role_mandated = true,
      updated_at = now();

  delete from public.instructor_supervision_requirements requirement
  where requirement.role_mandated
    and not public.instructor_requires_role_supervision(requirement.instructor_id);
end;
$$;

create or replace function public.refresh_role_based_supervision_requirements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconcile_role_based_supervision_requirements();
  return null;
end;
$$;

drop trigger if exists refresh_role_supervision_after_user_roles
  on public.user_roles;
create trigger refresh_role_supervision_after_user_roles
after insert or update or delete on public.user_roles
for each statement execute function public.refresh_role_based_supervision_requirements();

drop trigger if exists refresh_role_supervision_after_primary_role
  on public.users;
create trigger refresh_role_supervision_after_primary_role
after update of role on public.users
for each statement execute function public.refresh_role_based_supervision_requirements();

select public.reconcile_role_based_supervision_requirements();

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
  v_saved_requirement_found boolean;
  v_explicit_requirement boolean;
  v_role_requirement boolean;
  v_preflight_minutes integer := 30;
  v_postflight_minutes integer := 30;
begin
  if tg_op = 'INSERT' then
    v_should_assess := true;
  else
    v_existing_supervisor := old.supervising_instructor_id;
    v_existing_supervision_status := old.supervision_status;
    v_should_assess := old.instructor_id is distinct from new.instructor_id
      or old.start_time is distinct from new.start_time
      or old.end_time is distinct from new.end_time
      or (
        old.status is distinct from new.status
        and new.status in ('confirmed', 'pending_approval', 'pending_supervision')
      );
  end if;

  if new.instructor_id is not null
    and v_should_assess
    and new.status not in ('cancelled', 'no-show', 'completed')
  then
    v_assessment := public.assess_instructor_duty_booking(
      new.instructor_id,
      new.start_time,
      new.end_time,
      new.id
    );
    new.duty_assessment := v_assessment;
    if v_assessment->>'result' = 'warning'
      and length(btrim(coalesce(new.duty_override_reason, ''))) < 10
    then
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

  v_activity := case
    when coalesce(new.booking_kind, 'flight') = 'ground' then 'ground'
    else 'flight'
  end;
  v_role_requirement := v_activity = 'flight'
    and public.instructor_requires_role_supervision(new.instructor_id);

  select *
  into v_requirement
  from public.instructor_supervision_requirements requirement
  where requirement.instructor_id = new.instructor_id
    and requirement.effective_from <= (
      new.start_time at time zone 'Australia/Sydney'
    )::date
    and (
      requirement.effective_to is null
      or requirement.effective_to >= (
        new.end_time at time zone 'Australia/Sydney'
      )::date
    )
  limit 1;

  v_saved_requirement_found := found;
  v_explicit_requirement := v_saved_requirement_found
    and v_requirement.supervision_required
    and (
      cardinality(v_requirement.activity_types) = 0
      or v_activity = any(v_requirement.activity_types)
    )
    and (
      cardinality(v_requirement.locations) = 0
      or new.location = any(v_requirement.locations)
    );

  if not v_role_requirement and not v_explicit_requirement then
    new.supervision_required := false;
    new.supervision_status := 'not_required';
    new.supervising_instructor_id := null;
    return new;
  end if;

  if v_saved_requirement_found then
    v_preflight_minutes := coalesce(v_requirement.preflight_minutes, 30);
    v_postflight_minutes := coalesce(v_requirement.postflight_minutes, 30);
  end if;

  new.supervision_required := true;
  v_supervisor := public.find_available_supervisor(
    new.instructor_id,
    new.start_time - make_interval(mins => v_preflight_minutes),
    new.end_time + make_interval(mins => v_postflight_minutes),
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
        and coalesce(v_existing_supervisor, v_supervisor) = v_supervisor
      then 'acknowledged'
      when v_existing_supervision_status = 'acknowledged'
        and v_existing_supervisor = v_supervisor
      then 'acknowledged'
      else 'assigned'
    end;
    if new.status = 'pending_supervision' then
      new.status := 'confirmed';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.instructor_requires_role_supervision(uuid)
  from public, anon, authenticated;
revoke all on function public.protect_role_mandated_supervision_requirement()
  from public, anon, authenticated;
revoke all on function public.reconcile_role_based_supervision_requirements()
  from public, anon, authenticated;
revoke all on function public.refresh_role_based_supervision_requirements()
  from public, anon, authenticated;

grant execute on function public.instructor_requires_role_supervision(uuid)
  to service_role;
grant execute on function public.protect_role_mandated_supervision_requirement()
  to service_role;
grant execute on function public.reconcile_role_based_supervision_requirements()
  to service_role;
grant execute on function public.refresh_role_based_supervision_requirements()
  to service_role;

comment on column public.instructor_supervision_requirements.role_mandated is
  'True when supervision is mandatory because the account is an Instructor without Senior Instructor or CFI authority.';
comment on function public.instructor_requires_role_supervision(uuid) is
  'Returns true for an Instructor who has neither Senior Instructor nor CFI authority.';
