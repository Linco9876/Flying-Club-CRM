-- Attach paid 2026-27 memberships to the dormant portal profiles created from the paid-member register.
-- The source uses UUIDs only so member PII is not copied into source control.
-- Account provisioning is intentionally separate because Supabase Auth users must be created through the Auth Admin API.

create temporary table paid_member_profile_memberships_2026_27 (
  user_id uuid primary key,
  membership_class_code text not null,
  commenced_at date not null
) on commit drop;

insert into paid_member_profile_memberships_2026_27 (user_id, membership_class_code, commenced_at)
values
  ('050ebf6a-cbdf-431a-b96b-5d16a2a91c99', 'full', date '2026-07-01'),
  ('0596e0a7-338c-4d25-8b78-c6a839d4ed76', 'full', date '2026-07-01'),
  ('0772fe2f-b2a8-43a8-bfb9-c024381a216f', 'full', date '2026-07-01'),
  ('07f4d137-be70-490c-aba1-343d360eff46', 'full', date '2026-07-01'),
  ('09cf3cb7-51f2-42e5-953e-4056da935a15', 'full', date '2026-07-01'),
  ('0a124fd0-e23b-4cc2-a9ab-38b5fbebcb3f', 'full', date '2026-07-01'),
  ('0c87cc35-b59e-4c38-bba0-a4c4c56492e4', 'full', date '2026-07-01'),
  ('0e43e23c-cf78-4fc9-8744-ce3574d916fd', 'full', date '2026-07-01'),
  ('0f08b56f-fe86-44d3-ad39-b7f9dc35c580', 'full', date '2026-07-01'),
  ('10004e0e-053f-499d-98e6-d8398a3b33c0', 'full', date '2026-07-01'),
  ('102bb9f2-7c61-4846-99eb-22fdbbc6ddb4', 'full', date '2026-07-01'),
  ('10a3fd95-63a2-4547-80ec-8e29598394d4', 'full', date '2026-07-01'),
  ('1659b19f-fbf8-4322-b70b-07d532b5d1d4', 'full', date '2026-07-01'),
  ('1bc6a386-ce5a-4a4d-bdcd-a70323af0842', 'full', date '2026-07-01'),
  ('1ed5ceae-2903-42c7-ab8b-cfcf38db4b85', 'full', date '2026-07-01'),
  ('20954560-f6bd-468b-ab5c-67726baa5ab5', 'full', date '2026-07-01'),
  ('2626b647-fa62-4bf7-b98a-b418c95b5bc3', 'affiliate', date '2026-07-01'),
  ('28893692-39a1-48f0-a51a-eef7e251fad4', 'full', date '2026-07-01'),
  ('28d59efa-9e04-4c14-8662-405f79af1c0f', 'full', date '2026-07-01'),
  ('2bbd87da-09e2-4480-bb0b-dd396308a676', 'full', date '2026-07-01'),
  ('2e645a44-2564-4c1a-835e-8fefee9d9517', 'full', date '2026-07-01'),
  ('2e9dcd4d-c6ee-47e9-84a7-483e841b49e1', 'full', date '2026-07-01'),
  ('2fb9cee6-37f8-4990-8756-2f1c41f7fdd1', 'full', date '2026-07-01'),
  ('30dc6d82-e7e5-4066-b930-7109fd1400ce', 'full', date '2026-07-01'),
  ('338e3224-8453-44b6-bfa6-1a2d37b26664', 'affiliate', date '2026-07-01'),
  ('3a5c528d-454d-438a-befe-84c269093e25', 'full', date '2026-07-01'),
  ('3a92f46d-0c22-420b-8aaf-7ffcd4dc7018', 'full', date '2026-07-01'),
  ('3f030026-99fb-41c8-8290-a4eca7ed5ae3', 'full', date '2026-07-01'),
  ('44ef0a38-6f7d-4dfb-ac36-fbd0b1dff748', 'full', date '2026-07-01'),
  ('4652440d-c660-41c7-83c2-aba3f50e1773', 'full', date '2026-07-01'),
  ('4734684d-1807-496a-ba99-cb14373712af', 'full', date '2026-07-01'),
  ('478dc949-78ae-40d1-b7ec-bc85cb209c99', 'full', date '2026-07-01'),
  ('4a8c2a8d-9af9-4658-ab85-7e6d415f855e', 'full', date '2026-07-01'),
  ('4e5341ed-c15f-4a2e-9358-c143fc11a538', 'full', date '2026-07-01'),
  ('4fcf6b39-cd70-4a6a-b6c7-5f52f1feabac', 'full', date '2026-07-01'),
  ('5251b002-8c22-45e3-93e2-9ef9c7a756aa', 'full', date '2026-07-01'),
  ('5349f07c-e8db-420c-b417-ae2e84f3db9a', 'full', date '2026-07-01'),
  ('534a9d03-6d23-4832-9047-736271567148', 'full', date '2026-07-01'),
  ('544725c2-6a66-46d5-80bb-4a164751a9ad', 'full', date '2026-07-01'),
  ('5521760e-de4d-4882-b124-a1f0d159e6f0', 'full', date '2026-07-01'),
  ('55775ac1-aca6-474a-a4f5-609d29317228', 'full', date '2026-07-01'),
  ('59cc5ac3-7208-40b5-ac0f-2be683f8c839', 'full', date '2026-07-01'),
  ('5e500c1a-bfd4-4449-a801-44c972ea0df5', 'full', date '2026-07-01'),
  ('5e60ca53-1fea-41e9-9b75-9535496f224e', 'full', date '2026-07-01'),
  ('5eb2c74d-4e85-4845-b237-7502d0ba9303', 'full', date '2026-07-01'),
  ('5f492bde-0a67-4453-86dd-775129530ac8', 'full', date '2026-07-01'),
  ('61cff0fa-1dfc-4571-a276-b4e6788458d0', 'full', date '2026-07-01'),
  ('6270cee6-92e4-431f-8a5c-08bf4fefe6bb', 'full', date '2026-07-01'),
  ('67eeb804-593f-4546-abb1-d0d3f80ac55d', 'full', date '2026-07-01'),
  ('68c1da33-583f-4935-9803-0b5cfa80bcfd', 'full', date '2026-07-01'),
  ('69cfc902-0205-40ec-bf4c-7a569090f551', 'full', date '2026-07-01'),
  ('6c71c61a-3acc-4dfd-bb37-7e2dfb58a655', 'junior', date '2026-07-01'),
  ('6d505f66-b137-43a5-83c2-94052b1a5c1c', 'full', date '2026-07-01'),
  ('70661f84-7fc9-45eb-aa5c-7a1fe6d53f77', 'full', date '2026-07-01'),
  ('72831151-82ee-441b-868d-a973cac821f7', 'full', date '2026-07-01'),
  ('7287cd38-1a16-4860-be65-2b2f8ee2a221', 'full', date '2026-07-01'),
  ('744428cb-9b21-41f4-a2bd-61532f63e0db', 'full', date '2026-07-01'),
  ('76a20658-5eb1-45d9-8fb9-772d4659ac4f', 'full', date '2026-07-01'),
  ('77df9be2-2e51-49a5-927e-856d8c333ddc', 'full', date '2026-07-01'),
  ('780b3ba8-0637-40da-9dfd-4967786bb11b', 'full', date '2026-07-01'),
  ('784594c9-d556-45d2-8b68-8169e526df44', 'full', date '2026-07-01'),
  ('7a9c5c8d-6293-48b2-89a2-fe0374962eee', 'full', date '2026-07-01'),
  ('7f0f7cbb-c26c-42bd-ac33-19a9617229f2', 'full', date '2026-07-01'),
  ('8c156255-9285-45be-9835-678b182f0fc3', 'full', date '2026-07-01'),
  ('8fb456ce-6563-4f87-9fe4-fe34a57c5c78', 'full', date '2026-07-01'),
  ('94e4a33a-b0ac-43ee-a916-766571f5f588', 'full', date '2026-07-01'),
  ('95e7ca1a-83f3-4d77-a1a7-301c92746413', 'affiliate', date '2026-07-01'),
  ('96cba2b9-6b07-4085-a7ae-8a1985ac8d9c', 'full', date '2026-07-01'),
  ('9a05c4f6-33fe-41ca-97cd-6e8aa62314c2', 'full', date '2026-07-01'),
  ('9dd8e073-1990-4354-90b7-57316bd1e47f', 'full', date '2026-07-01'),
  ('9ef047a8-b21f-42d6-8d88-90069a3c2246', 'full', date '2026-07-01'),
  ('9f354e6c-a339-4765-8f15-dbd6f291b75f', 'affiliate', date '2026-07-01'),
  ('a16cc068-4720-4693-82b0-ee80b96ca37f', 'affiliate', date '2026-07-01'),
  ('a31ea082-8965-441a-b85e-6605f3675976', 'full', date '2026-07-01'),
  ('a9aca80c-74ba-4a4d-a286-6213b989041e', 'full', date '2026-07-01'),
  ('b17daeee-f119-4d26-8df6-5220baf48dd2', 'full', date '2026-07-01'),
  ('b219b40f-6408-4c7b-98e8-befbd3a5a64f', 'full', date '2026-07-01'),
  ('b28484f4-c34c-4525-b0b9-dc56d469b6db', 'full', date '2026-07-01'),
  ('b3e717cd-eaaa-42b5-bcf9-54ab81fe1051', 'full', date '2026-07-01'),
  ('b40cb5da-f2e3-448d-bd7a-0775422047cf', 'full', date '2026-07-01'),
  ('b5f5864e-0d4f-4da3-872e-c16bcf687460', 'full', date '2026-07-01'),
  ('bd5f4456-a583-44e7-adb0-1ea2169c573a', 'full', date '2026-07-01'),
  ('bdafa1c3-46d7-49e1-81d7-0aad77da2192', 'full', date '2026-07-01'),
  ('be97dd94-1703-42f8-8a3d-4d18af06d66e', 'full', date '2026-07-01'),
  ('c245f8c0-be6a-4370-a8ed-cf3a5256c40a', 'full', date '2026-07-01'),
  ('cceb228b-9a22-4cd4-aa4d-ad2e40dbe3a7', 'full', date '2026-07-01'),
  ('cfc57367-e12a-446f-98bd-1c15b3304611', 'full', date '2026-07-01'),
  ('d1ed5765-a718-424a-9749-6fb8233f6440', 'full', date '2026-07-01'),
  ('d1f80793-fbd6-4acb-bab3-f66af7a3f148', 'full', date '2026-07-01'),
  ('d32faa9f-a6d5-4e10-8be7-6c69778f08ce', 'full', date '2026-07-01'),
  ('d39c2349-bb83-4a03-a536-c75dfe9c0507', 'full', date '2026-07-01'),
  ('d5f3d6db-2e81-4bc8-bd11-599a33456647', 'full', date '2026-07-01'),
  ('d69bc3a9-cdb9-4f42-a3d2-2fb3170ea2cd', 'affiliate', date '2026-07-01'),
  ('dd37fed7-3f7c-4c97-a804-bb009e559c51', 'full', date '2026-07-01'),
  ('dd72c3bd-0367-43a2-80b8-120c52aea092', 'affiliate', date '2026-07-01'),
  ('e07a3f5f-e8eb-4379-9e83-36af4d32e903', 'full', date '2026-07-01'),
  ('e15c294f-e0be-49df-a195-7a3f863a4792', 'full', date '2026-07-01'),
  ('f087c933-f3dc-4e7d-82e2-64b92aa36d78', 'full', date '2026-07-01'),
  ('f0a916cf-90e6-4b10-8c19-ec4a272cee25', 'full', date '2026-07-01'),
  ('f444a4ee-b88d-4ba1-b11c-7a9fd26d9402', 'full', date '2026-07-01'),
  ('f44aa15a-7118-4914-be23-08252b6b700c', 'full', date '2026-07-01'),
  ('f673df3b-6a45-48e5-92b8-6a7d49e45980', 'full', date '2026-07-01'),
  ('fa06437c-5227-4527-995b-b6ad2804ad61', 'full', date '2026-07-01'),
  ('fa435e49-7533-4076-8fae-b903308fdf03', 'full', date '2026-07-01'),
  ('fb96fb21-a2bd-4067-bb9f-4a377e86efd2', 'full', date '2026-07-01'),
  ('fc346645-6191-4c76-90a8-8575e5fbf7ec', 'full', date '2026-07-01'),
  ('ff52ec1b-2244-4384-bbf6-74441e3e5378', 'full', date '2026-07-01');

