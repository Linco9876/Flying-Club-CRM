-- A guest needs a name and normally a phone number at booking time. Email is
-- optional until the visitor is promoted to a portal identity.

alter table public.casual_contacts
  alter column email drop not null;

alter table public.casual_contacts
  drop constraint if exists casual_contacts_email_check;
alter table public.casual_contacts
  drop constraint if exists casual_contacts_email_valid_when_present;
alter table public.casual_contacts
  add constraint casual_contacts_email_valid_when_present check (
    email is null
    or (
      email = lower(btrim(email))
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    )
  );

create or replace function private.resolve_booking_casual_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact public.casual_contacts%rowtype;
  v_created boolean := false;
  v_matched boolean := false;
begin
  if not coalesce(new.is_guest_booking, false) then
    return new;
  end if;

  new.guest_name := nullif(btrim(coalesce(new.guest_name, '')), '');
  new.guest_email := lower(nullif(btrim(coalesce(new.guest_email, '')), ''));
  new.guest_phone := nullif(btrim(coalesce(new.guest_phone, '')), '');
  new.booking_purpose := case
    when new.booking_purpose in ('trial_flight', 'casual_flight') then new.booking_purpose
    when new.trial_flight_voucher_id is not null then 'trial_flight'
    else 'casual_flight'
  end;

  if new.guest_name is null then
    raise exception 'Guest name is required';
  end if;

  if new.casual_contact_id is not null then
    select * into v_contact
    from public.casual_contacts
    where id = new.casual_contact_id
    for update;
    v_matched := found;
    if not v_matched or v_contact.status = 'merged' then
      raise exception 'The selected casual contact is no longer available';
    end if;
  elsif new.guest_email is not null then
    select * into v_contact
    from public.casual_contacts contact
    where lower(contact.email) = new.guest_email
      and lower(btrim(contact.name)) = lower(new.guest_name)
      and contact.status <> 'merged'
    order by (contact.status = 'active') desc, contact.last_booking_at desc nulls last, contact.created_at desc
    limit 1
    for update;
    v_matched := found;
  elsif new.guest_phone is not null then
    -- Email-less visitors are matched only when both name and normalised phone
    -- agree. Name alone is deliberately insufficient to merge identities.
    select * into v_contact
    from public.casual_contacts contact
    where contact.email is null
      and lower(btrim(contact.name)) = lower(new.guest_name)
      and regexp_replace(coalesce(contact.phone, ''), '[^0-9]+', '', 'g') =
          regexp_replace(new.guest_phone, '[^0-9]+', '', 'g')
      and contact.status <> 'merged'
    order by (contact.status = 'active') desc, contact.last_booking_at desc nulls last, contact.created_at desc
    limit 1
    for update;
    v_matched := found;
  end if;

  if v_matched and v_contact.promoted_to_user_id is not null then
    raise exception using
      message = 'This person already has a portal profile. Create a member booking instead.',
      hint = v_contact.promoted_to_user_id::text;
  end if;

  if not v_matched then
    insert into public.casual_contacts(name, email, phone, created_by, last_booking_at)
    values (new.guest_name, new.guest_email, new.guest_phone, auth.uid(), new.start_time)
    returning * into v_contact;
    v_created := true;
  end if;

  if v_contact.promoted_to_user_id is not null then
    raise exception using
      message = 'This casual contact has already been promoted. Create a member booking instead.',
      hint = v_contact.promoted_to_user_id::text;
  end if;

  new.casual_contact_id := v_contact.id;

  update public.casual_contacts
  set name = new.guest_name,
      email = coalesce(new.guest_email, email),
      phone = coalesce(new.guest_phone, phone),
      last_booking_at = greatest(coalesce(last_booking_at, new.start_time), new.start_time),
      updated_at = now()
  where id = v_contact.id;

  insert into public.casual_contact_events(casual_contact_id, event_type, booking_id, actor_id, details)
  values (
    v_contact.id,
    case when v_created then 'created' else 'booking_linked' end,
    new.id,
    auth.uid(),
    jsonb_build_object(
      'bookingPurpose', new.booking_purpose,
      'emailProvided', new.guest_email is not null
    )
  );

  return new;
end;
$$;

revoke all on function private.resolve_booking_casual_contact()
  from public, anon, authenticated, service_role;

select private.assert_function_permission_manifest();

comment on column public.casual_contacts.email is
  'Optional for a casual booking. A valid email is required by the promotion service before creating or linking a portal profile.';
