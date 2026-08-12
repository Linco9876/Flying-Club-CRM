-- Reconcile the 2026-27 paid-members register with existing full portal accounts.
-- The source register is deliberately represented by user UUID only so member PII
-- is not copied into source control. This migration is atomic and auditable.

create temporary table paid_member_reconciliation_2026_27 (
  user_id uuid primary key,
  membership_class_code text not null,
  commenced_at date not null
) on commit drop;

insert into paid_member_reconciliation_2026_27 (user_id, membership_class_code, commenced_at)
values
  ('009ec0a8-0668-4c9b-8871-e9ec3be1379f', 'full', date '2026-07-01'),
  ('01cba6c9-af17-4ebe-be50-f3ce6d992f4b', 'full', date '2026-07-01'),
  ('06749ce3-e49c-4e3a-9083-bca3776456d3', 'full', date '2026-07-01'),
  ('10fa3310-bca7-471c-b080-9ca9fa1919b9', 'junior', date '2026-07-01'),
  ('1224cb2b-2538-4861-801e-9ac2df1864ef', 'full', date '2026-07-01'),
  ('16b62e75-1b33-4523-8732-3e07a2ec309a', 'full', date '2026-07-01'),
  ('205f2faa-7395-4c49-900a-8aa8d2d48a2f', 'full', date '2026-07-01'),
  ('2262368e-3e29-40e5-9eb3-9b0a6c8213e8', 'full', date '2026-07-01'),
  ('268d53ac-1bc2-4ec7-9647-4bf0d4e8b22c', 'full', date '2026-07-01'),
  ('2aa37956-27f9-4aa5-990b-46c6feb5e08d', 'full', date '2026-07-01'),
  ('2b1dc842-4625-4aa0-8751-03a9efae36d8', 'full', date '2026-07-01'),
  ('2e65836a-146f-4ed0-a102-41a76644243e', 'full', date '2026-07-01'),
  ('2ee319fd-b423-4872-acd4-f63576541b71', 'full', date '2026-07-01'),
  ('2f59aefa-a41d-4ba4-b4c3-7c3bfc628cb0', 'full', date '2026-07-01'),
  ('30359024-21be-43f2-8713-6eb5b34731af', 'full', date '2026-07-01'),
  ('309d1442-2bc3-41de-8935-603c5f5ce4de', 'full', date '2026-07-01'),
  ('328357f4-bc93-48d2-8563-30e7bea6befe', 'full', date '2026-07-01'),
  ('37df55a6-5efb-4f8a-905a-8a2362477cb9', 'full', date '2026-07-01'),
  ('39386871-3145-429e-9669-3b64642b4150', 'full', date '2026-07-01'),
  ('3a18c5ea-844a-4064-a3ac-5db6a5010df0', 'full', date '2026-07-01'),
  ('3c8568e8-0955-49e2-b2fb-f2a0dad9a51d', 'full', date '2026-07-01'),
  ('40748647-61e2-46b0-bed5-7683230a2da1', 'full', date '2026-07-01'),
  ('4a0f7e7e-5567-4e94-8a68-1bfa0332014a', 'full', date '2026-07-01'),
  ('5071c9b6-110d-45d4-87ee-e846c81c6208', 'full', date '2026-07-01'),
  ('51705207-ca3e-4f30-bbed-0fcee78d6b9e', 'full', date '2026-07-01'),
  ('586b900b-0c20-4ff1-9ee3-f2013179f1a0', 'junior', date '2026-07-01'),
  ('600fb7a6-5719-414a-879c-04486da75376', 'full', date '2026-07-01'),
  ('60bb0a90-dd5c-429b-9f37-56695c6ad65c', 'full', date '2026-07-01'),
  ('6234396e-32da-47c0-a425-94739560b2e2', 'full', date '2026-07-01'),
  ('66af907e-202d-4318-b4e6-0a6360c0734a', 'full', date '2026-07-01'),
  ('6d209e23-752d-455e-95c5-100b4ad1a4ba', 'full', date '2026-07-01'),
  ('6d4b66ff-d7d2-47a0-bd48-329dade5b67a', 'full', date '2026-07-01'),
  ('6f7940f2-18c8-437c-965a-5843c37d3238', 'full', date '2026-07-01'),
  ('70f9a8d4-1ce0-4399-8d7e-c079e5fffd6a', 'full', date '2026-07-01'),
  ('74412fee-4228-4b6b-a87f-1fff4a94c6f9', 'full', date '2026-07-01'),
  ('761073f9-47d4-45dc-9f23-0023c49745fb', 'full', date '2026-07-01'),
  ('766ea746-08b0-40fc-95a0-ed24923718e4', 'full', date '2026-07-01'),
  ('76e14b40-dcdf-4e4b-bc7f-c776ed00a70d', 'full', date '2026-07-01'),
  ('7f096d63-e686-4970-864c-9065936f3eb3', 'junior', date '2026-07-01'),
  ('81289829-1133-4fb1-8b21-34006ee07786', 'full', date '2026-07-01'),
  ('84649e94-ef9e-4f9a-82fe-05bd9773b401', 'full', date '2026-07-01'),
  ('858f69b9-f0f7-42ee-a23a-343c21bfab9e', 'junior', date '2026-07-01'),
  ('92b07084-6e0d-4e86-95c0-a68b4ceffa68', 'full', date '2026-07-01'),
  ('9343e6d0-44ee-4aa8-97a6-a7d187bb0b25', 'full', date '2026-07-01'),
  ('93ac67f6-ed5b-4b0b-b0f9-155b5a907ddf', 'full', date '2026-07-01'),
  ('9a0c4ae5-32d3-4515-a074-006282fa9867', 'full', date '2026-07-01'),
  ('9a835df6-4650-43fe-a48f-d7f1a5efd974', 'affiliate', date '2026-07-01'),
  ('9bc39712-5a79-4705-8701-90af1cf88704', 'full', date '2026-07-01'),
  ('9d4856fc-27e6-45c5-8912-705b9c3395dd', 'full', date '2026-07-01'),
  ('ac2a664e-e0c6-4b86-bdde-cd9755a743bc', 'junior', date '2026-07-01'),
  ('b28b38dc-f9ee-4fc0-8696-0eb8be6a70be', 'full', date '2026-07-01'),
  ('b34da1ce-3180-4b12-bd80-56759564a57b', 'full', date '2026-07-01'),
  ('b5b6045d-8bab-43e8-b9d9-8b6a9009db53', 'full', date '2026-07-01'),
  ('bf09b2dd-97c6-48d6-954d-8d46b365f3a2', 'full', date '2026-07-01'),
  ('bf81b892-4bcc-40cd-a5dc-49e244ccc540', 'full', date '2026-07-01'),
  ('c22e5099-d19d-4415-a3a4-024ec269f90c', 'full', date '2026-07-01'),
  ('c460be49-3b7b-44f9-8b41-890100b739ed', 'junior', date '2026-07-01'),
  ('c48e3b78-9a69-4d2f-abdf-d3e32f114052', 'full', date '2026-07-01'),
  ('ca42548f-2e66-4ce2-9c55-fc196fbdbea5', 'full', date '2026-07-01'),
  ('cbb85d4c-f659-4964-86a4-7bde4b2ebcb4', 'full', date '2026-07-01'),
  ('cd68040c-5694-45f6-bcff-e07ddaeeb749', 'full', date '2026-07-01'),
  ('cde94e94-8e9f-42ee-a54f-ff5f8f2d7d4d', 'affiliate', date '2026-07-01'),
  ('d0647088-73c3-48e3-853f-9921946dbd18', 'full', date '2026-07-01'),
  ('d0e505f9-0226-40b6-9484-53a65d4a9ec6', 'junior', date '2026-07-01'),
  ('d6fc51b8-99a9-474e-b9b0-aa3468af993a', 'full', date '2026-07-01'),
  ('db9da46b-7cb1-45ff-a182-38270dd319bd', 'full', date '2026-07-01'),
  ('dc215439-3515-4ce1-bb7b-89a1ee462880', 'full', date '2026-07-01'),
  ('ddf0738f-c04d-4f31-957a-3bab55fb455e', 'full', date '2026-07-01'),
  ('e1471f45-6369-4fc3-a111-30f9133d7b70', 'full', date '2026-07-01'),
  ('e3f16a05-e383-4388-b3bb-c0bc034f4175', 'full', date '2026-07-01'),
  ('e8507a59-1eb3-4e83-bab0-4d3e3a297cda', 'full', date '2026-07-01'),
  ('e95c8045-5ce2-4b6c-8b74-7891bd5723c9', 'full', date '2026-07-01'),
  ('e9da7253-b4cd-46f4-bd90-634ad51998b0', 'full', date '2026-07-01'),
  ('eb3e7039-6965-4ec7-9d95-0aa20f8341b8', 'full', date '2026-07-01'),
  ('ec2622b3-26a8-439a-ac02-8e9140789b90', 'full', date '2026-07-01'),
  ('f45ce5b9-181b-465b-8340-37a03a489fdb', 'full', date '2026-07-01'),
  ('f4929339-0d56-4bf5-9ad3-b40d9a4d265b', 'affiliate', date '2026-07-01'),
  ('f8b1ffb6-3131-4fb1-82da-b7a42f1ab6c5', 'full', date '2026-07-01');

