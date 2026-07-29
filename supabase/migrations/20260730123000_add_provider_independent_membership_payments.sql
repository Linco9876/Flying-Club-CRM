-- Keep Stripe membership collection usable when Xero is intentionally disconnected.

create table if not exists public.membership_provider_payments (
  id uuid primary key default gen_random_uuid(),
  membership_period_id uuid not null references public.membership_financial_periods(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  external_payment_id text,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'AUD',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'needs_review', 'cancelled')),
  idempotency_key text not null unique,
  error text,
  stripe_mode text check (stripe_mode in ('test', 'live')),
  is_test_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists membership_provider_payments_one_active_period
  on public.membership_provider_payments (membership_period_id)
  where status in ('pending', 'processing', 'succeeded', 'needs_review');

create index if not exists membership_provider_payments_user_created_idx
  on public.membership_provider_payments (user_id, created_at desc);

alter table public.membership_provider_payments enable row level security;

drop policy if exists "Members read own provider membership payments"
  on public.membership_provider_payments;
create policy "Members read own provider membership payments"
  on public.membership_provider_payments
  for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

revoke all on table public.membership_provider_payments from anon;
revoke insert, update, delete on table public.membership_provider_payments from authenticated;
grant select on table public.membership_provider_payments to authenticated;
grant all on table public.membership_provider_payments to service_role;

comment on table public.membership_provider_payments is
  'Provider-bound membership collections that remain authoritative locally while Xero is disconnected. Idempotency prevents duplicate debits.';
