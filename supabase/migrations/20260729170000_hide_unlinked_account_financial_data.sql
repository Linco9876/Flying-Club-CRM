-- Financial records belong to Xero-linked accounts only. The service role
-- remains able to reconcile or repair records, while every authenticated
-- portal read fails closed when the subject person has no Xero contact link.

create or replace function public.account_is_linked_to_xero(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = target_user_id
      and nullif(btrim(xero_contact_id), '') is not null
  );
$$;

revoke all on function public.account_is_linked_to_xero(uuid) from public;
grant execute on function public.account_is_linked_to_xero(uuid) to authenticated, service_role;

create or replace function public.membership_is_linked_to_xero(target_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_memberships membership
    join public.users account on account.id = membership.user_id
    where membership.id = target_membership_id
      and nullif(btrim(account.xero_contact_id), '') is not null
  );
$$;

revoke all on function public.membership_is_linked_to_xero(uuid) from public;
grant execute on function public.membership_is_linked_to_xero(uuid) to authenticated, service_role;

drop policy if exists "Financial ledger reads require a Xero-linked account"
  on public.account_transactions;
create policy "Financial ledger reads require a Xero-linked account"
  on public.account_transactions
  as restrictive
  for select
  to authenticated
  using (public.account_is_linked_to_xero(user_id));

drop policy if exists "Invoice reads require a Xero-linked account"
  on public.invoices;
create policy "Invoice reads require a Xero-linked account"
  on public.invoices
  as restrictive
  for select
  to authenticated
  using (public.account_is_linked_to_xero(student_id));

drop policy if exists "Invoice item reads require a Xero-linked account"
  on public.invoice_items;
create policy "Invoice item reads require a Xero-linked account"
  on public.invoice_items
  as restrictive
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.invoices
      where invoices.id = invoice_items.invoice_id
        and public.account_is_linked_to_xero(invoices.student_id)
    )
  );

drop policy if exists "Xero portal payment reads require a linked account"
  on public.xero_invoice_portal_payments;
create policy "Xero portal payment reads require a linked account"
  on public.xero_invoice_portal_payments
  as restrictive
  for select
  to authenticated
  using (public.account_is_linked_to_xero(user_id));

drop policy if exists "Membership financial reads require a linked account"
  on public.membership_financial_periods;
create policy "Membership financial reads require a linked account"
  on public.membership_financial_periods
  as restrictive
  for select
  to authenticated
  using (public.membership_is_linked_to_xero(membership_id));

drop policy if exists "Saved flight card reads require a linked account"
  on public.member_stripe_payment_methods;
create policy "Saved flight card reads require a linked account"
  on public.member_stripe_payment_methods
  as restrictive
  for select
  to authenticated
  using (public.account_is_linked_to_xero(user_id));

drop policy if exists "Membership payment preference reads require a linked or pending account"
  on public.membership_payment_preferences;
create policy "Membership payment preference reads require a linked or pending account"
  on public.membership_payment_preferences
  as restrictive
  for select
  to authenticated
  using (
    public.account_is_linked_to_xero(user_id)
    or (
      user_id = auth.uid()
      and exists (
        select 1
        from public.membership_applications application
        where application.user_id = membership_payment_preferences.user_id
          and application.status = 'pending'
      )
    )
  );

comment on function public.account_is_linked_to_xero(uuid) is
  'Fail-closed visibility check used to prevent financial records being exposed for portal accounts without a Xero contact link.';
comment on function public.membership_is_linked_to_xero(uuid) is
  'Maps a membership financial period to the member account Xero-link visibility rule.';
