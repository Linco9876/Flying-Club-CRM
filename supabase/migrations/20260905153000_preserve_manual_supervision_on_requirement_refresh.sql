-- Role reconciliation deliberately upserts every ordinary instructor's
-- supervision requirement. PostgreSQL UPDATE OF triggers fire when a column is
-- mentioned in SET, even when its value did not change. That caused accepted
-- CFI/manual allocations to be invalidated by unrelated role/profile saves.
--
-- Ignore genuine no-op saves. For a material requirement change, revalidate
-- and resize each commitment instead of cancelling it blindly. Only invalidate
-- a commitment when the booking no longer requires supervision or its selected
-- supervisor no longer passes the safety checks for the revised window.

create or replace function private.invalidate_manual_supervision_after_requirement_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instructor_id uuid;
  v_commitment record;
  v_activity_type text;
  v_role_requirement boolean;
  v_explicit_requirement boolean;
  v_preflight_minutes integer;
  v_postflight_minutes integer;
  v_covered_start timestamptz;
  v_covered_end timestamptz;
  v_invalidation_reason text;
begin
  if tg_op = 'UPDATE'
    and old.supervision_required is not distinct from new.supervision_required
    and old.activity_types is not distinct from new.activity_types
    and old.locations is not distinct from new.locations
    and old.preflight_minutes is not distinct from new.preflight_minutes
    and old.postflight_minutes is not distinct from new.postflight_minutes
    and old.effective_from is not distinct from new.effective_from
    and old.effective_to is not distinct from new.effective_to
    and old.role_mandated is not distinct from new.role_mandated
  then
    return null;
  end if;

  v_instructor_id := case
    when tg_op = 'DELETE' then old.instructor_id
    else new.instructor_id
  end;

  for v_commitment in
    select
      commitment.id as commitment_id,
      commitment.supervising_instructor_id,
      booking.id as booking_id,
      booking.instructor_id,
      booking.start_time,
      booking.end_time,
      coalesce(booking.location, 'Bendigo') as booking_location,
      coalesce(booking.booking_kind, 'flight') as booking_kind
    from public.booking_supervision_commitments commitment
    join public.bookings booking on booking.id = commitment.booking_id
    where commitment.booking_instructor_id = v_instructor_id
      and commitment.status = 'accepted'
      and booking.deleted_at is null
      and booking.status not in ('cancelled', 'no-show', 'completed')
      and booking.end_time > now()
  loop
    v_activity_type := case
      when v_commitment.booking_kind = 'ground' then 'ground'
      else 'flight'
    end;
    v_role_requirement := v_activity_type = 'flight'
      and public.instructor_requires_role_supervision(v_commitment.instructor_id);

    if tg_op = 'DELETE' then
      v_explicit_requirement := false;
    else
      v_explicit_requirement := new.supervision_required
        and new.effective_from <= (
          v_commitment.start_time at time zone 'Australia/Sydney'
        )::date
        and (
          new.effective_to is null
          or new.effective_to >= (
            v_commitment.end_time at time zone 'Australia/Sydney'
          )::date
        )
        and (
          cardinality(new.activity_types) = 0
          or v_activity_type = any(new.activity_types)
        )
        and (
          cardinality(new.locations) = 0
          or exists (
            select 1
            from unnest(new.locations) required_location
            where lower(required_location) = lower(v_commitment.booking_location)
          )
        );
    end if;

    if not v_role_requirement and not v_explicit_requirement then
      v_invalidation_reason := 'Booking no longer requires supervision after requirement change';
    else
      if tg_op = 'DELETE' then
        v_preflight_minutes := 30;
        v_postflight_minutes := 30;
      elsif new.effective_from <= (
          v_commitment.start_time at time zone 'Australia/Sydney'
        )::date
        and (
          new.effective_to is null
          or new.effective_to >= (
            v_commitment.end_time at time zone 'Australia/Sydney'
          )::date
        )
      then
        v_preflight_minutes := greatest(0, coalesce(new.preflight_minutes, 30));
        v_postflight_minutes := greatest(0, coalesce(new.postflight_minutes, 30));
      else
        v_preflight_minutes := 30;
        v_postflight_minutes := 30;
      end if;

      v_covered_start := v_commitment.start_time
        - make_interval(mins => v_preflight_minutes);
      v_covered_end := v_commitment.end_time
        + make_interval(mins => v_postflight_minutes);

      if private.manual_supervisor_available_for_slot(
        v_commitment.supervising_instructor_id,
        v_commitment.instructor_id,
        v_covered_start,
        v_covered_end,
        v_commitment.booking_location,
        v_activity_type,
        v_commitment.booking_id
      ) then
        update public.booking_supervision_commitments commitment
        set covered_start = v_covered_start,
            covered_end = v_covered_end,
            booking_location = v_commitment.booking_location,
            activity_type = v_activity_type,
            metadata = commitment.metadata || jsonb_build_object(
              'lastRequirementRevalidatedAt', clock_timestamp(),
              'lastRequirementRevalidatedBy', auth.uid()
            ),
            updated_at = clock_timestamp()
        where commitment.id = v_commitment.commitment_id;

        v_invalidation_reason := null;
      else
        v_invalidation_reason := 'Supervisor no longer meets changed supervision requirements';
      end if;
    end if;

    if v_invalidation_reason is not null then
      update public.booking_supervision_commitments commitment
      set status = 'invalidated',
          ended_at = clock_timestamp(),
          ended_by = auth.uid(),
          end_reason = v_invalidation_reason,
          updated_at = clock_timestamp()
      where commitment.id = v_commitment.commitment_id;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function private.invalidate_manual_supervision_after_requirement_change()
  from public, anon, authenticated, service_role;

