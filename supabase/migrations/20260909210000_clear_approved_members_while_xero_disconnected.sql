create or replace function public.assess_member_booking_eligibility(
  p_user_id uuid,
  p_booking_start timestamptz,
  p_is_guest boolean default false,
  p_has_aircraft boolean default true
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
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
    return jsonb_build_object(
      'eligible', true, 'reasonCode', 'guest_booking',
      'message', 'Guest bookings do not require BFC membership.',
      'isGuest', true, 'rolloutMode', v_settings.rollout_mode,
      'staffOverrideAllowed', false, 'blocked', false
    );
  end if;
  if not coalesce(p_has_aircraft, true) then
    return jsonb_build_object(
      'eligible', true, 'reasonCode', 'no_aircraft',
      'message', 'This booking does not reserve an aircraft.',
      'isGuest', false, 'rolloutMode', v_settings.rollout_mode,
      'staffOverrideAllowed', false, 'blocked', false
    );
  end if;

  select * into v_membership
  from public.club_memberships
  where user_id = p_user_id;

  if not found then
    v_code := 'no_bfc_membership';
    v_reason := 'This person does not have a current BFC membership record.';
  elsif v_membership.legal_status <> 'current' then
    v_code := 'membership_not_current';
    v_reason := format(
      'BFC membership status is %s.',
      replace(v_membership.legal_status, '_', ' ')
    );
  else
    select * into v_class
    from public.membership_classes
    where id = v_membership.membership_class_id;

    if not coalesce(v_class.can_self_book_aircraft, true) then
      v_code := 'membership_class_no_self_booking';
      v_reason := format(
        '%s membership does not include aircraft self-booking.',
        v_class.name
      );
    else
      select p.* into v_period
      from public.membership_financial_periods p
      where p.membership_id = v_membership.id
        and p_booking_start::date between p.financial_year_start and p.financial_year_end
      order by p.financial_year_start desc
      limit 1;

      -- Approval clears booking access while accounting is explicitly disconnected.
      -- Preserve invoice/payment facts and resume fee checks on reconnection.
      if not exists (
        select 1 from public.xero_connection_settings x
        where x.id is true
          and nullif(btrim(x.tenant_id), '') is not null
          and x.disconnected_at is null
          and x.connection_mode <> 'disconnected'
      ) then
        v_eligible := true;
        v_code := 'membership_approved_xero_disconnected';
        v_reason := 'Membership is current. Payment confirmation is not required while Xero is disconnected.';
      elsif v_period.id is null then
        v_code := 'financial_period_missing';
        v_reason := 'No membership fee record exists for the booking financial year.';
      elsif v_period.fee_disposition in ('paid', 'waived', 'fee_exempt') then
        v_eligible := true;
        v_code := 'financially_cleared';
        v_reason := case v_period.fee_disposition
          when 'waived' then 'The membership fee is waived for this financial year.'
          when 'fee_exempt' then 'This membership class is fee exempt.'
          else 'The membership fee is paid.'
        end;
      else
        v_code := 'membership_fee_not_cleared';
        v_reason := format(
          'BFC membership remains current, but the fee status is %s. Aircraft self-booking is unavailable until financially cleared.',
          replace(v_period.fee_disposition, '_', ' ')
        );
      end if;
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
    'requiresStaffOverride',
      (not v_eligible and v_is_staff and v_settings.rollout_mode in ('staff_warning', 'enforced')),
    'blocked',
      (not v_eligible and not v_is_staff and v_settings.rollout_mode = 'enforced')
  );
end;
$$;

select private.assert_function_permission_manifest();
