-- Durable, observable membership billing with safe retry and charge deduplication.

alter table public.membership_settings
  alter column xero_membership_item_code set default 'BFC-MEMBERSHIP',
  alter column xero_scholarship_item_code set default 'BFC-SCHOLARSHIP';

update public.membership_settings
set
  xero_membership_item_code = coalesce(nullif(btrim(xero_membership_item_code), ''), 'BFC-MEMBERSHIP'),
  xero_scholarship_item_code = coalesce(nullif(btrim(xero_scholarship_item_code), ''), 'BFC-SCHOLARSHIP'),
  updated_at = now()
where id = true;

alter table public.membership_financial_periods
  add column if not exists billing_sync_status text,
  add column if not exists billing_sync_attempts integer not null default 0,
  add column if not exists billing_sync_next_attempt_at timestamptz,
  add column if not exists billing_sync_error text,
  add column if not exists billing_sync_updated_at timestamptz;

alter table public.membership_financial_periods
  drop constraint if exists membership_financial_periods_billing_sync_status_check,
  add constraint membership_financial_periods_billing_sync_status_check
    check (
      billing_sync_status is null
      or billing_sync_status in ('queued', 'processing', 'succeeded', 'failed', 'needs_review')
    ),
  drop constraint if exists membership_financial_periods_billing_sync_attempts_check,
  add constraint membership_financial_periods_billing_sync_attempts_check
    check (billing_sync_attempts >= 0);

alter table public.xero_sync_queue
  drop constraint if exists xero_sync_queue_entity_type_check,
  add constraint xero_sync_queue_entity_type_check
    check (
      entity_type in (
        'contact',
        'flight_invoice',
        'flight_payment',
        'account_transaction',
        'voucher',
        'membership_period'
      )
    ),
  drop constraint if exists xero_sync_queue_action_check,
  add constraint xero_sync_queue_action_check
    check (
      action in (
        'upsert_contact',
        'create_invoice',
        'apply_payment',
        'sync_transaction',
        'sync_voucher',
        'sync_membership'
      )
    );

-- A previous interrupted request could leave an unusable placeholder with no
-- Stripe PaymentIntent. It is safe to close those before enforcing the active
-- collection invariant; no debit was submitted for these rows.
update public.xero_invoice_portal_payments
set
  status = 'failed',
  error = coalesce(error, 'Interrupted before Stripe received the collection request. Safe to retry.'),
  updated_at = now()
where status = 'pending'
  and stripe_payment_intent_id is null
  and created_at < now() - interval '30 minutes';

create unique index if not exists xero_invoice_portal_payments_one_active_collection
  on public.xero_invoice_portal_payments (xero_invoice_id)
  where status in ('pending', 'paid', 'needs_review');

create unique index if not exists xero_sync_queue_one_open_membership_item
  on public.xero_sync_queue (entity_type, entity_id, action)
  where entity_type = 'membership_period'
    and action = 'sync_membership'
    and status in ('pending', 'processing');

create index if not exists membership_financial_periods_billing_status_idx
  on public.membership_financial_periods (billing_sync_status, billing_sync_next_attempt_at)
  where billing_sync_status is not null;

comment on column public.membership_financial_periods.billing_sync_status is
  'Member-visible state of the durable Xero invoice and automatic collection workflow.';
comment on index public.xero_invoice_portal_payments_one_active_collection is
  'Prevents a second active Stripe collection for the same Xero invoice.';