drop trigger if exists invalidate_manual_supervision_after_requirement_change
  on public.instructor_supervision_requirements;
create trigger invalidate_manual_supervision_after_requirement_change
after insert or update of supervision_required, activity_types, locations,
  preflight_minutes, postflight_minutes, effective_from, effective_to,
  role_mandated or delete
on public.instructor_supervision_requirements
for each row
execute function private.invalidate_manual_supervision_after_requirement_change();

-- Recover the newest still-valid commitment for future bookings left pending
-- by the old no-op invalidation bug. Re-run the same authorisation, duty, scope
-- and concurrency checks before reactivating anything.
do $$
declare
  v_candidate record;
  v_activity_type text;
  v_role_requirement boolean;
  v_explicit_requirement boolean;
  v_preflight_minutes integer;
  v_postflight_minutes integer;
  v_covered_start timestamptz;
  v_covered_end timestamptz;
begin
  for v_candidate in
    select distinct on (commitment.booking_id)
      commitment.id as commitment_id,
      commitment.booking_id,
      commitment.supervising_instructor_id,
      booking.instructor_id,
      booking.start_time,
      booking.end_time,
      coalesce(booking.location, 'Bendigo') as booking_location,
      coalesce(booking.booking_kind, 'flight') as booking_kind,
      requirement.supervision_required,
      requirement.activity_types,
      requirement.locations,
      requirement.preflight_minutes,
      requirement.postflight_minutes,
      requirement.effective_from,
      requirement.effective_to
    from public.booking_supervision_commitments commitment
    join public.bookings booking on booking.id = commitment.booking_id
    left join public.instructor_supervision_requirements requirement
      on requirement.instructor_id = booking.instructor_id
    where commitment.status = 'invalidated'
      and commitment.end_reason = 'Instructor supervision requirement changed'
      and booking.deleted_at is null
      and booking.status = 'pending_supervision'
      and booking.supervision_required
      and booking.supervision_status = 'pending'
      and booking.supervising_instructor_id is null
      and booking.end_time > now()
      and not exists (
        select 1
        from public.booking_supervision_commitments active_commitment
        where active_commitment.booking_id = booking.id
          and active_commitment.status = 'accepted'
      )
    order by commitment.booking_id, commitment.accepted_at desc
  loop
    v_activity_type := case
      when v_candidate.booking_kind = 'ground' then 'ground'
      else 'flight'
    end;
    v_role_requirement := v_activity_type = 'flight'
      and public.instructor_requires_role_supervision(v_candidate.instructor_id);
    v_explicit_requirement := coalesce(v_candidate.supervision_required, false)
      and v_candidate.effective_from <= (
        v_candidate.start_time at time zone 'Australia/Sydney'
      )::date
      and (
        v_candidate.effective_to is null
        or v_candidate.effective_to >= (
          v_candidate.end_time at time zone 'Australia/Sydney'
        )::date
      )
      and (
        cardinality(v_candidate.activity_types) = 0
        or v_activity_type = any(v_candidate.activity_types)
      )
      and (
        cardinality(v_candidate.locations) = 0
        or exists (
          select 1
          from unnest(v_candidate.locations) required_location
          where lower(required_location) = lower(v_candidate.booking_location)
        )
      );

    if v_role_requirement or v_explicit_requirement then
      v_preflight_minutes := greatest(0, coalesce(v_candidate.preflight_minutes, 30));
      v_postflight_minutes := greatest(0, coalesce(v_candidate.postflight_minutes, 30));
      v_covered_start := v_candidate.start_time
        - make_interval(mins => v_preflight_minutes);
      v_covered_end := v_candidate.end_time
        + make_interval(mins => v_postflight_minutes);

      if private.manual_supervisor_available_for_slot(
        v_candidate.supervising_instructor_id,
        v_candidate.instructor_id,
        v_covered_start,
        v_covered_end,
        v_candidate.booking_location,
        v_activity_type,
        v_candidate.booking_id
      ) then
        update public.booking_supervision_commitments commitment
        set status = 'accepted',
            covered_start = v_covered_start,
            covered_end = v_covered_end,
            booking_location = v_candidate.booking_location,
            activity_type = v_activity_type,
            ended_at = null,
            ended_by = null,
            end_reason = null,
            metadata = commitment.metadata || jsonb_build_object(
              'recoveredFromNoOpRequirementInvalidation', true,
              'recoveredAt', clock_timestamp()
            ),
            updated_at = clock_timestamp()
        where commitment.id = v_candidate.commitment_id;

        update public.bookings booking
        set updated_at = clock_timestamp()
        where booking.id = v_candidate.booking_id;
      end if;
    end if;
  end loop;
end;
$$;

comment on function private.invalidate_manual_supervision_after_requirement_change() is
  'Ignores no-op requirement saves and revalidates accepted manual supervision after material changes, invalidating only commitments that are no longer safe or required.';
