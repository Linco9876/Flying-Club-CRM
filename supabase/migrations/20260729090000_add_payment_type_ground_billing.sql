alter table public.flight_types
  add column if not exists ground_session_enabled boolean not null default false,
  add column if not exists xero_account_code text;

update public.flight_types
set ground_session_enabled = true
where ground_session_hourly_rate > 0
  and ground_session_enabled = false;

comment on table public.flight_types is
  'Payment types available for bookings and logs. The legacy table name is retained for API and historical compatibility.';

comment on column public.flight_types.ground_session_enabled is
  'Whether this payment type may be selected for an hourly ground session.';

comment on column public.flight_types.ground_session_hourly_rate is
  'Hourly ground-session price for this payment type. Ground sessions bill in 15-minute increments.';

comment on column public.flight_types.xero_item_code is
  'Optional Xero sales item code used on invoices for this payment type.';

comment on column public.flight_types.xero_account_code is
  'Optional Xero revenue account code for this payment type. Falls back to the integration default when blank.';
