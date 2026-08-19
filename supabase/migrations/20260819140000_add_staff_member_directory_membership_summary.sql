create or replace function public.get_member_directory_membership_summaries()
returns table (
  user_id uuid,
  legal_status text,
  membership_class_name text,
  membership_class_code text,
  application_status text,
  application_class_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id as user_id,
    m.legal_status,
    membership_class.name as membership_class_name,
    membership_class.code as membership_class_code,
    pending_application.status as application_status,
    pending_application.membership_class_name as application_class_name
  from public.users u
  left join public.club_memberships m on m.user_id = u.id
  left join public.membership_classes membership_class on membership_class.id = m.membership_class_id
  left join lateral (
    select
      a.status,
      application_class.name as membership_class_name
    from public.membership_applications a
    join public.membership_classes application_class on application_class.id = a.membership_class_id
    where a.user_id = u.id
      and a.status = 'pending'
    order by a.submitted_at desc
    limit 1
  ) pending_application on true
  where public.current_user_has_staff_role();
$$;

revoke all on function public.get_member_directory_membership_summaries() from public, anon;
grant execute on function public.get_member_directory_membership_summaries() to authenticated, service_role;

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values (
  'public.get_member_directory_membership_summaries()',
  'get_member_directory_membership_summaries',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Staff-only directory summary. The RPC checks the caller role and returns no financial or private membership-application details.',
  date '2026-08-19'
)
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

select private.assert_function_permission_manifest();

comment on function public.get_member_directory_membership_summaries() is
  'Returns only the club-membership class and legal/application status needed by the staff member directory. Financial and application-detail fields are deliberately excluded.';
