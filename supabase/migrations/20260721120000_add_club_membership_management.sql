-- Bendigo Flying Club membership lifecycle, financial clearance and booking controls.
-- BFC membership is deliberately separate from RAAus membership and portal access.

create table if not exists public.membership_settings (
  id boolean primary key default true check (id),
  rollout_mode text not null default 'staff_warning'
    check (rollout_mode in ('information_only', 'staff_warning', 'enforced')),
  financial_year_start_month integer not null default 7 check (financial_year_start_month between 1 and 12),
  financial_year_start_day integer not null default 1 check (financial_year_start_day between 1 and 28),
  automatic_commencement_days integer not null default 30 check (automatic_commencement_days between 1 and 90),
  non_payment_grace_days integer not null default 60 check (non_payment_grace_days between 1 and 180),
  xero_status_stale_hours integer not null default 24 check (xero_status_stale_hours between 1 and 168),
  xero_membership_item_code text,
  require_staff_override_reason boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.membership_settings (id) values (true)
on conflict (id) do nothing;

create table if not exists public.membership_classes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('full', 'junior', 'affiliate', 'life')),
  name text not null,
  annual_fee numeric(10,2) not null check (annual_fee >= 0),
  has_voting_rights boolean not null default false,
  is_fee_exempt boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.membership_classes (code, name, annual_fee, has_voting_rights, is_fee_exempt, sort_order)
values
  ('full', 'Full', 150, true, false, 10),
  ('junior', 'Junior', 75, false, false, 20),
  ('affiliate', 'Affiliate', 45, false, false, 30),
  ('life', 'Life', 0, false, true, 40)
on conflict (code) do update set
  name = excluded.name,
  annual_fee = excluded.annual_fee,
  has_voting_rights = excluded.has_voting_rights,
  is_fee_exempt = excluded.is_fee_exempt,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.membership_documents (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  version text not null,
  effective_date date not null,
  document_url text,
  acknowledgement_required boolean not null default true,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (code, version)
);

insert into public.membership_documents (code, title, version, effective_date, document_url)
values
  ('constitution', 'Bendigo Flying Club Constitution', '2019-07', date '2019-07-01', '/membership-documents/bfc-constitution-2019-07.pdf'),
  ('bylaws', 'Bendigo Flying Club By-laws', '2019-07', date '2019-07-01', '/membership-documents/bfc-bylaws-2019-07.pdf'),
  ('code_of_conduct', 'Bendigo Flying Club Code of Conduct', '2018-01-12', date '2018-01-12', '/membership-documents/bfc-code-of-conduct-v1-2018-01-12.pdf'),
  ('members_manual', 'Bendigo Flying Club Members Manual', '2024-03', date '2024-03-01', '/membership-documents/bfc-members-manual-2nd-edition-2024.pdf')
on conflict (code, version) do update set document_url = excluded.document_url;

create table if not exists public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  membership_class_id uuid not null references public.membership_classes(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'auto_commenced')),
  residential_address text not null,
  service_address text not null,
  date_of_birth date,
  supports_club_purposes boolean not null default false,
  agrees_to_constitution boolean not null default false,
  agrees_to_member_guarantee boolean not null default false,
  agrees_to_code_of_conduct boolean not null default false,
  agrees_to_members_manual boolean not null default false,
  guardian_name text,
  guardian_consent boolean not null default false,
  submitted_at timestamptz not null default now(),
  automatic_commencement_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists membership_applications_one_pending_per_user
  on public.membership_applications(user_id) where status = 'pending';
create index if not exists membership_applications_status_auto_idx
  on public.membership_applications(status, automatic_commencement_at);

create table if not exists public.membership_application_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.membership_applications(id) on delete cascade,
  document_id uuid not null references public.membership_documents(id),
  acknowledged_at timestamptz not null default now(),
  acknowledgement_text text not null,
  unique (application_id, document_id)
);

create table if not exists public.club_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete restrict,
  membership_class_id uuid not null references public.membership_classes(id),
  application_id uuid references public.membership_applications(id) on delete set null,
  legal_status text not null default 'current'
    check (legal_status in ('current', 'ceased_non_payment', 'resigned', 'expelled', 'deceased')),
  commenced_at timestamptz not null,
  commencement_method text not null
    check (commencement_method in ('committee_approval', 'automatic_30_day', 'legacy_import', 'reinstatement')),
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists club_memberships_status_idx on public.club_memberships(legal_status);

create table if not exists public.membership_financial_periods (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.club_memberships(id) on delete cascade,
  financial_year_start date not null,
  financial_year_end date not null,
  standard_fee numeric(10,2) not null check (standard_fee >= 0),
  amount_due numeric(10,2) not null check (amount_due >= 0),
  fee_disposition text not null default 'invoice_required'
    check (fee_disposition in ('invoice_required', 'invoiced', 'paid', 'waived', 'fee_exempt', 'overdue', 'ceased')),
  due_date date not null,
  grace_expires_at timestamptz not null,
  financially_cleared_at timestamptz,
  xero_invoice_id text,
  xero_invoice_number text,
  xero_invoice_status text,
  xero_amount_due numeric(10,2),
  xero_last_synced_at timestamptz,
  xero_sync_error text,
  waiver_reason text,
  waiver_authorised_by uuid references auth.users(id) on delete set null,
  waiver_authorised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, financial_year_start)
);

create index if not exists membership_financial_periods_due_idx
  on public.membership_financial_periods(fee_disposition, grace_expires_at);
