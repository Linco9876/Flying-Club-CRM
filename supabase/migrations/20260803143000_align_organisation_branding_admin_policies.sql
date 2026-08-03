-- Keep organisation branding permissions aligned with the canonical portal
-- administrator check. Some long-standing administrator accounts are recorded
-- in public.users rather than duplicated in public.user_roles.

drop policy if exists "Admins can upload org logo" on storage.objects;
create policy "Admins can upload org logo"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and public.current_user_is_admin()
  );

drop policy if exists "Admins can update org logo" on storage.objects;
create policy "Admins can update org logo"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and public.current_user_is_admin()
  )
  with check (
    bucket_id = 'org-logos'
    and public.current_user_is_admin()
  );

drop policy if exists "Admins can read org logo metadata" on storage.objects;
create policy "Admins can read org logo metadata"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'org-logos'
    and public.current_user_is_admin()
  );

drop policy if exists "Admins can insert organisation settings" on public.organisation_settings;
create policy "Admins can insert organisation settings"
  on public.organisation_settings
  for insert
  to authenticated
  with check (public.current_user_is_admin());

drop policy if exists "Admins can update organisation settings" on public.organisation_settings;
create policy "Admins can update organisation settings"
  on public.organisation_settings
  for update
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
