-- Make role helper checks tolerant of stale JWT app_metadata.
-- The CRM syncs roles into auth metadata, but old sessions can carry stale
-- claims. RLS should accept any trusted source: app_metadata, user_roles, or
-- the legacy users.role column.

CREATE OR REPLACE FUNCTION public.current_user_has_staff_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(((SELECT auth.jwt()) -> 'app_metadata' -> 'roles') ?| ARRAY['admin','instructor','senior_instructor'], false)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = ANY (ARRAY['admin','instructor','senior_instructor'])
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND (
          u.role = ANY (ARRAY['admin','instructor','senior_instructor'])
          OR COALESCE(u.is_senior_instructor, false) = true
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(((SELECT auth.jwt()) -> 'app_metadata' -> 'roles') ? 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_staff_role() FROM anon;
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_staff_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
