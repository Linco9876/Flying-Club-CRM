-- Configurable membership products, permissions and Xero revenue mappings.

alter table public.membership_classes
  drop constraint if exists membership_classes_code_check;

alter table public.membership_classes
  add column if not exists description text not null default '',
  add column if not exists can_self_book_aircraft boolean not null default true,
  add column if not exists xero_item_code text,
  add column if not exists xero_account_code text;

alter table public.membership_classes
  drop constraint if exists membership_classes_code_format_check,
  add constraint membership_classes_code_format_check
    check (code ~ '^[a-z0-9][a-z0-9_-]{1,49}$'),
  drop constraint if exists membership_classes_name_check,
  add constraint membership_classes_name_check
    check (char_length(btrim(name)) between 2 and 100);

alter table public.membership_settings
  add column if not exists scholarship_contribution_available boolean not null default true,
  add column if not exists scholarship_default_amount numeric(10,2) not null default 5,
  add column if not exists scholarship_minimum_amount numeric(10,2) not null default 0.01,
  add column if not exists xero_scholarship_account_code text;

alter table public.membership_settings
  drop constraint if exists membership_settings_scholarship_default_check,
  add constraint membership_settings_scholarship_default_check
    check (scholarship_default_amount >= 0.01),
  drop constraint if exists membership_settings_scholarship_minimum_check,
  add constraint membership_settings_scholarship_minimum_check
    check (scholarship_minimum_amount >= 0.01),
  drop constraint if exists membership_settings_scholarship_amount_order_check,
  add constraint membership_settings_scholarship_amount_order_check
    check (scholarship_default_amount >= scholarship_minimum_amount);

update public.membership_classes membership_class
set
  xero_item_code = coalesce(
    nullif(btrim(membership_class.xero_item_code), ''),
    nullif(btrim(settings.xero_membership_item_code), ''),
    'BFC-MEMBERSHIP'
  ),
  xero_account_code = coalesce(
    nullif(btrim(membership_class.xero_account_code), ''),
    nullif(btrim(xero_settings.revenue_account_code), '')
  ),
  description = case membership_class.code
    when 'full' then 'Voting membership'
    when 'junior' then 'Membership for applicants under 18'
    when 'affiliate' then 'Non-voting affiliate membership'
    when 'life' then 'Fee-exempt life membership awarded by the club'
    else membership_class.description
  end
from public.membership_settings settings
left join public.xero_sync_settings xero_settings on xero_settings.id = true
where settings.id = true;

update public.membership_settings settings
set
  xero_scholarship_item_code = coalesce(
    nullif(btrim(settings.xero_scholarship_item_code), ''),
    'BFC-SCHOLARSHIP'
  ),
  xero_scholarship_account_code = coalesce(
    nullif(btrim(settings.xero_scholarship_account_code), ''),
    nullif(btrim(xero_settings.revenue_account_code), '')
  )
from public.xero_sync_settings xero_settings
where settings.id = true
  and xero_settings.id = true;

create or replace function public.get_public_membership_configuration()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'classes',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', class.code,
          'name', class.name,
          'description', class.description,
          'annualFee', class.annual_fee,
          'hasVotingRights', class.has_voting_rights,
          'canSelfBookAircraft', class.can_self_book_aircraft
        )
        order by class.sort_order, class.name
      )
      from public.membership_classes class
      where class.is_active
        and class.code <> 'life'
    ), '[]'::jsonb),
    'scholarship',
    jsonb_build_object(
      'available', settings.scholarship_contribution_available,
      'defaultAmount', settings.scholarship_default_amount,
      'minimumAmount', settings.scholarship_minimum_amount
    )
  )
  from public.membership_settings settings
  where settings.id = true;
$$;

revoke all on function public.get_public_membership_configuration() from public;
grant execute on function public.get_public_membership_configuration() to anon, authenticated, service_role;

