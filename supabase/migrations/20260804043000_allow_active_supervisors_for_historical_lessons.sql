-- Active supervisor authorisations may be applied to unresolved historical
-- lessons when the roster proves the supervisor was available. This supports
-- records that pre-date configuration of the supervision system without making
-- a future authorisation effective early for current or future operations.
create or replace function public.supervisor_available_for_slot(
  p_supervisor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_maximum integer;
  v_count integer;
  v_duty_assessment jsonb;
begin
  select authorisation.maximum_concurrent
  into v_maximum
  from public.senior_instructor_authorisations authorisation
  where authorisation.instructor_id = p_supervisor_id
    and authorisation.is_active
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
    );

  if not found then
    return false;
  end if;

  if not public.trial_voucher_instructor_available_for_slot(
    p_supervisor_id,
    p_start,
    p_end
  ) then
    return false;
  end if;

  v_duty_assessment := public.assess_instructor_duty_booking(
    p_supervisor_id,
    p_start,
    p_end,
    p_exclude_booking_id
  );
  if v_duty_assessment->>'result' = 'warning' then
    return false;
  end if;

  select count(*)
  into v_count
  from public.bookings booking
  where booking.supervising_instructor_id = p_supervisor_id
    and booking.id is distinct from p_exclude_booking_id
    and booking.deleted_at is null
    and booking.status not in ('cancelled', 'no-show')
    and booking.supervision_status in ('assigned', 'acknowledged')
    and booking.start_time < p_end
    and booking.end_time > p_start;

  return v_count < v_maximum;
end;
$$;

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
        and location.id = any(
          public.supervisor_roster_locations_for_slot(
            authorisation.instructor_id,
            p_start,
            p_end
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

comment on function public.supervisor_available_for_slot(uuid, timestamptz, timestamptz, uuid) is
  'Returns whether an authorised supervisor is rostered for the slot and remains within duty and supervision-capacity limits. Own lessons do not conflict; active authorisations can cover earlier unresolved lessons.';
comment on function public.find_available_supervisor(uuid, timestamptz, timestamptz, text, text, uuid) is
  'Finds rostered supervision coverage by authorisation, location, activity, duty and capacity. Active authorisations may cover historical unresolved lessons but never start early for current or future bookings.';

update public.bookings
set updated_at = now()
where instructor_id is not null
  and deleted_at is null
  and supervision_required
  and supervision_status = 'pending'
  and status not in ('cancelled', 'no-show', 'completed');

select private.assert_function_permission_manifest();
