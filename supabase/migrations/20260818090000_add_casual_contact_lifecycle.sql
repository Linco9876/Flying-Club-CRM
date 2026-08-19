-- A reusable, auditable identity for people who fly before they need a portal account.
-- The booking's guest_* fields remain an immutable point-in-time snapshot after promotion.

-- CFI is a staff role throughout the portal and must have the same booking/contact
-- access even when it is the user's only assigned role.
create or replace function public.current_user_has_staff_role()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(((select auth.jwt()) -> 'app_metadata' -> 'roles') ?| array['admin','cfi','instructor','senior_instructor'], false)
    or exists (
      select 1 from public.user_roles role_assignment
      where role_assignment.user_id = (select auth.uid())
        and role_assignment.role = any (array['admin','cfi','instructor','senior_instructor'])
    )
    or exists (
      select 1 from public.users portal_user
      where portal_user.id = (select auth.uid())
        and (
          portal_user.role = any (array['admin','cfi','instructor','senior_instructor'])
          or coalesce(portal_user.is_senior_instructor, false)
        )
    );
$$;

create table if not exists public.casual_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 200),
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  phone text,
  status text not null default 'active' check (status in ('active', 'promoted', 'merged')),
  promoted_to_user_id uuid references public.users(id) on delete set null,
  promoted_at timestamptz,
  xero_contact_id text,
  xero_contact_name text,
  xero_contact_email text,
  xero_contact_linked_at timestamptz,
  created_by uuid references public.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_booking_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint casual_contacts_promotion_state check (
    (status = 'promoted' and promoted_to_user_id is not null and promoted_at is not null)
    or status <> 'promoted'
  )
);

create index if not exists casual_contacts_email_lookup_idx
  on public.casual_contacts(lower(email), last_booking_at desc);
create index if not exists casual_contacts_name_lookup_idx
  on public.casual_contacts(lower(name));
create index if not exists casual_contacts_promoted_user_idx
  on public.casual_contacts(promoted_to_user_id)
  where promoted_to_user_id is not null;

create table if not exists public.casual_contact_events (
  id uuid primary key default gen_random_uuid(),
  casual_contact_id uuid not null references public.casual_contacts(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'booking_linked', 'details_updated', 'promoted', 'xero_linked', 'merged')),
  booking_id uuid references public.bookings(id) on delete set null deferrable initially deferred,
  target_user_id uuid references public.users(id) on delete set null,
  actor_id uuid references public.users(id) on delete set null default auth.uid(),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists casual_contact_events_contact_created_idx
  on public.casual_contact_events(casual_contact_id, created_at desc);

alter table public.bookings
  add column if not exists casual_contact_id uuid references public.casual_contacts(id) on delete set null,
  add column if not exists booking_purpose text not null default 'standard';

alter table public.bookings drop constraint if exists bookings_booking_purpose_check;
alter table public.bookings add constraint bookings_booking_purpose_check
  check (booking_purpose in ('standard', 'trial_flight', 'casual_flight', 'external_flight_review', 'external_flight_test'));

alter table public.bookings drop constraint if exists bookings_guest_formal_record_check;
alter table public.bookings add constraint bookings_guest_formal_record_check
  check (
    not coalesce(is_guest_booking, false)
    or booking_purpose in ('trial_flight', 'casual_flight')
  );

create index if not exists bookings_casual_contact_start_idx
  on public.bookings(casual_contact_id, start_time desc)
  where casual_contact_id is not null;

alter table public.casual_contacts enable row level security;
alter table public.casual_contact_events enable row level security;

revoke all on table public.casual_contacts, public.casual_contact_events from public, anon;
grant select, insert, update on table public.casual_contacts to authenticated;
grant select on table public.casual_contact_events to authenticated;
grant all on table public.casual_contacts, public.casual_contact_events to service_role;

drop policy if exists "Staff can read casual contacts" on public.casual_contacts;
create policy "Staff can read casual contacts" on public.casual_contacts
  for select to authenticated using (public.current_user_has_staff_role());
