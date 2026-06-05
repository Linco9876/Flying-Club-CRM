-- Allow authenticated RLS policies and guarded updates to call the staff-role helper.
-- The helper is security definer and only returns a boolean based on public.user_roles.

grant execute on function public.current_user_has_staff_role() to authenticated;
