-- A single-booking correction moves only that visit and its child records.
-- Contact-wide Xero identity and promotion metadata may move only when staff
-- explicitly promote the complete casual-contact history.

-- The external-logbook migration was briefly applied before its trigger was
-- registered in the permission manifest. Repair that deployed state before
-- this migration runs the global permission assertion. This is idempotent for
-- fresh databases where the corrected source migration already registered it.
revoke all on function public.touch_external_logbook_updated_at()
  from public, anon, authenticated, service_role;

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values (
  'public.touch_external_logbook_updated_at()',
  'touch_external_logbook_updated_at',
  'trigger_internal',
  array[]::text[],
  false,
  true,
  'Invoked only by the external logbook update triggers; client EXECUTE is unnecessary.',
  date '2026-08-19'
)
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

create or replace function public.promote_casual_contact_history(
  p_booking_id uuid,
  p_target_user_id uuid,
  p_link_all boolean default true,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_contact public.casual_contacts%rowtype;
  v_booking_ids uuid[];
  v_flight_ids uuid[];
  v_record_ids uuid[];
  v_review_ids uuid[];
  v_booking_count integer := 0;
  v_flight_count integer := 0;
  v_record_count integer := 0;
  v_review_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This operation is restricted to the portal service';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if not coalesce(v_booking.is_guest_booking, false) then raise exception 'This booking is already linked to a profile'; end if;
  if v_booking.casual_contact_id is null then raise exception 'This booking does not have a casual contact'; end if;
  if not exists (select 1 from public.users where id = p_target_user_id) then raise exception 'Target profile not found'; end if;

  select * into v_contact from public.casual_contacts where id = v_booking.casual_contact_id for update;

  select coalesce(array_agg(id), array[]::uuid[]) into v_booking_ids
  from public.bookings
  where is_guest_booking
    and (id = p_booking_id or (p_link_all and casual_contact_id = v_booking.casual_contact_id));

  select coalesce(array_agg(id), array[]::uuid[]) into v_flight_ids
  from public.flight_logs where booking_id = any(v_booking_ids);
  select coalesce(array_agg(id), array[]::uuid[]) into v_record_ids
  from public.training_records where booking_id = any(v_booking_ids);
  select coalesce(array_agg(id), array[]::uuid[]) into v_review_ids
  from public.flight_review_records
  where booking_id = any(v_booking_ids)
     or flight_log_id = any(v_flight_ids)
     or source_training_record_id = any(v_record_ids);

  update public.trial_flight_vouchers
  set redeemed_by_user_id = p_target_user_id,
      redeemed_at = coalesce(redeemed_at, now()),
      status = case when status = 'issued' then 'redeemed' else status end,
      updated_at = now()
  where booked_booking_id = any(v_booking_ids);

  update public.bookings
  set student_id = p_target_user_id,
      is_guest_booking = false
  where id = any(v_booking_ids);
  get diagnostics v_booking_count = row_count;

  update public.flight_logs set student_id = p_target_user_id where id = any(v_flight_ids);
  get diagnostics v_flight_count = row_count;
  update public.training_records set student_id = p_target_user_id where id = any(v_record_ids);
  get diagnostics v_record_count = row_count;
  update public.student_matrix_assessments set student_id = p_target_user_id where training_record_id = any(v_record_ids);
  update public.training_deficiencies set student_id = p_target_user_id
    where source_training_record_id = any(v_record_ids) or resolution_training_record_id = any(v_record_ids);

  update public.flight_review_records set candidate_id = p_target_user_id where id = any(v_review_ids);
  get diagnostics v_review_count = row_count;
  update public.flight_review_attachments set candidate_id = p_target_user_id where review_record_id = any(v_review_ids);
  update public.account_transactions set user_id = p_target_user_id
    where user_id = v_booking.student_id
      and type = 'flight_charge'
      and flight_log_id = any(v_flight_ids);
  update public.notifications set user_id = p_target_user_id
    where user_id = v_booking.student_id
      and booking_id = any(v_booking_ids);

  if p_link_all then
    update public.users target
    set xero_contact_id = case
          when target.xero_contact_id is null
            and v_contact.xero_contact_id is not null
            and not exists (select 1 from public.users other where other.id <> target.id and other.xero_contact_id = v_contact.xero_contact_id)
          then v_contact.xero_contact_id else target.xero_contact_id end,
        xero_contact_name = coalesce(target.xero_contact_name, v_contact.xero_contact_name),
        xero_contact_email = coalesce(target.xero_contact_email, v_contact.xero_contact_email),
        xero_contact_linked_at = case when target.xero_contact_id is null and v_contact.xero_contact_id is not null then coalesce(v_contact.xero_contact_linked_at, now()) else target.xero_contact_linked_at end
    where target.id = p_target_user_id;

    update public.casual_contacts
    set status = 'promoted',
        promoted_to_user_id = p_target_user_id,
        promoted_at = now(),
        updated_at = now()
    where id = v_contact.id;
  else
    update public.casual_contacts
    set updated_at = now()
    where id = v_contact.id;
  end if;

  insert into public.casual_contact_events(casual_contact_id, event_type, booking_id, target_user_id, actor_id, details)
  values (
    v_contact.id,
    case when p_link_all then 'promoted' else 'booking_linked' end,
    p_booking_id,
    p_target_user_id,
    p_actor_id,
    jsonb_build_object(
      'linkAll', p_link_all,
      'bookingCount', v_booking_count,
      'flightLogCount', v_flight_count,
      'trainingRecordCount', v_record_count,
      'reviewCount', v_review_count
    )
  );

  return jsonb_build_object(
    'bookingCount', v_booking_count,
    'flightLogCount', v_flight_count,
    'trainingRecordCount', v_record_count,
    'reviewCount', v_review_count
  );
end;
$$;

revoke all on function public.promote_casual_contact_history(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_casual_contact_history(uuid, uuid, boolean, uuid)
  to service_role;

select private.assert_function_permission_manifest();