create index if not exists membership_financial_periods_xero_idx
  on public.membership_financial_periods(xero_invoice_id) where xero_invoice_id is not null;

create table if not exists public.membership_status_events (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid references public.club_memberships(id) on delete cascade,
  application_id uuid references public.membership_applications(id) on delete set null,
  user_id uuid not null references public.users(id) on delete restrict,
  event_type text not null,
  event_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb
);

create index if not exists membership_status_events_user_idx
  on public.membership_status_events(user_id, event_at desc);

create table if not exists public.membership_application_reminders (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.membership_applications(id) on delete cascade,
  reminder_day integer not null check (reminder_day in (14, 21, 27)),
  sent_at timestamptz not null default now(),
  unique (application_id, reminder_day)
);

alter table public.bookings
  add column if not exists membership_eligibility_status text,
  add column if not exists membership_warning_code text,
  add column if not exists membership_override_reason text,
  add column if not exists membership_overridden_by uuid references auth.users(id) on delete set null,
  add column if not exists membership_overridden_at timestamptz,
  add column if not exists membership_eligibility_snapshot jsonb;

create table if not exists public.membership_booking_overrides (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  subject_user_id uuid not null references public.users(id) on delete restrict,
  overridden_by uuid not null references auth.users(id) on delete restrict,
  override_reason text not null check (char_length(trim(override_reason)) >= 10),
  warning_code text not null,
  eligibility_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists membership_booking_overrides_booking_idx
  on public.membership_booking_overrides(booking_id, created_at desc);

create or replace function public.membership_financial_year_bounds(p_date date)
returns table(financial_year_start date, financial_year_end date)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_month integer;
  v_day integer;
  v_candidate date;
begin
  select s.financial_year_start_month, s.financial_year_start_day
    into v_month, v_day
  from public.membership_settings s where s.id = true;
  v_candidate := make_date(extract(year from p_date)::integer, coalesce(v_month, 7), coalesce(v_day, 1));
  if p_date < v_candidate then v_candidate := (v_candidate - interval '1 year')::date; end if;
  financial_year_start := v_candidate;
  financial_year_end := (v_candidate + interval '1 year - 1 day')::date;
  return next;
end;
$$;

create or replace function public.membership_period_amount(p_class_id uuid, p_commencement_date date)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_fee numeric;
  v_start date;
  v_end date;
begin
  select annual_fee into v_fee from public.membership_classes where id = p_class_id;
  select financial_year_start, financial_year_end into v_start, v_end
  from public.membership_financial_year_bounds(p_commencement_date);
  return round(coalesce(v_fee, 0) * ((v_end - p_commencement_date + 1)::numeric / (v_end - v_start + 1)::numeric), 2);
end;
$$;

create or replace function public.commence_membership_application_internal(
  p_application_id uuid,
  p_method text,
  p_actor_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app public.membership_applications%rowtype;
  v_class public.membership_classes%rowtype;
  v_membership_id uuid;
  v_fy_start date;
  v_fy_end date;
  v_amount numeric;
  v_disposition text;
  v_now timestamptz := now();
begin
  select * into v_app from public.membership_applications where id = p_application_id for update;
  if not found then raise exception 'Membership application not found'; end if;
  if v_app.status not in ('pending', 'approved') then return null; end if;
  if not (v_app.supports_club_purposes and v_app.agrees_to_constitution and
          v_app.agrees_to_member_guarantee and v_app.agrees_to_code_of_conduct and
          v_app.agrees_to_members_manual) then
    raise exception 'The membership application is incomplete';
  end if;
  if v_app.date_of_birth is not null and v_app.date_of_birth > (current_date - interval '18 years')::date
     and (not v_app.guardian_consent or nullif(trim(v_app.guardian_name), '') is null) then
    raise exception 'Guardian consent is required for a junior applicant';
  end if;

  select * into v_class from public.membership_classes where id = v_app.membership_class_id and is_active;
  if not found then raise exception 'Membership class is not available'; end if;

  insert into public.club_memberships (
    user_id, membership_class_id, application_id, legal_status, commenced_at, commencement_method
  ) values (
    v_app.user_id, v_app.membership_class_id, v_app.id, 'current', v_now, p_method
  )
  on conflict (user_id) do update set
    membership_class_id = excluded.membership_class_id,
    application_id = excluded.application_id,
    legal_status = 'current',
    commenced_at = excluded.commenced_at,
    commencement_method = excluded.commencement_method,
    ended_at = null,
    end_reason = null,
    updated_at = now()
  returning id into v_membership_id;

  select financial_year_start, financial_year_end into v_fy_start, v_fy_end
  from public.membership_financial_year_bounds(current_date);
  v_amount := case when v_class.is_fee_exempt then 0 else public.membership_period_amount(v_class.id, current_date) end;
  v_disposition := case when v_class.is_fee_exempt then 'fee_exempt' else 'invoice_required' end;

  insert into public.membership_financial_periods (
    membership_id, financial_year_start, financial_year_end, standard_fee, amount_due,
    fee_disposition, due_date, grace_expires_at, financially_cleared_at
  ) values (
    v_membership_id, v_fy_start, v_fy_end, v_class.annual_fee, v_amount,
    v_disposition, current_date,
    current_date::timestamptz + (select non_payment_grace_days from public.membership_settings where id = true) * interval '1 day',
    case when v_class.is_fee_exempt then v_now else null end
  )
  on conflict (membership_id, financial_year_start) do nothing;

  update public.membership_applications set
    status = case when p_method = 'automatic_30_day' then 'auto_commenced' else 'approved' end,
    decided_at = v_now,
    decided_by = p_actor_id,
    updated_at = v_now
  where id = v_app.id;

  insert into public.membership_status_events (
    membership_id, application_id, user_id, event_type, actor_id, details
  ) values (
    v_membership_id, v_app.id, v_app.user_id, 'membership_commenced', p_actor_id,
    jsonb_build_object('method', p_method, 'class', v_class.code, 'financialYearStart', v_fy_start,
      'amountDue', v_amount, 'feeDisposition', v_disposition)
  );

  insert into public.notifications(user_id, type, title, message, metadata, is_read)
  values (v_app.user_id, 'membership', 'BFC membership commenced',
    'Your Bendigo Flying Club membership has commenced. Aircraft booking access will be available when the membership fee is financially cleared.',
    jsonb_build_object('membershipId', v_membership_id, 'applicationId', v_app.id), false);

  return v_membership_id;
end;
$$;

revoke all on function public.commence_membership_application_internal(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.commence_membership_application_internal(uuid, text, uuid) to service_role;

create or replace function public.submit_membership_application(
  p_membership_class_code text,
  p_residential_address text,
  p_service_address text,
  p_date_of_birth date,
  p_guardian_name text default null,
  p_guardian_consent boolean default false,
  p_supports_club_purposes boolean default false,
  p_agrees_to_constitution boolean default false,
  p_agrees_to_member_guarantee boolean default false,
  p_agrees_to_code_of_conduct boolean default false,
  p_agrees_to_members_manual boolean default false
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_class_id uuid;
  v_application_id uuid;
  v_days integer;
  v_doc record;
begin
  if v_user_id is null then raise exception 'Sign in before applying for membership'; end if;
  if nullif(trim(coalesce(p_residential_address, '')), '') is null then raise exception 'Residential address is required'; end if;
  if not (p_supports_club_purposes and p_agrees_to_constitution and p_agrees_to_member_guarantee
          and p_agrees_to_code_of_conduct and p_agrees_to_members_manual) then
    raise exception 'All membership declarations must be accepted';
  end if;
  if p_date_of_birth is not null and p_date_of_birth > (current_date - interval '18 years')::date
     and (not p_guardian_consent or nullif(trim(coalesce(p_guardian_name, '')), '') is null) then
    raise exception 'Guardian consent is required for applicants under 18';
  end if;
  if p_membership_class_code = 'junior'
     and (p_date_of_birth is null or p_date_of_birth <= (current_date - interval '18 years')::date) then
    raise exception 'Junior membership requires a date of birth showing that the applicant is under 18';
  end if;
  if exists (select 1 from public.membership_applications where user_id = v_user_id and status = 'pending') then
    raise exception 'You already have a pending membership application';
  end if;
  if exists (select 1 from public.club_memberships where user_id = v_user_id and legal_status = 'current') then
    raise exception 'You already have a current BFC membership';
  end if;
  select id into v_class_id from public.membership_classes
  where code = p_membership_class_code and code <> 'life' and is_active;
  if v_class_id is null then raise exception 'Select Full, Junior or Affiliate membership. Life membership is assigned by an administrator.'; end if;
  select automatic_commencement_days into v_days from public.membership_settings where id = true;

  insert into public.membership_applications(
    user_id, membership_class_id, residential_address, service_address, date_of_birth,
    supports_club_purposes, agrees_to_constitution, agrees_to_member_guarantee,
    agrees_to_code_of_conduct, agrees_to_members_manual, guardian_name, guardian_consent,
    automatic_commencement_at
  ) values (
    v_user_id, v_class_id, trim(p_residential_address),
    coalesce(nullif(trim(coalesce(p_service_address, '')), ''), trim(p_residential_address)), p_date_of_birth,
    p_supports_club_purposes, p_agrees_to_constitution, p_agrees_to_member_guarantee,
    p_agrees_to_code_of_conduct, p_agrees_to_members_manual,
    nullif(trim(coalesce(p_guardian_name, '')), ''), p_guardian_consent,
    now() + coalesce(v_days, 30) * interval '1 day'
  ) returning id into v_application_id;

  update public.users set address = trim(p_residential_address), date_of_birth = coalesce(p_date_of_birth, date_of_birth), updated_at = now()
  where id = v_user_id;
  for v_doc in select * from public.membership_documents where is_current and acknowledgement_required
  loop
    insert into public.membership_application_acknowledgements(application_id, document_id, acknowledgement_text)
    values (v_application_id, v_doc.id, format('Applicant acknowledged %s version %s in the BFC portal.', v_doc.title, v_doc.version));
  end loop;
  insert into public.membership_status_events(application_id, user_id, event_type, actor_id, details)
  values (v_application_id, v_user_id, 'application_submitted', v_user_id, jsonb_build_object('source', 'membership_portal'));
  return v_application_id;
end;
$$;

create or replace function public.decide_membership_application(
  p_application_id uuid,
  p_decision text,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app public.membership_applications%rowtype;
  v_membership_id uuid;
begin
  if not public.current_user_is_admin() then raise exception 'Only administrators can decide membership applications'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject'; end if;
  select * into v_app from public.membership_applications where id = p_application_id for update;
  if not found or v_app.status <> 'pending' then raise exception 'This application is no longer pending'; end if;

  if p_decision = 'reject' then
    if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A rejection reason is required'; end if;
    update public.membership_applications set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
      decision_reason = trim(p_reason), updated_at = now() where id = p_application_id;
    insert into public.membership_status_events(application_id, user_id, event_type, actor_id, details)
    values (p_application_id, v_app.user_id, 'application_rejected', auth.uid(), jsonb_build_object('reason', trim(p_reason)));
    insert into public.notifications(user_id, type, title, message, metadata, is_read)
    values (v_app.user_id, 'membership', 'Membership application decision',
      'Your Bendigo Flying Club membership application was not approved. Please contact the club for further information.',
      jsonb_build_object('applicationId', p_application_id), false);
    return null;
  end if;

  v_membership_id := public.commence_membership_application_internal(p_application_id, 'committee_approval', auth.uid());
  update public.membership_applications set decision_reason = nullif(trim(coalesce(p_reason, '')), '') where id = p_application_id;
  return v_membership_id;
end;
$$;

create or replace function public.set_membership_fee_disposition(
  p_period_id uuid,
  p_disposition text,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_period public.membership_financial_periods%rowtype;
  v_user_id uuid;
begin
  if not public.current_user_is_admin() then raise exception 'Only administrators can change membership fees'; end if;
  if p_disposition not in ('invoice_required', 'waived') then
    raise exception 'Administrators may require an invoice or authorise a waiver. Paid status must come from Xero.';
  end if;
  if p_disposition = 'waived' and char_length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A waiver reason of at least 10 characters is required';
  end if;
  select * into v_period from public.membership_financial_periods where id = p_period_id for update;
  if not found then raise exception 'Membership financial period not found'; end if;
  select m.user_id into v_user_id from public.club_memberships m where m.id = v_period.membership_id;

  update public.membership_financial_periods set
    fee_disposition = p_disposition,
    financially_cleared_at = case when p_disposition in ('paid', 'waived', 'fee_exempt') then now() else null end,
    waiver_reason = case when p_disposition = 'waived' then trim(p_reason) else null end,
    waiver_authorised_by = case when p_disposition = 'waived' then auth.uid() else null end,
    waiver_authorised_at = case when p_disposition = 'waived' then now() else null end,
    updated_at = now()
  where id = p_period_id;

  insert into public.membership_status_events(membership_id, user_id, event_type, actor_id, details)
  values (v_period.membership_id, v_user_id, 'fee_disposition_changed', auth.uid(),
    jsonb_build_object('periodId', p_period_id, 'from', v_period.fee_disposition, 'to', p_disposition, 'reason', p_reason));
end;
$$;

create or replace function public.import_legacy_membership(
  p_user_id uuid,
  p_membership_class_code text,
  p_commenced_at date,
  p_fee_disposition text default 'paid',
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_class public.membership_classes%rowtype;
  v_membership_id uuid;
  v_fy_start date;
  v_fy_end date;
  v_disposition text;
begin
  if not public.current_user_is_admin() then raise exception 'Only administrators can import existing members'; end if;
  if not exists (select 1 from public.users where id = p_user_id and coalesce(portal_access_scope, 'full') = 'full') then
    raise exception 'Select a valid portal user';
  end if;
  select * into v_class from public.membership_classes where code = p_membership_class_code and is_active;
  if not found then raise exception 'Select a valid membership class'; end if;
  v_disposition := case when v_class.is_fee_exempt then 'fee_exempt' else p_fee_disposition end;
  if v_disposition not in ('invoice_required', 'paid', 'waived', 'fee_exempt') then raise exception 'Unsupported fee disposition'; end if;
  if v_disposition = 'waived' and char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'A waiver reason of at least 10 characters is required'; end if;

  insert into public.club_memberships(user_id, membership_class_id, legal_status, commenced_at, commencement_method)
  values (p_user_id, v_class.id, 'current', coalesce(p_commenced_at, current_date)::timestamptz, 'legacy_import')
  on conflict (user_id) do update set membership_class_id = excluded.membership_class_id,
    legal_status = 'current', commenced_at = excluded.commenced_at, commencement_method = 'legacy_import',
    ended_at = null, end_reason = null, updated_at = now()
  returning id into v_membership_id;

  select financial_year_start, financial_year_end into v_fy_start, v_fy_end
  from public.membership_financial_year_bounds(current_date);
  insert into public.membership_financial_periods(
    membership_id, financial_year_start, financial_year_end, standard_fee, amount_due,
    fee_disposition, due_date, grace_expires_at, financially_cleared_at,
    waiver_reason, waiver_authorised_by, waiver_authorised_at
  ) values (
    v_membership_id, v_fy_start, v_fy_end, v_class.annual_fee, v_class.annual_fee,
    v_disposition, v_fy_start,
    v_fy_start::timestamptz + (select non_payment_grace_days from public.membership_settings where id = true) * interval '1 day',
    case when v_disposition in ('paid', 'waived', 'fee_exempt') then now() else null end,
    case when v_disposition = 'waived' then trim(p_reason) else null end,
    case when v_disposition = 'waived' then auth.uid() else null end,
    case when v_disposition = 'waived' then now() else null end
  ) on conflict (membership_id, financial_year_start) do update set
    standard_fee = excluded.standard_fee, amount_due = excluded.amount_due,
    fee_disposition = excluded.fee_disposition, financially_cleared_at = excluded.financially_cleared_at,
    waiver_reason = excluded.waiver_reason, waiver_authorised_by = excluded.waiver_authorised_by,
    waiver_authorised_at = excluded.waiver_authorised_at, updated_at = now();

  insert into public.membership_status_events(membership_id, user_id, event_type, actor_id, details)
  values (v_membership_id, p_user_id, 'legacy_membership_imported', auth.uid(),
    jsonb_build_object('class', v_class.code, 'commencedAt', p_commenced_at, 'feeDisposition', v_disposition, 'reason', p_reason));
  return v_membership_id;
end;
$$;

create or replace function public.link_membership_xero_invoice(
  p_period_id uuid,
  p_invoice_id text,
  p_invoice_number text,
  p_invoice_status text,
  p_amount_due numeric
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.current_user_is_admin() then raise exception 'Only administrators can link membership invoices'; end if;
  update public.membership_financial_periods set
    xero_invoice_id = nullif(trim(p_invoice_id), ''),
    xero_invoice_number = nullif(trim(p_invoice_number), ''),
    xero_invoice_status = upper(nullif(trim(p_invoice_status), '')),
    xero_amount_due = greatest(coalesce(p_amount_due, 0), 0),
    xero_last_synced_at = now(),
    xero_sync_error = null,
    fee_disposition = case when upper(coalesce(p_invoice_status, '')) = 'PAID' or coalesce(p_amount_due, 0) <= 0.005 then 'paid' else 'invoiced' end,
    financially_cleared_at = case when upper(coalesce(p_invoice_status, '')) = 'PAID' or coalesce(p_amount_due, 0) <= 0.005 then now() else null end,
    updated_at = now()
  where id = p_period_id;
  if not found then raise exception 'Membership financial period not found'; end if;
end;
$$;

create or replace function public.process_membership_lifecycle(p_as_of timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_app record;
  v_period record;
  v_reminder_day integer;
  v_commenced integer := 0;
  v_ceased integer := 0;
  v_reminders integer := 0;
  v_deferred_stale integer := 0;
begin
  -- The function is run by pg_cron/service_role. Admins may also run it manually.
  if auth.uid() is not null and not public.current_user_is_admin() then
    raise exception 'Only administrators can process the membership lifecycle';
  end if;

  for v_app in
    select a.* from public.membership_applications a
    where a.status = 'pending' and a.automatic_commencement_at <= p_as_of
      and a.supports_club_purposes and a.agrees_to_constitution and a.agrees_to_member_guarantee
      and a.agrees_to_code_of_conduct and a.agrees_to_members_manual
      and (a.date_of_birth is null or a.date_of_birth <= (p_as_of::date - interval '18 years')::date
           or (a.guardian_consent and nullif(trim(a.guardian_name), '') is not null))
    for update skip locked
  loop
    perform public.commence_membership_application_internal(v_app.id, 'automatic_30_day', null);
    v_commenced := v_commenced + 1;
  end loop;

  for v_app in select a.* from public.membership_applications a where a.status = 'pending'
  loop
    foreach v_reminder_day in array array[14,21,27]
    loop
      if p_as_of >= v_app.submitted_at + v_reminder_day * interval '1 day'
         and p_as_of < v_app.automatic_commencement_at
         and not exists (select 1 from public.membership_application_reminders r where r.application_id = v_app.id and r.reminder_day = v_reminder_day) then
        insert into public.membership_application_reminders(application_id, reminder_day) values (v_app.id, v_reminder_day);
        insert into public.notifications(user_id, type, title, message, metadata, is_read)
        select u.id, 'membership', 'Membership application needs a decision',
          format('%s membership application reaches automatic commencement in %s day(s).', applicant.name,
            greatest(0, ceil(extract(epoch from (v_app.automatic_commencement_at - p_as_of)) / 86400)::integer)),
          jsonb_build_object('applicationId', v_app.id, 'applicantUserId', v_app.user_id, 'reminderDay', v_reminder_day), false
        from public.users u
        join public.user_roles ur on ur.user_id = u.id and ur.role = 'admin'
        join public.users applicant on applicant.id = v_app.user_id;
        v_reminders := v_reminders + 1;
      end if;
    end loop;
  end loop;

  -- Ensure every current membership has the current financial-year period.
  insert into public.membership_financial_periods(
    membership_id, financial_year_start, financial_year_end, standard_fee, amount_due,
    fee_disposition, due_date, grace_expires_at, financially_cleared_at
  )
  select m.id, fy.financial_year_start, fy.financial_year_end, c.annual_fee, c.annual_fee,
    case when c.is_fee_exempt then 'fee_exempt' else 'invoice_required' end,
    fy.financial_year_start,
    fy.financial_year_start::timestamptz + s.non_payment_grace_days * interval '1 day',
    case when c.is_fee_exempt then p_as_of else null end
  from public.club_memberships m
  join public.membership_classes c on c.id = m.membership_class_id
  cross join public.membership_settings s
  cross join lateral public.membership_financial_year_bounds(p_as_of::date) fy
  where m.legal_status = 'current' and s.id = true
  on conflict (membership_id, financial_year_start) do nothing;

  update public.membership_financial_periods set fee_disposition = 'overdue', updated_at = p_as_of
  where fee_disposition in ('invoice_required', 'invoiced') and due_date < p_as_of::date;

  -- Xero is authoritative for invoice payment. Never automatically cease a member from a
  -- linked invoice when the cached Xero result is missing or stale; an admin can refresh it
  -- and rerun the lifecycle without risking a false cessation.
  select count(*) into v_deferred_stale
  from public.membership_financial_periods p
  join public.club_memberships m on m.id = p.membership_id
  cross join public.membership_settings s
  where s.id = true and m.legal_status = 'current'
    and p.fee_disposition in ('invoiced', 'overdue')
    and p.grace_expires_at <= p_as_of
    and p.xero_invoice_id is not null
    and (p.xero_last_synced_at is null
      or p.xero_last_synced_at < p_as_of - s.xero_status_stale_hours * interval '1 hour');

  for v_period in
    select p.*, m.user_id from public.membership_financial_periods p
    join public.club_memberships m on m.id = p.membership_id
    cross join public.membership_settings s
    where m.legal_status = 'current' and p.fee_disposition in ('invoice_required', 'invoiced', 'overdue')
      and p.grace_expires_at <= p_as_of
      and s.id = true
      and (
        p.xero_invoice_id is null
        or (
          p.xero_last_synced_at is not null
          and p.xero_last_synced_at >= p_as_of - s.xero_status_stale_hours * interval '1 hour'
          and coalesce(p.xero_amount_due, p.amount_due) > 0.005
        )
      )
    for update of p skip locked
  loop
    update public.membership_financial_periods set fee_disposition = 'ceased', updated_at = p_as_of where id = v_period.id;
    update public.club_memberships set legal_status = 'ceased_non_payment', ended_at = p_as_of,
      end_reason = 'Membership fee remained unpaid for 60 days after falling due', updated_at = p_as_of
    where id = v_period.membership_id;
    insert into public.membership_status_events(membership_id, user_id, event_type, details)
    values (v_period.membership_id, v_period.user_id, 'membership_ceased_non_payment',
      jsonb_build_object('periodId', v_period.id, 'dueDate', v_period.due_date, 'graceExpiredAt', v_period.grace_expires_at));
    insert into public.notifications(user_id, type, title, message, metadata, is_read)
    values (v_period.user_id, 'membership', 'BFC membership ceased',
      'Your Bendigo Flying Club membership has ceased because the membership fee remained unpaid for 60 days after it fell due.',
      jsonb_build_object('membershipId', v_period.membership_id, 'periodId', v_period.id), false);
    v_ceased := v_ceased + 1;
  end loop;

  return jsonb_build_object(
    'commenced', v_commenced,
    'ceased', v_ceased,
    'reminders', v_reminders,
    'deferredForStaleXero', v_deferred_stale,
    'processedAt', p_as_of
  );
end;
$$;

create or replace function public.assess_member_booking_eligibility(
  p_user_id uuid,
  p_booking_start timestamptz,
  p_is_guest boolean default false,
  p_has_aircraft boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_membership public.club_memberships%rowtype;
  v_period public.membership_financial_periods%rowtype;
  v_class public.membership_classes%rowtype;
  v_settings public.membership_settings%rowtype;
  v_is_staff boolean := public.current_user_has_staff_role();
  v_reason text;
  v_code text;
  v_eligible boolean := false;
begin
  select * into v_settings from public.membership_settings where id = true;
  if coalesce(p_is_guest, false) then
    return jsonb_build_object('eligible', true, 'reasonCode', 'guest_booking', 'message', 'Guest bookings do not require BFC membership.',
      'isGuest', true, 'rolloutMode', v_settings.rollout_mode, 'staffOverrideAllowed', false, 'blocked', false);
  end if;
  if not coalesce(p_has_aircraft, true) then
    return jsonb_build_object('eligible', true, 'reasonCode', 'no_aircraft', 'message', 'This booking does not reserve an aircraft.',
      'isGuest', false, 'rolloutMode', v_settings.rollout_mode, 'staffOverrideAllowed', false, 'blocked', false);
  end if;

  select * into v_membership from public.club_memberships where user_id = p_user_id;
  if not found then
    v_code := 'no_bfc_membership'; v_reason := 'This person does not have a current BFC membership record.';
  elsif v_membership.legal_status <> 'current' then
    v_code := 'membership_not_current'; v_reason := format('BFC membership status is %s.', replace(v_membership.legal_status, '_', ' '));
  else
    select * into v_class from public.membership_classes where id = v_membership.membership_class_id;
    select p.* into v_period from public.membership_financial_periods p
    where p.membership_id = v_membership.id and p_booking_start::date between p.financial_year_start and p.financial_year_end
    order by p.financial_year_start desc limit 1;
    if not found then
      v_code := 'financial_period_missing'; v_reason := 'No membership fee record exists for the booking financial year.';
    elsif v_period.fee_disposition in ('paid', 'waived', 'fee_exempt') then
      v_eligible := true; v_code := 'financially_cleared';
      v_reason := case v_period.fee_disposition
        when 'waived' then 'The membership fee is waived for this financial year.'
        when 'fee_exempt' then 'This membership class is fee exempt.'
        else 'The membership fee is paid.' end;
    else
      v_code := 'membership_fee_not_cleared';
      v_reason := format('BFC membership remains current, but the fee status is %s. Aircraft self-booking is unavailable until financially cleared.', replace(v_period.fee_disposition, '_', ' '));
    end if;
  end if;

  return jsonb_build_object(
    'eligible', v_eligible,
    'reasonCode', v_code,
    'message', v_reason,
    'isGuest', false,
    'legalStatus', v_membership.legal_status,
    'membershipClass', v_class.code,
    'membershipClassName', v_class.name,
    'feeDisposition', v_period.fee_disposition,
    'dueDate', v_period.due_date,
    'graceExpiresAt', v_period.grace_expires_at,
    'xeroLastSyncedAt', v_period.xero_last_synced_at,
    'rolloutMode', v_settings.rollout_mode,
    'staffOverrideAllowed', v_is_staff,
    'requiresStaffOverride', (not v_eligible and v_is_staff and v_settings.rollout_mode in ('staff_warning', 'enforced')),
    'blocked', (not v_eligible and not v_is_staff and v_settings.rollout_mode = 'enforced')
  );
end;
$$;

create or replace function public.enforce_booking_membership_eligibility()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_assessment jsonb;
  v_is_staff boolean := public.current_user_has_staff_role();
  v_requires_override boolean;
  v_blocked boolean;
begin
  v_assessment := public.assess_member_booking_eligibility(
    new.student_id, new.start_time, coalesce(new.is_guest_booking, false), new.aircraft_id is not null
  );
  new.membership_eligibility_status := case when coalesce((v_assessment->>'eligible')::boolean, false) then 'eligible' else 'not_eligible' end;
  new.membership_warning_code := v_assessment->>'reasonCode';
  new.membership_eligibility_snapshot := v_assessment;
  v_requires_override := coalesce((v_assessment->>'requiresStaffOverride')::boolean, false);
  v_blocked := coalesce((v_assessment->>'blocked')::boolean, false);

  if v_blocked then raise exception using errcode = 'P0001', message = coalesce(v_assessment->>'message', 'BFC membership is not financially cleared.'); end if;
  if v_requires_override then
    if char_length(trim(coalesce(new.membership_override_reason, ''))) < 10 then
      raise exception using errcode = 'P0001', message = 'Membership warning: ' || coalesce(v_assessment->>'message', 'Membership is not financially cleared.') || ' Staff may continue with an override reason of at least 10 characters.';
    end if;
    new.membership_override_reason := trim(new.membership_override_reason);
    new.membership_overridden_by := auth.uid();
    new.membership_overridden_at := now();
  elsif coalesce((v_assessment->>'eligible')::boolean, false) then
    new.membership_override_reason := null;
    new.membership_overridden_by := null;
    new.membership_overridden_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_booking_membership_eligibility on public.bookings;
create trigger enforce_booking_membership_eligibility
before insert or update of student_id, start_time, aircraft_id, is_guest_booking, membership_override_reason
on public.bookings for each row execute function public.enforce_booking_membership_eligibility();

create or replace function public.record_membership_booking_override()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.membership_overridden_by is not null and new.membership_override_reason is not null
     and (tg_op = 'INSERT' or old.membership_overridden_at is distinct from new.membership_overridden_at) then
    insert into public.membership_booking_overrides(
      booking_id, subject_user_id, overridden_by, override_reason, warning_code, eligibility_snapshot
    ) values (
      new.id, new.student_id, new.membership_overridden_by, new.membership_override_reason,
      coalesce(new.membership_warning_code, 'membership_warning'), coalesce(new.membership_eligibility_snapshot, '{}'::jsonb)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_membership_booking_override on public.bookings;
create trigger record_membership_booking_override
after insert or update of membership_overridden_at on public.bookings
for each row execute function public.record_membership_booking_override();

create or replace function public.create_membership_application_for_new_user()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_meta jsonb;
  v_class_id uuid;
  v_application_id uuid;
  v_days integer;
  v_doc record;
begin
  if coalesce(new.portal_access_scope, 'full') <> 'full' then return new; end if;
  select raw_user_meta_data into v_meta from auth.users where id = new.id;
  if coalesce((v_meta->>'membership_application')::boolean, false) is not true then return new; end if;
  select id into v_class_id from public.membership_classes
  where code = coalesce(nullif(v_meta->>'membership_class', ''), 'full')
    and code <> 'life' and is_active;
  if v_class_id is null then
    raise exception 'Select Full, Junior or Affiliate membership. Life membership is assigned by an administrator.';
  end if;
  if coalesce(nullif(v_meta->>'membership_class', ''), 'full') = 'junior'
     and (nullif(v_meta->>'date_of_birth', '') is null
       or nullif(v_meta->>'date_of_birth', '')::date <= (current_date - interval '18 years')::date) then
    raise exception 'Junior membership requires a date of birth showing that the applicant is under 18';
  end if;
  select automatic_commencement_days into v_days from public.membership_settings where id = true;
  insert into public.membership_applications(
    user_id, membership_class_id, residential_address, service_address, date_of_birth,
    supports_club_purposes, agrees_to_constitution, agrees_to_member_guarantee,
    agrees_to_code_of_conduct, agrees_to_members_manual, guardian_name, guardian_consent,
    automatic_commencement_at
  ) values (
    new.id, v_class_id, trim(coalesce(v_meta->>'residential_address', '')),
    trim(coalesce(nullif(v_meta->>'service_address', ''), v_meta->>'residential_address', '')),
    nullif(v_meta->>'date_of_birth', '')::date,
    coalesce((v_meta->>'supports_club_purposes')::boolean, false),
    coalesce((v_meta->>'agrees_to_constitution')::boolean, false),
    coalesce((v_meta->>'agrees_to_member_guarantee')::boolean, false),
    coalesce((v_meta->>'agrees_to_code_of_conduct')::boolean, false),
    coalesce((v_meta->>'agrees_to_members_manual')::boolean, false),
    nullif(trim(coalesce(v_meta->>'guardian_name', '')), ''),
    coalesce((v_meta->>'guardian_consent')::boolean, false),
    now() + coalesce(v_days, 30) * interval '1 day'
  ) returning id into v_application_id;

  update public.users set
    address = trim(coalesce(v_meta->>'residential_address', address)),
    date_of_birth = coalesce(nullif(v_meta->>'date_of_birth', '')::date, date_of_birth),
    updated_at = now()
  where id = new.id;

  for v_doc in select * from public.membership_documents where is_current and acknowledgement_required
  loop
    insert into public.membership_application_acknowledgements(application_id, document_id, acknowledgement_text)
    values (v_application_id, v_doc.id, format('Applicant acknowledged %s version %s during portal signup.', v_doc.title, v_doc.version));
  end loop;
  insert into public.membership_status_events(application_id, user_id, event_type, details)
  values (v_application_id, new.id, 'application_submitted', jsonb_build_object('source', 'portal_signup'));
  return new;
end;
$$;

drop trigger if exists create_membership_application_for_new_user on public.users;
create trigger create_membership_application_for_new_user
after insert on public.users for each row execute function public.create_membership_application_for_new_user();

alter table public.membership_settings enable row level security;
alter table public.membership_classes enable row level security;
alter table public.membership_documents enable row level security;
alter table public.membership_applications enable row level security;
alter table public.membership_application_acknowledgements enable row level security;
alter table public.club_memberships enable row level security;
alter table public.membership_financial_periods enable row level security;
alter table public.membership_status_events enable row level security;
alter table public.membership_application_reminders enable row level security;
alter table public.membership_booking_overrides enable row level security;

create policy "Authenticated users can read membership configuration" on public.membership_settings for select to authenticated using (true);
create policy "Admins manage membership configuration" on public.membership_settings for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Authenticated users can read membership classes" on public.membership_classes for select to authenticated using (true);
create policy "Admins manage membership classes" on public.membership_classes for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Authenticated users can read membership documents" on public.membership_documents for select to authenticated using (true);
create policy "Admins manage membership documents" on public.membership_documents for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "Users read own membership applications" on public.membership_applications for select to authenticated using (user_id = auth.uid());
create policy "Admins manage membership applications" on public.membership_applications for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Users read own application acknowledgements" on public.membership_application_acknowledgements for select to authenticated
  using (exists (select 1 from public.membership_applications a where a.id = application_id and (a.user_id = auth.uid() or public.current_user_is_admin())));
create policy "Admins manage application acknowledgements" on public.membership_application_acknowledgements for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "Users read own BFC membership" on public.club_memberships for select to authenticated using (user_id = auth.uid() or public.current_user_is_admin());
create policy "Admins manage BFC memberships" on public.club_memberships for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Users read own membership fees" on public.membership_financial_periods for select to authenticated
  using (exists (select 1 from public.club_memberships m where m.id = membership_id and (m.user_id = auth.uid() or public.current_user_is_admin())));
create policy "Admins manage membership fees" on public.membership_financial_periods for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Users read own membership history" on public.membership_status_events for select to authenticated using (user_id = auth.uid() or public.current_user_is_admin());
create policy "Admins manage membership history" on public.membership_status_events for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "Admins read application reminders" on public.membership_application_reminders for select to authenticated using (public.current_user_is_admin());
create policy "Users read own membership overrides" on public.membership_booking_overrides for select to authenticated
  using (subject_user_id = auth.uid() or public.current_user_has_staff_role());

-- Instructors as well as admins may create genuine guest bookings. The server-side
-- membership trigger still protects non-guest member bookings and records overrides.
drop policy if exists "Members and staff can create permitted bookings" on public.bookings;
create policy "Members and staff can create permitted bookings" on public.bookings for insert to authenticated
with check (
  ((coalesce(is_guest_booking, false) = false) and public.current_user_has_full_portal_access() and student_id = auth.uid())
  or ((coalesce(is_guest_booking, false) = false) and public.current_user_has_staff_role())
  or ((coalesce(is_guest_booking, false) = true) and public.current_user_has_staff_role())
);

grant select on public.membership_settings, public.membership_classes, public.membership_documents,
  public.membership_applications, public.membership_application_acknowledgements,
  public.club_memberships, public.membership_financial_periods, public.membership_status_events,
  public.membership_application_reminders, public.membership_booking_overrides to authenticated;
grant insert, update, delete on public.membership_settings, public.membership_classes, public.membership_documents,
  public.membership_applications, public.membership_application_acknowledgements,
  public.club_memberships, public.membership_financial_periods, public.membership_status_events,
  public.membership_application_reminders, public.membership_booking_overrides to authenticated;
grant all on all tables in schema public to service_role;
grant execute on function public.membership_financial_year_bounds(date), public.membership_period_amount(uuid, date),
  public.submit_membership_application(text, text, text, date, text, boolean, boolean, boolean, boolean, boolean, boolean),
  public.decide_membership_application(uuid, text, text), public.set_membership_fee_disposition(uuid, text, text),
  public.import_legacy_membership(uuid, text, date, text, text),
  public.link_membership_xero_invoice(uuid, text, text, text, numeric), public.process_membership_lifecycle(timestamptz),
  public.assess_member_booking_eligibility(uuid, timestamptz, boolean, boolean) to authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for v_job_id in select jobid from cron.job where jobname = 'process-bfc-membership-lifecycle'
    loop
      perform cron.unschedule(v_job_id);
    end loop;
    perform cron.schedule(
      'process-bfc-membership-lifecycle',
      '15 2 * * *',
      'select public.process_membership_lifecycle(now());'
    );
  end if;
end;
$$;

comment on table public.club_memberships is 'Legal Bendigo Flying Club membership. This is separate from RAAus membership and portal access.';
comment on table public.membership_financial_periods is 'Annual BFC membership fee clearance; Xero is authoritative for payments while portal-authorised waivers and fee exemptions also clear booking access.';
comment on column public.bookings.membership_override_reason is 'Per-booking staff reason for proceeding when BFC membership is not financially cleared; never bypasses safety, duty, grounding or supervision controls.';
