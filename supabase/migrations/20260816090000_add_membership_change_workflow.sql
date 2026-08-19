-- Auditable membership-class changes with safe billing boundaries and strict
-- Junior eligibility. Current-year invoices are never silently rewritten.

create table if not exists public.membership_change_requests (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.club_memberships(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  from_membership_class_id uuid not null references public.membership_classes(id),
  to_membership_class_id uuid not null references public.membership_classes(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'applied', 'needs_review')),
  requested_effective_timing text not null default 'next_renewal'
    check (requested_effective_timing in ('immediate', 'next_renewal')),
  effective_on date not null,
  request_reason text not null check (char_length(btrim(request_reason)) >= 5),
  requested_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_membership_class_id <> to_membership_class_id)
);

create unique index if not exists membership_change_requests_one_open_per_membership
  on public.membership_change_requests(membership_id)
  where status in ('pending', 'approved', 'needs_review');

create index if not exists membership_change_requests_status_effective_idx
  on public.membership_change_requests(status, effective_on);

alter table public.membership_change_requests enable row level security;

drop policy if exists "Members read own membership changes" on public.membership_change_requests;
create policy "Members read own membership changes"
  on public.membership_change_requests for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

grant select on public.membership_change_requests to authenticated;
grant all on public.membership_change_requests to service_role;

create or replace function private.enforce_junior_membership_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class_code text;
  v_date_of_birth date;
begin
  select membership_class.code into v_class_code
  from public.membership_classes membership_class
  where membership_class.id = new.membership_class_id;

  if v_class_code <> 'junior' then return new; end if;

  select member.date_of_birth into v_date_of_birth
  from public.users member
  where member.id = new.user_id;

  if v_date_of_birth is null then
    raise exception 'A date of birth is required for Junior membership';
  end if;
  if v_date_of_birth <= (current_date - interval '18 years')::date then
    raise exception 'Junior membership is only available while the member is under 18';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_junior_membership_eligibility on public.club_memberships;
create trigger enforce_junior_membership_eligibility
before insert or update of user_id, membership_class_id on public.club_memberships
for each row execute function private.enforce_junior_membership_eligibility();

