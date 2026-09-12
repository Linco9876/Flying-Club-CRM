-- Preserve allocated supervision when logging flights or refreshing availability,
-- authorisation, duty limits, requirements or booking details. Automatic selection
-- remains available for bookings with no supervisor. Explicit CFI/manual actions
-- retain their existing exact-slot validation and audit history.
-- This migration deliberately does not rewrite any historical assignments.

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
  select coalesce(
    (
      select commitment.supervising_instructor_id
      from public.booking_supervision_commitments commitment
      where commitment.booking_id = p_exclude_booking_id
        and commitment.status = 'accepted'
        and commitment.booking_instructor_id = p_trainee_instructor_id
        and commitment.covered_start = p_start
        and commitment.covered_end = p_end
        and lower(commitment.booking_location) = lower(coalesce(p_location, 'Bendigo'))
        and lower(commitment.activity_type) = lower(coalesce(p_activity_type, 'flight'))
        and private.manual_supervisor_available_for_slot(
          commitment.supervising_instructor_id,
          p_trainee_instructor_id,
          p_start,
          p_end,
          p_location,
          p_activity_type,
          p_exclude_booking_id
        )
      order by commitment.accepted_at desc
      limit 1
    ),
    case when exists (
      select 1 from public.bookings booking
      where booking.id = p_exclude_booking_id
        and booking.supervising_instructor_id is not null
    ) then (
      -- An assignment is a person's responsibility, not a fresh roster suggestion.
      -- Only a validated explicit commitment above may replace that person.
      -- If an edit would make them supervise themselves, leave the booking
      -- pending for manual allocation instead of choosing another person.
      select nullif(booking.supervising_instructor_id, p_trainee_instructor_id)
      from public.bookings booking where booking.id = p_exclude_booking_id
    ) else (
      select authorisation.instructor_id
      from public.senior_instructor_authorisations authorisation
      where authorisation.is_active
        and authorisation.instructor_id <> p_trainee_instructor_id
        and (
          p_end < now()
          or authorisation.effective_from <= (
            p_start at time zone 'Australia/Sydney'
          )::date
        )
        and (
          authorisation.effective_to is null
          or authorisation.effective_to >= (
            p_end at time zone 'Australia/Sydney'
          )::date
        )
        and (
          authorisation.qualification_expires_on is null
          or authorisation.qualification_expires_on >= (
            p_end at time zone 'Australia/Sydney'
          )::date
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
            and (
              public.instructor_available_at_location_for_slot(
                authorisation.instructor_id,
                p_start,
                p_end,
                location.id
              )
              or location.id = any(
                public.supervisor_roster_locations_for_slot(
                  authorisation.instructor_id,
                  p_start,
                  p_end
                )
              )
            )
        )
        and public.trial_voucher_instructor_available_for_slot(
          authorisation.instructor_id,
          p_start,
          p_end
        )
        and (
          public.assess_instructor_duty_booking(
            authorisation.instructor_id,
            p_start,
            p_end,
            p_exclude_booking_id
          )->>'result'
        ) is distinct from 'warning'
        and private.supervision_capacity_available_for_slot(
          authorisation.instructor_id,
          p_trainee_instructor_id,
          p_start,
          p_end,
          p_exclude_booking_id,
          authorisation.maximum_concurrent
        )
      order by authorisation.priority, authorisation.instructor_id
      limit 1
    ) end
  );
$$;

comment on function public.find_available_supervisor(uuid, timestamptz, timestamptz, text, text, uuid)
is 'Uses a validated explicit commitment, otherwise retains the existing supervisor. Automatic priority selection only applies to unassigned bookings; it never replaces an existing supervisor.';

select private.assert_function_permission_manifest();
