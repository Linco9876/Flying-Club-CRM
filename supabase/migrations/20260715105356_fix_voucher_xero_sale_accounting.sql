alter table public.trial_flight_vouchers
  add column if not exists xero_sale_bank_transaction_id text,
  add column if not exists xero_purchaser_contact_id text;

comment on column public.trial_flight_vouchers.xero_sale_bank_transaction_id is
  'Xero RECEIVE bank transaction created when a Stripe-paid voucher is sold.';

comment on column public.trial_flight_vouchers.xero_purchaser_contact_id is
  'Xero contact used for the voucher purchaser and voucher sale receipt.';
