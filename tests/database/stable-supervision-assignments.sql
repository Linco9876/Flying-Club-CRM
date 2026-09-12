-- Disposable PostgreSQL fixture. Production selector and booking preparation are
-- exercised; availability/duty helpers use controllable synthetic responses.
\set ON_ERROR_STOP on
begin;
create schema private;
create table public.bookings (
 id uuid primary key, instructor_id uuid, start_time timestamptz, end_time timestamptz,
 location text default 'Bendigo', booking_kind text default 'flight', status text default 'confirmed',
 supervision_required boolean default true, supervision_status text default 'assigned',
 supervising_instructor_id uuid, duty_assessment jsonb, duty_override_reason text,
 flight_logged boolean default false, notes text, updated_at timestamptz default now()
);
create table public.instructor_supervision_requirements (
 instructor_id uuid, effective_from date, effective_to date, supervision_required boolean,
 activity_types text[], locations text[], preflight_minutes int, postflight_minutes int
);
create table public.booking_supervision_commitments (
 booking_id uuid, supervising_instructor_id uuid, status text, booking_instructor_id uuid,
 covered_start timestamptz, covered_end timestamptz, booking_location text, activity_type text, accepted_at timestamptz
);
create table public.senior_instructor_authorisations (
 instructor_id uuid, is_active boolean, effective_from date, effective_to date,
 qualification_expires_on date, remote_supervision_allowed boolean, locations text[],
 activity_types text[], maximum_concurrent int, priority int
);
create table public.duty_clock_locations(id uuid, name text, is_active boolean);
create table public.test_availability (instructor_id uuid primary key, available boolean default true, duty_clear boolean default true, manual_clear boolean default true);
create function private.assert_function_permission_manifest() returns void language sql as $$ select $$;
create function public.instructor_requires_role_supervision(uuid) returns boolean language sql as $$ select true $$;
create function public.assess_instructor_duty_booking(uuid,timestamptz,timestamptz,uuid) returns jsonb language sql stable as $$ select jsonb_build_object('result',case when coalesce((select duty_clear from test_availability where instructor_id=$1),true) then 'clear' else 'warning' end) $$;
create function private.manual_supervisor_available_for_slot(uuid,uuid,timestamptz,timestamptz,text,text,uuid) returns boolean language sql stable as $$ select coalesce((select manual_clear from test_availability where instructor_id=$1),false) $$;
create function public.instructor_available_at_location_for_slot(uuid,timestamptz,timestamptz,uuid) returns boolean language sql stable as $$ select coalesce((select available from test_availability where instructor_id=$1),false) $$;
create function public.supervisor_roster_locations_for_slot(uuid,timestamptz,timestamptz) returns uuid[] language sql as $$ select '{}'::uuid[] $$;
create function public.trial_voucher_instructor_available_for_slot(uuid,timestamptz,timestamptz) returns boolean language sql stable as $$ select coalesce((select available from test_availability where instructor_id=$1),false) $$;
create function private.supervision_capacity_available_for_slot(uuid,uuid,timestamptz,timestamptz,uuid,int) returns boolean language sql as $$ select true $$;
\ir ../../supabase/migrations/20260912050000_keep_existing_supervisor_assignments.sql
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
create trigger prepare_booking before insert or update on public.bookings for each row execute function public.prepare_booking_duty_and_supervision();
do $$
declare
 first_supervisor uuid := '00000000-0000-0000-0000-000000000001';
 second_supervisor uuid := '00000000-0000-0000-0000-000000000002';
 trainee uuid := '00000000-0000-0000-0000-000000000003';
 booking_id uuid := '00000000-0000-0000-0000-000000000004';
 new_booking_id uuid := '00000000-0000-0000-0000-000000000005';
 st timestamptz := date_trunc('day',now()) + interval '2 days 10 hours';
 actual uuid;