do $$
declare
  expected_count constant integer := 107;
  actual_count integer;
begin
  select count(*) into actual_count from paid_member_profile_memberships_2026_27;
  if actual_count <> expected_count then
    raise exception 'Paid-member profile membership import expected % rows, found %', expected_count, actual_count;
  end if;

  select count(*) into actual_count
  from paid_member_profile_memberships_2026_27 source
  join public.users portal_user
    on portal_user.id = source.user_id
   and coalesce(portal_user.portal_access_scope, 'full') = 'full';
  if actual_count <> expected_count then
    raise exception 'Paid-member profile membership import contains a missing or restricted portal profile';
  end if;

  select count(*) into actual_count
  from paid_member_profile_memberships_2026_27 source
  join public.pending_portal_accounts pending
    on pending.user_id = source.user_id
   and pending.claimed_at is null;
  if actual_count <> expected_count then
    raise exception 'Paid-member profile membership import contains an account that is not awaiting owner verification';
  end if;

  select count(*) into actual_count
  from paid_member_profile_memberships_2026_27 source
  join public.membership_classes membership_class
    on membership_class.code = source.membership_class_code
   and membership_class.is_active;
  if actual_count <> expected_count then
    raise exception 'Paid-member profile membership import contains an unavailable membership class';
  end if;