drop policy if exists "Staff can create casual contacts" on public.casual_contacts;
create policy "Staff can create casual contacts" on public.casual_contacts
  for insert to authenticated with check (public.current_user_has_staff_role());
drop policy if exists "Staff can update casual contacts" on public.casual_contacts;
create policy "Staff can update casual contacts" on public.casual_contacts
  for update to authenticated using (public.current_user_has_staff_role()) with check (public.current_user_has_staff_role());
drop policy if exists "Staff can read casual contact history" on public.casual_contact_events;
create policy "Staff can read casual contact history" on public.casual_contact_events
  for select to authenticated using (public.current_user_has_staff_role());

create or replace function private.resolve_booking_casual_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact public.casual_contacts%rowtype;
  v_created boolean := false;
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

  if new.guest_name is null or new.guest_email is null then
    raise exception 'Guest name and email are required';
  end if;

  if new.casual_contact_id is not null then
    select * into v_contact from public.casual_contacts where id = new.casual_contact_id for update;
    if not found or v_contact.status = 'merged' then
      raise exception 'The selected casual contact is no longer available';
    end if;
  else
    select * into v_contact
    from public.casual_contacts contact
    where lower(contact.email) = new.guest_email
      and lower(btrim(contact.name)) = lower(new.guest_name)
      and contact.status <> 'merged'
    order by (contact.status = 'active') desc, contact.last_booking_at desc nulls last, contact.created_at desc
    limit 1
    for update;

    if found and v_contact.promoted_to_user_id is not null then
      raise exception using
        message = 'This person already has a portal profile. Create a member booking instead.',
        hint = v_contact.promoted_to_user_id::text;
    end if;

    if not found then
      insert into public.casual_contacts(name, email, phone, created_by, last_booking_at)
      values (new.guest_name, new.guest_email, new.guest_phone, auth.uid(), new.start_time)
      returning * into v_contact;
      v_created := true;
    end if;
  end if;

  if v_contact.promoted_to_user_id is not null then
    raise exception using
      message = 'This casual contact has already been promoted. Create a member booking instead.',
      hint = v_contact.promoted_to_user_id::text;
  end if;

  new.casual_contact_id := v_contact.id;

  update public.casual_contacts
  set name = new.guest_name,
      email = new.guest_email,
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
    jsonb_build_object('bookingPurpose', new.booking_purpose)
  );

  return new;
end;
$$;

revoke all on function private.resolve_booking_casual_contact() from public, anon, authenticated;
grant execute on function private.resolve_booking_casual_contact() to service_role;

drop trigger if exists resolve_booking_casual_contact on public.bookings;
create trigger resolve_booking_casual_contact
before insert or update of is_guest_booking, guest_name, guest_email, guest_phone, casual_contact_id, booking_purpose, start_time
on public.bookings
for each row execute function private.resolve_booking_casual_contact();

-- Existing bookings are rare, but preserve them and give each same-name/email person one contact.
do $$
declare
  v_booking record;
  v_contact_id uuid;
begin
  for v_booking in
    select id, guest_name, lower(btrim(guest_email)) as guest_email, guest_phone, start_time, trial_flight_voucher_id
    from public.bookings
    where coalesce(is_guest_booking, false)
      and casual_contact_id is null
      and nullif(btrim(guest_name), '') is not null
      and nullif(btrim(guest_email), '') is not null
    order by start_time
  loop
    select id into v_contact_id
    from public.casual_contacts
    where lower(email) = v_booking.guest_email
      and lower(btrim(name)) = lower(btrim(v_booking.guest_name))
      and status = 'active'
    order by created_at
    limit 1;

    if v_contact_id is null then
      insert into public.casual_contacts(name, email, phone, last_booking_at)
      values (btrim(v_booking.guest_name), v_booking.guest_email, nullif(btrim(v_booking.guest_phone), ''), v_booking.start_time)
      returning id into v_contact_id;
    end if;

    update public.bookings
    set casual_contact_id = v_contact_id,
        booking_purpose = case when v_booking.trial_flight_voucher_id is not null then 'trial_flight' else 'casual_flight' end
    where id = v_booking.id;
  end loop;