begin
 insert into test_availability(instructor_id) values(first_supervisor),(second_supervisor);
 insert into duty_clock_locations values(gen_random_uuid(),'Bendigo',true);
 insert into senior_instructor_authorisations values
 (first_supervisor,true,current_date-30,null,null,false,'{}','{flight}',2,1),
 (second_supervisor,true,current_date-30,null,null,false,'{}','{flight}',2,2);
 insert into bookings(id,instructor_id,start_time,end_time) values(booking_id,trainee,st,st+interval '1 hour');
 if (select supervising_instructor_id from bookings where id=booking_id)<>first_supervisor then raise exception 'Initial priority selection failed'; end if;
 update bookings set supervision_status='acknowledged' where id=booking_id;
 -- The exact failure reported: duty/roster now rejects the first priority person,
 -- then marking the flight logged must not move supervision to the second person.
 update test_availability set available=false,duty_clear=false,manual_clear=false where instructor_id=first_supervisor;
 update bookings set flight_logged=true where id=booking_id;
 if not exists(select 1 from bookings where id=booking_id and supervising_instructor_id=first_supervisor and supervision_status='acknowledged') then raise exception 'Flight logging reassigned supervision'; end if;
 update bookings set notes='Unrelated edit',updated_at=clock_timestamp() where id=booking_id;
 update bookings set updated_at=clock_timestamp() where id=booking_id;
 update bookings set start_time=st+interval '30 minutes',end_time=st+interval '90 minutes' where id=booking_id;
 update senior_instructor_authorisations set is_active=false,priority=99 where instructor_id=first_supervisor;
 update bookings set updated_at=clock_timestamp() where id=booking_id;
 if (select supervising_instructor_id from bookings where id=booking_id)<>first_supervisor then raise exception 'Availability/authorisation refresh or time edit reassigned supervision'; end if;
 -- New, unassigned bookings still use eligible priority selection.
 insert into bookings(id,instructor_id,start_time,end_time) values(new_booking_id,trainee,st,st+interval '1 hour');
 if (select supervising_instructor_id from bookings where id=new_booking_id)<>second_supervisor then raise exception 'Unassigned booking did not use eligible supervisor'; end if;
 -- An explicit new exact-slot commitment may move the assignment; changing the
 -- roster/duty alone cannot. This is the handoff used by the existing CFI RPC.
 insert into booking_supervision_commitments values(booking_id,second_supervisor,'accepted',trainee,st,st+interval '2 hours','Bendigo','flight',now());
 update bookings set updated_at=clock_timestamp() where id=booking_id;
 if not exists(select 1 from bookings where id=booking_id and supervising_instructor_id=second_supervisor and supervision_status='assigned') then raise exception 'Explicit reassignment did not apply'; end if;
 update bookings set supervision_status='acknowledged' where id=booking_id;
 update booking_supervision_commitments c set status='invalidated' where c.booking_id='00000000-0000-0000-0000-000000000004';
 update test_availability set available=true,duty_clear=true,manual_clear=true where instructor_id=first_supervisor;
 update senior_instructor_authorisations set is_active=true,priority=1 where instructor_id=first_supervisor;
 update bookings set updated_at=clock_timestamp() where id=booking_id;
 if (select supervising_instructor_id from bookings where id=booking_id)<>second_supervisor then raise exception 'Commitment invalidation reverted to priority supervisor'; end if;
 -- A booking instructor edit cannot create self-supervision or select a third
 -- person silently. It requires manual allocation.
 update bookings set instructor_id=second_supervisor where id=booking_id;
 if not exists(select 1 from bookings where id=booking_id and supervising_instructor_id is null and supervision_status='pending') then raise exception 'Self-supervision edit was not left pending'; end if;
 update bookings set status='cancelled' where id=new_booking_id;
 if not exists(select 1 from bookings where id=new_booking_id and supervising_instructor_id is null and supervision_status='not_required') then raise exception 'Cancellation did not clear supervision'; end if;
end $$;
rollback;
