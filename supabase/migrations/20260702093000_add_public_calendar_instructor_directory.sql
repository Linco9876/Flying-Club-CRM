create or replace function public.list_calendar_instructors()
returns table (
  id uuid,
  name text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.name,
    u.email
  from public.users u
  where public.current_user_has_full_portal_access()
    and coalesce(u.is_active, true)
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = u.id
        and ur.role in ('instructor', 'senior_instructor')
    )
  order by u.name;
$$;

revoke all on function public.list_calendar_instructors() from public;
revoke all on function public.list_calendar_instructors() from anon;
grant execute on function public.list_calendar_instructors() to authenticated;