end;
$$;
update public.users portal_user
set is_active = true,
    updated_at = now()
from paid_member_profile_memberships_2026_27 source
where portal_user.id = source.user_id;

insert into public.club_memberships (
  user_id,
  membership_class_id,
  legal_status,
  commenced_at,
  commencement_method
)
select
  source.user_id,
  membership_class.id,
  'current',
  source.commenced_at::timestamptz,
  'legacy_import'
from paid_member_profile_memberships_2026_27 source
join public.membership_classes membership_class
  on membership_class.code = source.membership_class_code
 and membership_class.is_active
on conflict (user_id) do update
set membership_class_id = excluded.membership_class_id,
    legal_status = 'current',
    commenced_at = excluded.commenced_at,
    commencement_method = 'legacy_import',
    ended_at = null,
    end_reason = null,
    updated_at = now();

insert into public.membership_financial_periods (
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
  financially_cleared_at,
  waiver_reason,
  waiver_authorised_by,
  waiver_authorised_at
)
select
  membership.id,
  financial_year.financial_year_start,
  financial_year.financial_year_end,
  membership_class.annual_fee,
  membership_class.annual_fee,
  0,
  membership_class.annual_fee,
  case when membership_class.is_fee_exempt then 'fee_exempt' else 'paid' end,
  financial_year.financial_year_start,
  financial_year.financial_year_start::timestamptz
    + membership_settings.non_payment_grace_days * interval '1 day',
  now(),
  null,
  null,
  null
