-- A production audit found the auth.users -> public.users trigger missing even
-- though the trigger function remained installed. Without this trigger a
-- successful public sign-up can authenticate but has no CRM profile or role.
-- Recreate it idempotently for future accounts. Existing orphaned logins are
-- deliberately not backfilled here because they may need to be reconciled with
-- an existing member profile rather than turned into duplicate members.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates the matching CRM profile, student row, and default role for a newly created authentication user.';
