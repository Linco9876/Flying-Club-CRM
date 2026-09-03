-- Current serviceability is an operational safety gate, not a reason to block
-- reconstruction of a flight that already occurred. Permit only staff (or a
-- trusted service worker) to attach a currently grounded aircraft to a booking
-- whose end time is already in the past. Current/future bookings remain strict.

create or replace function public.enforce_aircraft_maintenance_serviceability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_registration text;
  v_is_archived boolean;
  v_is_completed_historical_entry boolean;
begin
  if new.deleted_at is not null
    or new.status in ('cancelled', 'completed', 'no-show')
    or new.aircraft_id is null then
    return new;
  end if;

  select aircraft.status, aircraft.registration, aircraft.is_archived
  into v_status, v_registration, v_is_archived
  from public.aircraft aircraft
  where aircraft.id = new.aircraft_id;

  if not found then
    raise exception 'Selected aircraft no longer exists'
      using errcode = 'P0001';
  end if;

  if coalesce(v_is_archived, false) then
    raise exception '% is archived and cannot be booked', coalesce(v_registration, 'Selected aircraft')
      using errcode = 'P0001';
  end if;

  if v_status is distinct from 'serviceable' then
    v_is_completed_historical_entry := new.end_time < statement_timestamp()
      and (
        public.current_user_has_staff_role()
        or auth.role() = 'service_role'
      );

    if not v_is_completed_historical_entry then
      raise exception '% is currently unserviceable and cannot be used for a current or future booking', coalesce(v_registration, 'Selected aircraft')
        using
          errcode = 'P0001',
          hint = 'Staff may select it only when recording a booking whose end time is already in the past.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_aircraft_maintenance_serviceability()
  from public, anon, authenticated;
grant execute on function public.enforce_aircraft_maintenance_serviceability()
  to service_role;

update private.function_permission_manifest
set rationale = 'Internal booking trigger. It strictly blocks archived aircraft and current/future use of unserviceable aircraft, while allowing staff-only reconstruction of bookings that have already ended.',
    reviewed_at = date '2026-09-03'
where signature = 'public.enforce_aircraft_maintenance_serviceability()';

select private.assert_function_permission_manifest();

comment on function public.enforce_aircraft_maintenance_serviceability() is
  'Blocks archived aircraft and operational use of currently unserviceable aircraft. Staff may reconstruct a completed historical booking without changing the aircraft current serviceability.';