from paid_member_profile_memberships_2026_27 source
join public.club_memberships membership on membership.user_id = source.user_id
join public.membership_classes membership_class on membership_class.id = membership.membership_class_id
cross join lateral public.membership_financial_year_bounds(source.commenced_at) financial_year
join public.membership_settings membership_settings on membership_settings.id = true
on conflict (membership_id, financial_year_start) do update
set financial_year_end = excluded.financial_year_end,
    standard_fee = excluded.standard_fee,
    membership_fee_amount = excluded.membership_fee_amount,
    scholarship_contribution_amount = excluded.scholarship_contribution_amount,
    amount_due = excluded.amount_due,
    fee_disposition = excluded.fee_disposition,
    due_date = excluded.due_date,
    grace_expires_at = excluded.grace_expires_at,
    financially_cleared_at = excluded.financially_cleared_at,
    waiver_reason = null,
    waiver_authorised_by = null,
    waiver_authorised_at = null,
    updated_at = now();

insert into public.membership_status_events (
  membership_id,
  user_id,
  event_type,
  actor_id,
  details
)
select
  membership.id,
  source.user_id,
  'legacy_membership_imported',
  null,
  jsonb_build_object(
    'class', source.membership_class_code,
    'commencedAt', source.commenced_at,
    'feeDisposition', 'paid',
    'reason', '2026-27 paid member profile provisioning',
    'source', 'BFC_Paid_Members_Current_2026-27.csv'
  )
from paid_member_profile_memberships_2026_27 source
join public.club_memberships membership on membership.user_id = source.user_id
where not exists (
  select 1
  from public.membership_status_events event
  where event.membership_id = membership.id
    and event.event_type = 'legacy_membership_imported'
    and event.details->>'reason' = '2026-27 paid member profile provisioning'
);

do $$
declare
  expected_count constant integer := 107;
  actual_count integer;
begin
  select count(*) into actual_count
  from paid_member_profile_memberships_2026_27 source
  join public.users portal_user
    on portal_user.id = source.user_id
   and portal_user.is_active
  join public.club_memberships membership
    on membership.user_id = source.user_id
   and membership.legal_status = 'current'
   and membership.ended_at is null
  join public.membership_classes membership_class
    on membership_class.id = membership.membership_class_id
   and membership_class.code = source.membership_class_code
  join public.membership_financial_periods financial_period
    on financial_period.membership_id = membership.id
   and financial_period.financial_year_start = date '2026-07-01'
   and financial_period.fee_disposition in ('paid', 'fee_exempt')
   and financial_period.financially_cleared_at is not null;

  if actual_count <> expected_count then
    raise exception 'Paid-member profile membership verification expected % complete records, found %',
      expected_count,
      actual_count;
  end if;
end;
$$;