create or replace function private.apply_membership_change_request(
  p_request_id uuid,
  p_actor_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.membership_change_requests%rowtype;
  v_membership public.club_memberships%rowtype;
  v_target public.membership_classes%rowtype;
  v_date_of_birth date;
  v_blocked boolean;
begin
  select * into v_request
  from public.membership_change_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Membership change request not found'; end if;
  if v_request.status <> 'approved' then return false; end if;
  if v_request.effective_on > current_date then return false; end if;

  select * into v_membership
  from public.club_memberships
  where id = v_request.membership_id and user_id = v_request.user_id
  for update;
  if not found or v_membership.legal_status <> 'current' then
    raise exception 'Only a current membership can be changed';
  end if;

  select * into v_target
  from public.membership_classes
  where id = v_request.to_membership_class_id and is_active;
  if not found then raise exception 'The requested membership is no longer available'; end if;

  if v_target.code = 'junior' then
    select date_of_birth into v_date_of_birth from public.users where id = v_request.user_id;
    if v_date_of_birth is null
       or v_date_of_birth <= (v_request.effective_on - interval '18 years')::date then
      raise exception 'Junior membership is only available while the member is under 18 on the change date';
    end if;
  end if;

  select exists (
    select 1
    from public.membership_financial_periods period
    where period.membership_id = v_membership.id
      and period.financial_year_start >= v_request.effective_on
      and (
        period.xero_invoice_id is not null
        or period.fee_disposition not in ('invoice_required', 'fee_exempt')
        or period.billing_sync_status is not null
      )
  ) into v_blocked;

  if v_blocked then
    update public.membership_change_requests
    set status = 'needs_review',
        decision_reason = concat_ws(' ', nullif(decision_reason, ''),
          'A prepared future invoice or payment must be resolved before this change can be applied.'),
        updated_at = now()
    where id = v_request.id;
    return false;
  end if;

  update public.club_memberships
  set membership_class_id = v_target.id, updated_at = now()
  where id = v_membership.id;

  -- Current-year charges stay as legally issued. Only unissued periods beginning
  -- on or after the change date adopt the new membership price.
  update public.membership_financial_periods period
  set standard_fee = v_target.annual_fee,
      membership_fee_amount = v_target.annual_fee,
      amount_due = v_target.annual_fee + coalesce(period.scholarship_contribution_amount, 0),
      fee_disposition = case
        when v_target.is_fee_exempt and coalesce(period.scholarship_contribution_amount, 0) <= 0
          then 'fee_exempt'
        else 'invoice_required'
      end,
      financially_cleared_at = case
        when v_target.is_fee_exempt and coalesce(period.scholarship_contribution_amount, 0) <= 0
          then now()
        else null
      end,
      waiver_reason = null,
      waiver_type = null,
      waiver_authority_reference = null,
      waiver_authorised_by = null,
      waiver_authorised_at = null,
      billing_sync_status = null,
      billing_sync_attempts = 0,
      billing_sync_next_attempt_at = null,
      billing_sync_error = null,
      billing_sync_updated_at = null,
      updated_at = now()
  where period.membership_id = v_membership.id
    and period.financial_year_start >= v_request.effective_on;

  update public.membership_change_requests
  set status = 'applied', applied_at = now(), updated_at = now()
  where id = v_request.id;

  insert into public.membership_status_events(
    membership_id, user_id, event_type, actor_id, details
  ) values (
    v_membership.id,
    v_membership.user_id,
    'membership_class_changed',
    p_actor_id,
    jsonb_build_object(
      'requestId', v_request.id,
      'fromClassId', v_request.from_membership_class_id,
      'toClassId', v_target.id,
      'toClassCode', v_target.code,
      'effectiveOn', v_request.effective_on,
      'timing', v_request.requested_effective_timing,
      'currentYearBillingChanged', false
    )
  );

  insert into public.notifications(user_id, type, title, message, metadata, is_read)
  values (
    v_membership.user_id,
    'membership',
    'Membership changed',
    format('Your BFC membership is now %s. Existing current-year charges were not changed.', v_target.name),
    jsonb_build_object('membershipId', v_membership.id, 'membershipChangeRequestId', v_request.id),
    false
  );
  return true;
end;
$$;

revoke all on function private.apply_membership_change_request(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.request_membership_change(
  p_to_membership_class_code text,
  p_effective_timing text default 'next_renewal',
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membership public.club_memberships%rowtype;
  v_target public.membership_classes%rowtype;
  v_effective_on date;
  v_date_of_birth date;
  v_request_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in to request a membership change'; end if;
  if p_effective_timing not in ('immediate', 'next_renewal') then
    raise exception 'Select when the membership change should take effect';
  end if;
  if char_length(coalesce(v_reason, '')) < 5 then
    raise exception 'Explain the membership change in at least 5 characters';
  end if;

  select * into v_membership
  from public.club_memberships
  where user_id = auth.uid() and legal_status = 'current'
  for update;
  if not found then raise exception 'A current BFC membership is required'; end if;

  select * into v_target
  from public.membership_classes
  where code = lower(btrim(p_to_membership_class_code)) and is_active;
  if not found or v_target.code = 'life' then
    raise exception 'Select an available membership. Life membership is assigned by an administrator.';
  end if;
  if v_target.id = v_membership.membership_class_id then
    raise exception 'Select a different membership';
  end if;
  if exists (
    select 1 from public.membership_change_requests
    where membership_id = v_membership.id and status in ('pending', 'approved', 'needs_review')
  ) then raise exception 'This membership already has an open change request'; end if;

  if p_effective_timing = 'immediate' then
    v_effective_on := current_date;
  else
    select financial_year_end + 1 into v_effective_on
    from public.membership_financial_year_bounds(current_date);
  end if;

  if v_target.code = 'junior' then
    select date_of_birth into v_date_of_birth from public.users where id = v_membership.user_id;
    if v_date_of_birth is null or v_date_of_birth <= (v_effective_on - interval '18 years')::date then
      raise exception 'Junior membership is only available while the member is under 18 on the change date';
    end if;
  end if;

  insert into public.membership_change_requests(
    membership_id, user_id, from_membership_class_id, to_membership_class_id,
    requested_effective_timing, effective_on, request_reason, requested_by
  ) values (
    v_membership.id, v_membership.user_id, v_membership.membership_class_id, v_target.id,
    p_effective_timing, v_effective_on, v_reason, auth.uid()
  ) returning id into v_request_id;

  insert into public.membership_status_events(membership_id, user_id, event_type, actor_id, details)
  values (v_membership.id, v_membership.user_id, 'membership_change_requested', auth.uid(),
    jsonb_build_object('requestId', v_request_id, 'toClass', v_target.code,
      'effectiveOn', v_effective_on, 'timing', p_effective_timing, 'reason', v_reason));

  insert into public.notifications(user_id, type, title, message, metadata, is_read)
  select distinct administrator.id, 'membership', 'Membership change requested',
    format('%s requested a change to %s membership.', member.name, v_target.name),
    jsonb_build_object('membershipId', v_membership.id, 'membershipChangeRequestId', v_request_id), false
  from public.users administrator
  join public.user_roles role on role.user_id = administrator.id and role.role = 'admin'
  join public.users member on member.id = v_membership.user_id
  where administrator.is_active;

  return v_request_id;
end;
$$;

create or replace function public.cancel_membership_change_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.membership_change_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to cancel a membership change'; end if;
  select * into v_request from public.membership_change_requests where id = p_request_id for update;
  if not found then raise exception 'Membership change request not found'; end if;
  if v_request.user_id <> auth.uid() and not public.current_user_is_admin() then
    raise exception 'You cannot cancel this membership change request';
  end if;
  if v_request.status not in ('pending', 'approved', 'needs_review') then
    raise exception 'This membership change request can no longer be cancelled';
  end if;
  update public.membership_change_requests
  set status = 'cancelled', decided_at = now(), decided_by = auth.uid(),
      decision_reason = 'Cancelled by user', updated_at = now()
  where id = p_request_id;
  insert into public.membership_status_events(membership_id, user_id, event_type, actor_id, details)
  values (v_request.membership_id, v_request.user_id, 'membership_change_cancelled', auth.uid(),
    jsonb_build_object('requestId', p_request_id));
end;
$$;

create or replace function public.decide_membership_change_request(
  p_request_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.membership_change_requests%rowtype;
  v_target public.membership_classes%rowtype;
  v_date_of_birth date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_applied boolean := false;
  v_final_status text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator MFA verification is required';
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Select approve or reject'; end if;
  if char_length(coalesce(v_reason, '')) < 5 then raise exception 'Enter a decision reason of at least 5 characters'; end if;

  select * into v_request from public.membership_change_requests where id = p_request_id for update;
  if not found then raise exception 'Membership change request not found'; end if;
  if v_request.status not in ('pending', 'needs_review') then
    raise exception 'This membership change request has already been decided';
  end if;

  if p_decision = 'reject' then
    update public.membership_change_requests
    set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
        decision_reason = v_reason, updated_at = now()
    where id = p_request_id;
    insert into public.notifications(user_id, type, title, message, metadata, is_read)
    values (v_request.user_id, 'membership', 'Membership change not approved', v_reason,
      jsonb_build_object('membershipId', v_request.membership_id, 'membershipChangeRequestId', v_request.id), false);
    return jsonb_build_object('status', 'rejected', 'requestId', v_request.id);
  end if;

  select * into v_target from public.membership_classes
  where id = v_request.to_membership_class_id and is_active;
  if not found then raise exception 'The requested membership is no longer available'; end if;
  if v_target.code = 'junior' then
    select date_of_birth into v_date_of_birth from public.users where id = v_request.user_id;
    if v_date_of_birth is null or v_date_of_birth <= (v_request.effective_on - interval '18 years')::date then
      raise exception 'Junior membership is only available while the member is under 18 on the change date';
    end if;
  end if;

  update public.membership_change_requests
  set status = 'approved', decided_at = now(), decided_by = auth.uid(),
      decision_reason = v_reason, updated_at = now()
  where id = p_request_id;

  if v_request.effective_on <= current_date then
    v_applied := private.apply_membership_change_request(v_request.id, auth.uid());
  end if;
  select status into v_final_status from public.membership_change_requests where id = v_request.id;

  if not v_applied and v_final_status = 'approved' then
    insert into public.notifications(user_id, type, title, message, metadata, is_read)
    values (v_request.user_id, 'membership', 'Membership change approved',
      format('Your membership change is scheduled for %s.', to_char(v_request.effective_on, 'DD Mon YYYY')),
      jsonb_build_object('membershipId', v_request.membership_id, 'membershipChangeRequestId', v_request.id), false);
  end if;
  return jsonb_build_object('status', v_final_status, 'requestId', v_request.id, 'applied', v_applied);
end;
$$;

create or replace function public.admin_change_membership(
  p_membership_id uuid,
  p_to_membership_class_code text,
  p_effective_timing text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membership public.club_memberships%rowtype;
  v_target public.membership_classes%rowtype;
  v_effective_on date;
  v_date_of_birth date;
  v_request_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_applied boolean := false;
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator MFA verification is required';
  end if;
  if p_effective_timing not in ('immediate', 'next_renewal') then
    raise exception 'Select when the membership change should take effect';
  end if;
  if char_length(coalesce(v_reason, '')) < 5 then raise exception 'Enter a change reason of at least 5 characters'; end if;

  select * into v_membership from public.club_memberships
  where id = p_membership_id and legal_status = 'current' for update;
  if not found then raise exception 'Only a current membership can be changed'; end if;
  if exists (select 1 from public.membership_change_requests
    where membership_id = v_membership.id and status in ('pending', 'approved', 'needs_review')) then
    raise exception 'This membership already has an open change request';
  end if;

  select * into v_target from public.membership_classes
  where code = lower(btrim(p_to_membership_class_code)) and is_active;
  if not found then raise exception 'Select an available membership'; end if;
  if v_target.id = v_membership.membership_class_id then raise exception 'Select a different membership'; end if;

  if p_effective_timing = 'immediate' then v_effective_on := current_date;
  else
    select financial_year_end + 1 into v_effective_on
    from public.membership_financial_year_bounds(current_date);
  end if;
  if v_target.code = 'junior' then
    select date_of_birth into v_date_of_birth from public.users where id = v_membership.user_id;
    if v_date_of_birth is null or v_date_of_birth <= (v_effective_on - interval '18 years')::date then
      raise exception 'Junior membership is only available while the member is under 18 on the change date';
    end if;
  end if;

  insert into public.membership_change_requests(
    membership_id, user_id, from_membership_class_id, to_membership_class_id,
    status, requested_effective_timing, effective_on, request_reason,
    requested_by, decided_at, decided_by, decision_reason
  ) values (
    v_membership.id, v_membership.user_id, v_membership.membership_class_id, v_target.id,
    'approved', p_effective_timing, v_effective_on, v_reason,
    auth.uid(), now(), auth.uid(), v_reason
  ) returning id into v_request_id;

  insert into public.membership_status_events(membership_id, user_id, event_type, actor_id, details)
  values (v_membership.id, v_membership.user_id, 'membership_change_approved', auth.uid(),
    jsonb_build_object('requestId', v_request_id, 'toClass', v_target.code,
      'effectiveOn', v_effective_on, 'timing', p_effective_timing, 'reason', v_reason));

  if v_effective_on <= current_date then
    v_applied := private.apply_membership_change_request(v_request_id, auth.uid());
  else
    insert into public.notifications(user_id, type, title, message, metadata, is_read)
    values (v_membership.user_id, 'membership', 'Membership change scheduled',
      format('Your membership will change to %s on %s.', v_target.name, to_char(v_effective_on, 'DD Mon YYYY')),
      jsonb_build_object('membershipId', v_membership.id, 'membershipChangeRequestId', v_request_id), false);
  end if;
  return jsonb_build_object('requestId', v_request_id, 'effectiveOn', v_effective_on, 'applied', v_applied);
end;
$$;

create or replace function public.process_due_membership_changes(p_as_of date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request record;
  v_applied integer := 0;
  v_needs_review integer := 0;
begin
  if auth.uid() is not null and not public.current_user_is_admin() then
    raise exception 'Administrator MFA verification is required';
  end if;
  for v_request in
    select id from public.membership_change_requests
    where status = 'approved' and effective_on <= p_as_of
    order by effective_on, submitted_at
    for update skip locked
  loop
    begin
      if private.apply_membership_change_request(v_request.id, auth.uid()) then
        v_applied := v_applied + 1;
      else
        v_needs_review := v_needs_review + 1;
      end if;
    exception when others then
      update public.membership_change_requests
      set status = 'needs_review',
          decision_reason = concat_ws(' ', nullif(decision_reason, ''), sqlerrm),
          updated_at = now()
      where id = v_request.id;
      v_needs_review := v_needs_review + 1;
    end;
  end loop;
  return jsonb_build_object('applied', v_applied, 'needsReview', v_needs_review, 'processedAsOf', p_as_of);
end;
$$;

revoke all on function public.request_membership_change(text, text, text) from public, anon;
grant execute on function public.request_membership_change(text, text, text) to authenticated, service_role;
revoke all on function public.cancel_membership_change_request(uuid) from public, anon;
grant execute on function public.cancel_membership_change_request(uuid) to authenticated, service_role;
revoke all on function public.decide_membership_change_request(uuid, text, text) from public, anon;
grant execute on function public.decide_membership_change_request(uuid, text, text) to authenticated, service_role;
revoke all on function public.admin_change_membership(uuid, text, text, text) from public, anon;
grant execute on function public.admin_change_membership(uuid, text, text, text) to authenticated, service_role;
revoke all on function public.process_due_membership_changes(date) from public, anon;
grant execute on function public.process_due_membership_changes(date) to authenticated, service_role;

insert into private.function_permission_manifest(
  signature, function_name, classification, allowed_roles, security_definer,
  fixed_search_path, rationale, reviewed_at
) values
  (
    'public.request_membership_change(p_to_membership_class_code text, p_effective_timing text, p_reason text)',
    'request_membership_change', 'authenticated_self_service',
    array['authenticated', 'service_role']::text[], true, true,
    'A current member may request a class change only for their own membership; the function validates class and age eligibility.',
    date '2026-08-16'
  ),
  (
    'public.cancel_membership_change_request(p_request_id uuid)',
    'cancel_membership_change_request', 'authenticated_self_service',
    array['authenticated', 'service_role']::text[], true, true,
    'A member may cancel only their own open request; administrators retain audited support access.',
    date '2026-08-16'
  ),
  (
    'public.decide_membership_change_request(p_request_id uuid, p_decision text, p_reason text)',
    'decide_membership_change_request', 'staff_aal2',
    array['authenticated', 'service_role']::text[], true, true,
    'Administrator decision with MFA, eligibility revalidation, audit event and safe financial boundaries.',
    date '2026-08-16'
  ),
  (
    'public.admin_change_membership(p_membership_id uuid, p_to_membership_class_code text, p_effective_timing text, p_reason text)',
    'admin_change_membership', 'staff_aal2',
    array['authenticated', 'service_role']::text[], true, true,
    'Administrator-initiated membership change with MFA, audit history and no silent rewrite of issued charges.',
    date '2026-08-16'
  ),
  (
    'public.process_due_membership_changes(p_as_of date)',
    'process_due_membership_changes', 'staff_aal2',
    array['authenticated', 'service_role']::text[], true, true,
    'Daily service or MFA-verified administrator processing of approved scheduled membership changes.',
    date '2026-08-16'
  )
on conflict(signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for v_job_id in select jobid from cron.job where jobname = 'process-bfc-membership-changes'
    loop perform cron.unschedule(v_job_id); end loop;
    perform cron.schedule(
      'process-bfc-membership-changes',
      '0 2 * * *',
      'select public.process_due_membership_changes(current_date);'
    );
  end if;
end;
$$;

select private.assert_function_permission_manifest();

comment on table public.membership_change_requests is
  'Auditable requested, approved, scheduled and applied BFC membership-class changes.';
