-- RLS policies and guarded update triggers call this helper from different
-- PostgREST execution paths. The function is security definer and only returns
-- whether the current auth.uid() has a staff role, so public execute is safe.

grant execute on function public.current_user_has_staff_role() to public;
