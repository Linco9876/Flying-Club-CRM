-- A senior instructor's own lesson does not prevent them from providing the
-- supervision coverage for which they are rostered. Roster hours and absences
-- remain the source of availability; authorisation, location, duty and capacity
-- checks remain separate safety gates.
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
    and authorisation.effective_from <= (p_start at time zone 'Australia/Sydney')::date
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

comment on function public.supervisor_available_for_slot(uuid, timestamptz, timestamptz, uuid) is
  'Returns whether an authorised supervisor is rostered for the slot and remains within duty and supervision-capacity limits. The supervisor may conduct their own overlapping lesson.';

-- Re-run the booking trigger for all unresolved coverage so an already-pending
-- lesson, including a historical lesson still awaiting its record, can proceed
-- as soon as rostered coverage is found.
update public.bookings
set updated_at = now()
where instructor_id is not null
  and deleted_at is null
  and supervision_required
  and supervision_status = 'pending'
  and status not in ('cancelled', 'no-show', 'completed');

select private.assert_function_permission_manifest();