create or replace function public.save_membership_products(p_products jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product jsonb;
  v_id uuid;
  v_code text;
  v_name text;
  v_fee numeric;
  v_saved integer := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator access is required';
  end if;
  if jsonb_typeof(p_products) <> 'array'
     or jsonb_array_length(p_products) < 1
     or jsonb_array_length(p_products) > 50 then
    raise exception 'Provide between 1 and 50 membership products';
  end if;

  if exists (
    select 1
    from (
      select lower(btrim(product->>'code')) as code, count(*) as occurrences
      from jsonb_array_elements(p_products) as products(product)
      group by lower(btrim(product->>'code'))
    ) duplicates
    where duplicates.code = '' or duplicates.occurrences > 1
  ) then
    raise exception 'Membership product codes must be present and unique';
  end if;

  for v_product in select value from jsonb_array_elements(p_products)
  loop
    v_code := lower(btrim(coalesce(v_product->>'code', '')));
    v_name := btrim(coalesce(v_product->>'name', ''));
    v_fee := coalesce((v_product->>'annualFee')::numeric, 0);
    v_id := case
      when coalesce(v_product->>'id', '') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        then (v_product->>'id')::uuid
      else null
    end;

    if v_code !~ '^[a-z0-9][a-z0-9_-]{1,49}$' then
      raise exception 'Invalid membership product code: %', v_code;
    end if;
    if char_length(v_name) < 2 then
      raise exception 'Every membership product needs a name';
    end if;
    if v_fee < 0 then
      raise exception 'Membership fees cannot be negative';
    end if;

    if v_id is not null and exists (
      select 1 from public.membership_classes where id = v_id
    ) then
      update public.membership_classes
      set
        name = v_name,
        description = btrim(coalesce(v_product->>'description', '')),
        annual_fee = case
          when coalesce((v_product->>'isFeeExempt')::boolean, false) then 0
          else v_fee
        end,
        has_voting_rights = coalesce((v_product->>'hasVotingRights')::boolean, false),
        can_self_book_aircraft = coalesce((v_product->>'canSelfBookAircraft')::boolean, false),
        is_fee_exempt = coalesce((v_product->>'isFeeExempt')::boolean, false),
        is_active = coalesce((v_product->>'isActive')::boolean, false),
        sort_order = coalesce((v_product->>'sortOrder')::integer, v_saved + 1),
        xero_item_code = nullif(upper(btrim(coalesce(v_product->>'xeroItemCode', ''))), ''),
        xero_account_code = nullif(upper(btrim(coalesce(v_product->>'xeroAccountCode', ''))), ''),
        updated_at = now()
      where id = v_id;
    else
      insert into public.membership_classes (
        code, name, description, annual_fee, has_voting_rights,
        can_self_book_aircraft, is_fee_exempt, is_active, sort_order,
        xero_item_code, xero_account_code
      ) values (
        v_code,
        v_name,
        btrim(coalesce(v_product->>'description', '')),
        case when coalesce((v_product->>'isFeeExempt')::boolean, false) then 0 else v_fee end,
        coalesce((v_product->>'hasVotingRights')::boolean, false),
        coalesce((v_product->>'canSelfBookAircraft')::boolean, false),
        coalesce((v_product->>'isFeeExempt')::boolean, false),
        coalesce((v_product->>'isActive')::boolean, false),
        coalesce((v_product->>'sortOrder')::integer, v_saved + 1),
        nullif(upper(btrim(coalesce(v_product->>'xeroItemCode', ''))), ''),
        nullif(upper(btrim(coalesce(v_product->>'xeroAccountCode', ''))), '')
      );
    end if;
    v_saved := v_saved + 1;
  end loop;

  return v_saved;
end;
$$;

revoke all on function public.save_membership_products(jsonb) from public, anon;
grant execute on function public.save_membership_products(jsonb) to authenticated, service_role;

create or replace function public.apply_membership_scholarship_contribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_preference public.membership_payment_preferences%rowtype;
  v_settings public.membership_settings%rowtype;
  v_has_preference boolean := false;
begin
  select user_id into v_user_id
  from public.club_memberships
  where id = new.membership_id;

  select * into v_preference
  from public.membership_payment_preferences
  where user_id = v_user_id;
  v_has_preference := found;

  select * into v_settings
  from public.membership_settings
  where id = true;

  new.membership_fee_amount := greatest(
    coalesce(new.membership_fee_amount, new.amount_due, 0),
    0
  );
  new.scholarship_contribution_amount := case
    when coalesce(v_settings.scholarship_contribution_available, true)
      and v_has_preference
      and v_preference.scholarship_contribution_enabled
      and v_preference.scholarship_contribution_amount >=
        coalesce(v_settings.scholarship_minimum_amount, 0.01)
      then greatest(coalesce(v_preference.scholarship_contribution_amount, 0), 0)
    else 0
  end;
  new.amount_due := round(
    new.membership_fee_amount + new.scholarship_contribution_amount,
    2
  );
  return new;
end;
$$;

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

      if not found then
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

comment on column public.membership_classes.can_self_book_aircraft is
  'Whether a financially cleared member in this class may create their own aircraft booking.';
comment on column public.membership_classes.xero_item_code is
  'Optional Xero sales item code for this membership product.';
comment on column public.membership_classes.xero_account_code is
  'Optional Xero revenue account code for this membership product.';
comment on column public.membership_settings.scholarship_contribution_available is
  'Whether members are offered an optional scholarship contribution.';
comment on column public.membership_settings.xero_scholarship_account_code is
  'Optional Xero revenue account code for scholarship contribution invoice lines.';