end;
$$;

create or replace function public.search_casual_contacts(p_query text, p_limit integer default 10)
returns table (
  id uuid,
  name text,
  email text,
  phone text,
  status text,
  promoted_to_user_id uuid,
  booking_count bigint,
  last_booking_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    contact.id,
    contact.name,
    contact.email,
    contact.phone,
    contact.status,
    contact.promoted_to_user_id,
    count(booking.id) as booking_count,
    greatest(contact.last_booking_at, max(booking.start_time)) as last_booking_at
  from public.casual_contacts contact
  left join public.bookings booking on booking.casual_contact_id = contact.id
  where public.current_user_has_staff_role()
    and contact.status <> 'merged'
    and (
      btrim(coalesce(p_query, '')) = ''
      or contact.name ilike btrim(p_query) || '%'
      or contact.email ilike btrim(p_query) || '%'
      or coalesce(contact.phone, '') ilike btrim(p_query) || '%'
    )
  group by contact.id
  order by (contact.status = 'active') desc, greatest(contact.last_booking_at, max(booking.start_time)) desc nulls last, contact.name
  limit least(greatest(coalesce(p_limit, 10), 1), 25)
$$;

revoke all on function public.search_casual_contacts(text, integer) from public, anon;
grant execute on function public.search_casual_contacts(text, integer) to authenticated, service_role;

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

  -- Redeem the holder identity before changing the booking owner so existing
  -- voucher integrity checks always observe a consistent state.
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
  set status = case when not exists (select 1 from public.bookings where casual_contact_id = v_contact.id and is_guest_booking) then 'promoted' else 'active' end,
      promoted_to_user_id = p_target_user_id,
      promoted_at = now(),
      updated_at = now()
  where id = v_contact.id;

  insert into public.casual_contact_events(casual_contact_id, event_type, booking_id, target_user_id, actor_id, details)
  values (v_contact.id, 'promoted', p_booking_id, p_target_user_id, p_actor_id, jsonb_build_object(
    'linkAll', p_link_all,
    'bookingCount', v_booking_count,
    'flightLogCount', v_flight_count,
    'trainingRecordCount', v_record_count,
    'reviewCount', v_review_count
  ));

  return jsonb_build_object(
    'bookingCount', v_booking_count,
    'flightLogCount', v_flight_count,
    'trainingRecordCount', v_record_count,
    'reviewCount', v_review_count
  );
end;
$$;

revoke all on function public.promote_casual_contact_history(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.promote_casual_contact_history(uuid, uuid, boolean, uuid) to service_role;

insert into private.function_permission_manifest(
  signature, function_name, classification, allowed_roles, security_definer,
  fixed_search_path, rationale, reviewed_at
) values
  (
    'public.search_casual_contacts(p_query text, p_limit integer)',
    'search_casual_contacts', 'authenticated_self_service', array['authenticated', 'service_role']::text[], true, true,
    'Staff-only returning casual-contact lookup. The function checks the caller role before returning PII.', date '2026-08-18'
  ),
  (
    'public.promote_casual_contact_history(p_booking_id uuid, p_target_user_id uuid, p_link_all boolean, p_actor_id uuid)',
    'promote_casual_contact_history', 'service_worker', array['service_role']::text[], true, true,
    'Transactional service-only transfer of the complete casual booking history to an explicitly selected portal profile.', date '2026-08-18'
  )
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

select private.assert_function_permission_manifest();

comment on table public.casual_contacts is
  'Reusable CRM identity for trial/casual visitors. Promotion retains booking snapshots and transfers all linked operational records.';
comment on column public.bookings.booking_purpose is
  'Explicit operational purpose. Formal external reviews/tests require a real portal profile and cannot use guest placeholder identity.';
