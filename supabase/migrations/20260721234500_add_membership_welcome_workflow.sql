-- Persist signup payment choices and make membership welcome delivery auditable/idempotent.

create or replace function public.create_membership_payment_preference_for_new_user()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_meta jsonb;
  v_method text;
  v_scholarship_amount numeric(10,2);
begin
  if coalesce(new.portal_access_scope, 'full') <> 'full' then return new; end if;
  select raw_user_meta_data into v_meta from auth.users where id = new.id;
  if coalesce((v_meta->>'membership_application')::boolean, false) is not true then return new; end if;

  v_method := lower(coalesce(nullif(v_meta->>'membership_payment_method', ''), 'invoice'));
  if v_method not in ('invoice', 'becs', 'card') then v_method := 'invoice'; end if;
  v_scholarship_amount := case
    when coalesce(v_meta->>'membership_scholarship_amount', '') ~ '^\d+(\.\d{1,2})?$'
      then greatest((v_meta->>'membership_scholarship_amount')::numeric, 0)
    else 5
  end;

  insert into public.membership_payment_preferences(
    user_id, payment_method, auto_renew, scholarship_contribution_enabled,
    scholarship_contribution_amount, authority_status, consent_text, consent_accepted_at
  ) values (
    new.id,
    v_method,
    case when v_method in ('becs', 'card') then coalesce((v_meta->>'membership_auto_renew')::boolean, false) else false end,
    coalesce((v_meta->>'membership_scholarship_enabled')::boolean, false),
    v_scholarship_amount,
    case when v_method = 'invoice' then 'not_required' else 'pending' end,
    case when v_method = 'invoice'
      then 'Applicant selected manual Xero invoice payment during membership signup.'
      else 'Applicant selected payment authority setup during membership signup. Stripe setup must complete before the authority is ready.'
    end,
    now()
  ) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_membership_payment_preference_for_new_user on public.users;
create trigger create_membership_payment_preference_for_new_user
after insert on public.users for each row
execute function public.create_membership_payment_preference_for_new_user();

create table if not exists public.membership_welcome_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null unique,
  membership_id uuid references public.club_memberships(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  recipient_email text not null,
  payment_variant text not null check (payment_variant in ('automatic', 'manual')),
  is_review boolean not null default false,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists membership_welcome_email_deliveries_membership_idx
  on public.membership_welcome_email_deliveries(membership_id, status);

alter table public.membership_welcome_email_deliveries enable row level security;

drop policy if exists "Admins read membership welcome email deliveries" on public.membership_welcome_email_deliveries;
create policy "Admins read membership welcome email deliveries"
  on public.membership_welcome_email_deliveries for select to authenticated
  using (public.current_user_is_admin());

grant select on public.membership_welcome_email_deliveries to authenticated;
grant all on public.membership_welcome_email_deliveries to service_role;

comment on table public.membership_welcome_email_deliveries is
  'Idempotent delivery log for member commencement welcome emails and fixed-recipient review copies.';
