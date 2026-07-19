-- Keep mobile access compatible with both normalized and legacy role storage.

create or replace function public.mobile_user_can_clock_duty(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and (
    exists (
      select 1
        from public.user_roles ur
       where ur.user_id = p_user_id
         and ur.role in ('admin', 'senior_instructor', 'instructor')
    )
    or exists (
      select 1
        from public.users u
       where u.id = p_user_id
         and u.role in ('admin', 'senior_instructor', 'instructor')
    )
  );
$$;

revoke all on function public.mobile_user_can_clock_duty(uuid) from public;
grant execute on function public.mobile_user_can_clock_duty(uuid) to authenticated;
