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
  ) then
    v_grounded_until := now() + make_interval(secs => (v_duration_hours * 3600)::integer);

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

    update public.defects
    set grounded_aircraft = true
    where id = new.id
      and coalesce(grounded_aircraft, false) is false;

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
    perform public.release_aircraft_auto_grounding(new.aircraft_id, new.id);
    update public.defects
    set grounded_aircraft = false
    where id = new.id
      and coalesce(grounded_aircraft, false);
  end if;

  return new;
end;
$$;

drop trigger if exists trigger_aircraft_grounding on public.defects;
create trigger trigger_aircraft_grounding
after insert or update on public.defects
for each row execute function public.handle_aircraft_grounding();

revoke all on function public.handle_aircraft_grounding() from public, anon, authenticated;
