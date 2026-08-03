-- Allow members to manage their own profile picture while reserving moderation
-- of another person's picture for an MFA-verified administrator.

create or replace function public.guard_users_self_service_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.avatar_url is distinct from old.avatar_url
     and auth.uid() is distinct from old.id
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.current_user_is_admin() then
    raise exception 'Administrator MFA verification is required to moderate another member''s profile picture'
      using errcode = '42501';
  end if;

  if auth.uid() = old.id and not public.current_user_has_staff_role() then
    if new.id is distinct from old.id
      or new.role is distinct from old.role
      or new.is_senior_instructor is distinct from old.is_senior_instructor
      or new.is_active is distinct from old.is_active
      or new.created_at is distinct from old.created_at then
      raise exception 'Only staff can change protected member fields';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_users_self_service_update() from public, anon, authenticated;
revoke all on function public.guard_users_self_service_update() from service_role;

drop policy if exists "Admins can delete any avatar" on storage.objects;
create policy "Admins can delete any avatar"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'user-avatars'
    and public.current_user_is_admin()
  );

create or replace function private.audit_profile_picture_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  insert into public.admin_audit_log (
    actor_id,
    action,
    area,
    table_name,
    record_id,
    record_label,
    old_data,
    new_data,
    changed_fields,
    metadata
  ) values (
    auth.uid(),
    'UPDATE',
    'Profile Pictures',
    'users',
    old.id::text,
    coalesce(new.name, old.name, 'Member'),
    jsonb_build_object('avatar_url', old.avatar_url),
    jsonb_build_object('avatar_url', new.avatar_url),
    array['avatar_url']::text[],
    jsonb_build_object(
      'moderated_by_admin', auth.uid() is distinct from old.id,
      'captured_by', 'audit_profile_picture_change'
    )
  );

  return new;
end;
$$;

revoke all on function private.audit_profile_picture_change() from public, anon, authenticated, service_role;

drop trigger if exists audit_user_profile_picture_updates on public.users;
create trigger audit_user_profile_picture_updates
  after update of avatar_url on public.users
  for each row
  when (old.avatar_url is distinct from new.avatar_url)
  execute function private.audit_profile_picture_change();

select private.assert_function_permission_manifest();
