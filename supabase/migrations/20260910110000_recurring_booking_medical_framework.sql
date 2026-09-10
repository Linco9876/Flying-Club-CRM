create or replace function public.update_recurring_booking_series_with_medicals(
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
  p_private_aircraft_registration text default null,
  p_medical_operation text default null
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
           medical_operation = nullif(p_medical_operation,''),
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
revoke all on function public.update_recurring_booking_series_with_medicals(uuid,timestamptz,timestamptz,uuid,uuid,uuid,text,text,text,uuid,boolean,text,text,text,uuid,uuid,text,text,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.update_recurring_booking_series_with_medicals(uuid,timestamptz,timestamptz,uuid,uuid,uuid,text,text,text,uuid,boolean,text,text,text,uuid,uuid,text,text,uuid,text,text,text,text,text) to authenticated,service_role;
insert into private.function_permission_manifest(signature,function_name,classification,allowed_roles,security_definer,fixed_search_path,rationale,reviewed_at) values ('public.update_recurring_booking_series_with_medicals(p_booking_id uuid, p_new_start timestamp with time zone, p_new_end timestamp with time zone, p_student_id uuid, p_instructor_id uuid, p_aircraft_id uuid, p_payment_type text, p_notes text, p_booking_kind text, p_flight_type_id uuid, p_is_guest_booking boolean, p_guest_name text, p_guest_email text, p_guest_phone text, p_trial_flight_voucher_id uuid, p_casual_contact_id uuid, p_booking_purpose text, p_location text, p_location_id uuid, p_duty_override_reason text, p_membership_override_reason text, p_private_aircraft_type text, p_private_aircraft_registration text, p_medical_operation text)','update_recurring_booking_series_with_medicals','authenticated_self_service',array['authenticated','service_role'],true,true,'Authorised atomic series edits carry the medical framework to each occurrence; medical trigger checks each flight date.',date '2026-09-10');
select private.assert_function_permission_manifest();
