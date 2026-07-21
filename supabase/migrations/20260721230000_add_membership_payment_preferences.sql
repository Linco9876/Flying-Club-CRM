-- Membership payment choices, recurring payment authority and scholarship contributions.

alter table public.membership_settings
  add column if not exists xero_scholarship_item_code text;

alter table public.membership_financial_periods
  add column if not exists membership_fee_amount numeric(10,2),
  add column if not exists scholarship_contribution_amount numeric(10,2) not null default 0;

update public.membership_financial_periods
set membership_fee_amount = greatest(amount_due - coalesce(scholarship_contribution_amount, 0), 0)
where membership_fee_amount is null;

alter table public.membership_financial_periods
  alter column membership_fee_amount set not null,
  alter column membership_fee_amount drop default;

alter table public.membership_financial_periods
  drop constraint if exists membership_financial_periods_membership_fee_amount_check,
  add constraint membership_financial_periods_membership_fee_amount_check
    check (membership_fee_amount >= 0),
  drop constraint if exists membership_financial_periods_scholarship_amount_check,
  add constraint membership_financial_periods_scholarship_amount_check
    check (scholarship_contribution_amount >= 0);

create table if not exists public.membership_payment_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  payment_method text not null default 'becs'
    check (payment_method in ('invoice', 'becs', 'card')),
  auto_renew boolean not null default false,
  scholarship_contribution_enabled boolean not null default false,
  scholarship_contribution_amount numeric(10,2) not null default 5
    check (scholarship_contribution_amount >= 0),
  authority_status text not null default 'pending'
    check (authority_status in ('not_required', 'pending', 'ready', 'failed', 'cancelled')),
  stripe_customer_id text,
  stripe_payment_method_id text,
  stripe_payment_method_type text,
  payment_method_display text,
  stripe_mode text check (stripe_mode is null or stripe_mode in ('test', 'live')),
  is_test_mode boolean not null default false,
  consent_version text not null default 'membership-payments-v1-2026-07-21',
  consent_text text,
  consent_accepted_at timestamptz,
  consent_ip text,
  consent_user_agent text,
  last_collection_attempt_at timestamptz,
  last_collection_status text,
  last_collection_error text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_payment_preferences_authority_check check (
    (payment_method = 'invoice' and authority_status = 'not_required')
    or payment_method in ('becs', 'card')
  ),
  constraint membership_payment_preferences_method_reference_check check (
    authority_status <> 'ready'
    or payment_method = 'invoice'
    or (stripe_customer_id is not null and stripe_payment_method_id is not null)
  )
);

create unique index if not exists membership_payment_preferences_stripe_method_idx
  on public.membership_payment_preferences(stripe_payment_method_id)
  where stripe_payment_method_id is not null;

create table if not exists public.membership_payment_setup_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  payment_method text not null check (payment_method in ('becs', 'card')),
  stripe_customer_id text not null,
  stripe_checkout_session_id text,
  stripe_setup_intent_id text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled', 'expired', 'failed')),
  consent_text text not null,
  consent_accepted_at timestamptz not null,
  consent_ip text,
  consent_user_agent text,
  stripe_mode text not null check (stripe_mode in ('test', 'live')),
  is_test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists membership_payment_setup_sessions_user_idx
  on public.membership_payment_setup_sessions(user_id, created_at desc);

create or replace function public.apply_membership_scholarship_contribution()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_preference public.membership_payment_preferences%rowtype;
begin
  select user_id into v_user_id from public.club_memberships where id = new.membership_id;
  select * into v_preference from public.membership_payment_preferences where user_id = v_user_id;

  new.membership_fee_amount := greatest(coalesce(new.membership_fee_amount, new.amount_due, 0), 0);
  new.scholarship_contribution_amount := case
    when found and v_preference.scholarship_contribution_enabled
      then greatest(coalesce(v_preference.scholarship_contribution_amount, 0), 0)
    else 0
  end;
  new.amount_due := round(new.membership_fee_amount + new.scholarship_contribution_amount, 2);
  return new;
end;
$$;

drop trigger if exists apply_membership_scholarship_contribution on public.membership_financial_periods;
create trigger apply_membership_scholarship_contribution
before insert on public.membership_financial_periods
for each row execute function public.apply_membership_scholarship_contribution();

alter table public.membership_payment_preferences enable row level security;
alter table public.membership_payment_setup_sessions enable row level security;

drop policy if exists "Members read own membership payment preference" on public.membership_payment_preferences;
create policy "Members read own membership payment preference"
  on public.membership_payment_preferences for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "Members read own membership payment setup sessions" on public.membership_payment_setup_sessions;
create policy "Members read own membership payment setup sessions"
  on public.membership_payment_setup_sessions for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

grant select on public.membership_payment_preferences, public.membership_payment_setup_sessions to authenticated;
grant all on public.membership_payment_preferences, public.membership_payment_setup_sessions to service_role;

comment on table public.membership_payment_preferences is
  'Member-selected BFC membership payment method, explicit recurring authority and optional annual scholarship contribution. Scholarship contribution is always opt-in.';
comment on column public.membership_payment_preferences.scholarship_contribution_enabled is
  'Must remain false until the member actively opts in; never preselected.';
comment on column public.membership_financial_periods.scholarship_contribution_amount is
  'Optional scholarship amount invoiced separately from the membership fee for this financial year.';
