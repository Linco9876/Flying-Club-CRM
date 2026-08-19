-- Audited administrator controls for ending and reinstating legal club memberships.
-- Accounting history is deliberately preserved: existing invoices, payments and
-- waivers are never rewritten by a legal-status change.

create or replace function public.admin_update_membership_status(
  p_membership_id uuid,
  p_legal_status text,
  p_reason text,
  p_membership_class_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membership public.club_memberships%rowtype;
  v_target_class public.membership_classes%rowtype;
  v_previous_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target_code text := nullif(lower(btrim(coalesce(p_membership_class_code, ''))), '');
  v_fy_start date;
  v_fy_end date;
  v_amount numeric(10,2);
  v_scholarship_amount numeric(10,2) := 0;
  v_now timestamptz := now();
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator MFA verification is required';
  end if;
  if p_legal_status not in ('current', 'ceased_non_payment', 'resigned', 'expelled', 'deceased') then
    raise exception 'Select a valid membership status';
  end if;
  if char_length(coalesce(v_reason, '')) < 10 then
    raise exception 'Enter a status-change reason of at least 10 characters';
  end if;

  select * into v_membership
  from public.club_memberships
  where id = p_membership_id
  for update;
  if not found then raise exception 'Membership record not found'; end if;

  v_previous_status := v_membership.legal_status;
  if v_previous_status = p_legal_status then
    raise exception 'The membership already has this status';
  end if;

  if p_legal_status = 'current' then
    if v_target_code is null then
      select * into v_target_class
      from public.membership_classes
      where id = v_membership.membership_class_id and is_active;
    else
      select * into v_target_class
      from public.membership_classes
      where code = v_target_code and is_active;
    end if;
    if not found then
      raise exception 'Select an active membership class before restoring this membership';
    end if;

    -- Updating membership_class_id intentionally invokes the central Full/Junior
    -- age-eligibility trigger, including when the class remains unchanged.
    update public.club_memberships
    set membership_class_id = v_target_class.id,
        legal_status = 'current',
        commenced_at = v_now,
        commencement_method = 'reinstatement',
        ended_at = null,
        end_reason = null,
        updated_at = v_now
    where id = v_membership.id;

    select financial_year_start, financial_year_end
      into v_fy_start, v_fy_end
    from public.membership_financial_year_bounds(current_date);
    v_amount := case
      when v_target_class.is_fee_exempt then 0
      else public.membership_period_amount(v_target_class.id, current_date)
    end;
    select case
      when scholarship_contribution_enabled then scholarship_contribution_amount
      else 0
    end into v_scholarship_amount
    from public.membership_payment_preferences
    where user_id = v_membership.user_id;
    v_scholarship_amount := coalesce(v_scholarship_amount, 0);

    insert into public.membership_financial_periods as current_period(
      membership_id,
      financial_year_start,
      financial_year_end,
      standard_fee,
      membership_fee_amount,
      scholarship_contribution_amount,
      amount_due,
      fee_disposition,
      due_date,
      grace_expires_at,
      financially_cleared_at
    ) values (
      v_membership.id,
      v_fy_start,
      v_fy_end,
      v_target_class.annual_fee,
      v_amount,
      v_scholarship_amount,
      v_amount + v_scholarship_amount,
      case
        when v_target_class.is_fee_exempt and v_scholarship_amount <= 0 then 'fee_exempt'
        else 'invoice_required'
      end,
      current_date,
      current_date::timestamptz
        + (select non_payment_grace_days from public.membership_settings where id = true) * interval '1 day',
      case
        when v_target_class.is_fee_exempt and v_scholarship_amount <= 0 then v_now
        else null
      end
    )
    on conflict (membership_id, financial_year_start) do update
    set standard_fee = excluded.standard_fee,
        membership_fee_amount = excluded.membership_fee_amount,
        scholarship_contribution_amount = excluded.scholarship_contribution_amount,
        amount_due = excluded.amount_due,
        fee_disposition = excluded.fee_disposition,
        due_date = excluded.due_date,
        grace_expires_at = excluded.grace_expires_at,
        financially_cleared_at = excluded.financially_cleared_at,
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
        updated_at = v_now
    where current_period.fee_disposition in ('ceased', 'invoice_required')
      and current_period.xero_invoice_id is null
      and current_period.billing_sync_status is null;

    update public.membership_payment_preferences
    set cancelled_at = null,
        updated_at = v_now
    where user_id = v_membership.user_id;

    insert into public.notifications(user_id, type, title, message, metadata, is_read)
    values (
      v_membership.user_id,
      'membership',
      'BFC membership restored',
      format('Your %s membership is current again.', v_target_class.name),
      jsonb_build_object('membershipId', v_membership.id),
      false
    );
  else
    update public.club_memberships
    set legal_status = p_legal_status,
        ended_at = coalesce(ended_at, v_now),
        end_reason = v_reason,
        updated_at = v_now
    where id = v_membership.id;

    -- Stop future automatic collections. Existing invoices and cleared periods
    -- stay unchanged so the accounting record remains truthful and reviewable.
    update public.membership_payment_preferences
    set auto_renew = false,
        cancelled_at = coalesce(cancelled_at, v_now),
        updated_at = v_now
    where user_id = v_membership.user_id;

    update public.membership_change_requests
    set status = 'cancelled',
        decision_reason = concat_ws(' ', nullif(decision_reason, ''),
          format('Cancelled because membership status changed to %s: %s', p_legal_status, v_reason)),
        updated_at = v_now
    where membership_id = v_membership.id
      and status in ('pending', 'approved', 'needs_review');

    if p_legal_status <> 'deceased' then
      insert into public.notifications(user_id, type, title, message, metadata, is_read)
      values (
        v_membership.user_id,
        'membership',
        'BFC membership status updated',
        format('Your membership status is now %s. Contact the club if you need help.', replace(p_legal_status, '_', ' ')),
        jsonb_build_object('membershipId', v_membership.id, 'legalStatus', p_legal_status),
        false
      );
    end if;
  end if;

  insert into public.membership_status_events(
    membership_id,
    user_id,
    event_type,
    actor_id,
    details
  ) values (
    v_membership.id,
    v_membership.user_id,
    case when p_legal_status = 'current' then 'membership_reinstated' else 'membership_ended' end,
    auth.uid(),
    jsonb_build_object(
      'from', v_previous_status,
      'to', p_legal_status,
      'reason', v_reason,
      'membershipClassCode', case when p_legal_status = 'current' then v_target_class.code else null end,
      'accountingHistoryPreserved', true
    )
  );

  return jsonb_build_object(
    'membershipId', v_membership.id,
    'previousStatus', v_previous_status,
    'legalStatus', p_legal_status,
    'membershipClassCode', case when p_legal_status = 'current' then v_target_class.code else null end
  );
end;
$$;

revoke all on function public.admin_update_membership_status(uuid, text, text, text)
from public, anon;
grant execute on function public.admin_update_membership_status(uuid, text, text, text)
to authenticated, service_role;

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
  'public.admin_update_membership_status(p_membership_id uuid, p_legal_status text, p_reason text, p_membership_class_code text)',
  'admin_update_membership_status',
  'staff_aal2',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'MFA-protected administrator legal-status control with class eligibility enforcement, audit history and accounting preservation.',
  date '2026-08-18'
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
