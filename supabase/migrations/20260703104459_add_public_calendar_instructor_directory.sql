create or replace function public.list_calendar_instructors()
returns table (
  id uuid,
  name text,
  email text
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    coalesce(nullif(u.name, ''), u.email, 'Instructor') as name,
    coalesce(u.email, '') as email
  from public.users u
  where auth.uid() is not null
    and coalesce(u.is_active, true) = true
    and coalesce(u.portal_access_scope, 'full') <> 'guest_placeholder'
    and (
      u.role in ('instructor', 'senior_instructor')
      or coalesce(u.is_senior_instructor, false) = true
      or exists (
        select 1
        from public.user_roles ur
        where ur.user_id = u.id
          and ur.role in ('instructor', 'senior_instructor')
      )
    )
  order by name;
$$;

revoke all on function public.list_calendar_instructors() from public;
grant execute on function public.list_calendar_instructors() to authenticated;