do $$
declare
  expected_count constant integer := 78;
  actual_count integer;
begin
  select count(*) into actual_count from paid_member_reconciliation_2026_27;
  if actual_count <> expected_count then
    raise exception 'Paid-member reconciliation expected % source rows, found %', expected_count, actual_count;
  end if;

  select count(*) into actual_count
  from paid_member_reconciliation_2026_27 source
  join public.users portal_user on portal_user.id = source.user_id
  where coalesce(portal_user.portal_access_scope, 'full') = 'full';
  if actual_count <> expected_count then
    raise exception 'Paid-member reconciliation contains a missing or non-full portal account';
  end if;

  select count(*) into actual_count
  from paid_member_reconciliation_2026_27 source
  join public.membership_classes membership_class
    on membership_class.code = source.membership_class_code
   and membership_class.is_active;
  if actual_count <> expected_count then
    raise exception 'Paid-member reconciliation contains an unavailable membership class';
  end if;
end;
$$;

update public.users portal_user
set is_active = true,
    updated_at = now()
from paid_member_reconciliation_2026_27 source
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
from paid_member_reconciliation_2026_27 source
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
  case when membership_class.is_fee_exempt then 'fee_exempt' else 'paid' end,
  financial_year.financial_year_start,
  financial_year.financial_year_start::timestamptz
    + membership_settings.non_payment_grace_days * interval '1 day',
  now(),
  null,
  null,
  null
from paid_member_reconciliation_2026_27 source
join public.club_memberships membership on membership.user_id = source.user_id
join public.membership_classes membership_class on membership_class.id = membership.membership_class_id
cross join lateral public.membership_financial_year_bounds(source.commenced_at) financial_year
join public.membership_settings membership_settings on membership_settings.id = true
on conflict (membership_id, financial_year_start) do update
set financial_year_end = excluded.financial_year_end,
    standard_fee = excluded.standard_fee,
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
    'reason', '2026-27 paid member register reconciliation',
    'source', 'BFC_Paid_Members_Current_2026-27.csv'
  )
from paid_member_reconciliation_2026_27 source
join public.club_memberships membership on membership.user_id = source.user_id;

do $$
declare
  expected_count constant integer := 78;
  actual_count integer;
begin
  select count(*) into actual_count
  from paid_member_reconciliation_2026_27 source
  join public.users portal_user on portal_user.id = source.user_id
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
   and financial_period.financially_cleared_at is not null
  where portal_user.is_active;

  if actual_count <> expected_count then
    raise exception 'Paid-member reconciliation verification expected % complete records, found %',
      expected_count,
      actual_count;
  end if;
end;
$$;
