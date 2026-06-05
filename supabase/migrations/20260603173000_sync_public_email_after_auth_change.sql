/*
  Keep public.users.email aligned with the verified Supabase Auth email.

  Admin email changes now create an Auth email-change verification link. The CRM
  email should not move early; this trigger updates it only after Auth accepts
  the new email.
*/

CREATE OR REPLACE FUNCTION public.sync_public_user_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users
    SET email = NEW.email,
        updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;

CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_public_user_email_from_auth();

REVOKE EXECUTE ON FUNCTION public.sync_public_user_email_from_auth() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_public_user_email_from_auth() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_public_user_email_from_auth() FROM authenticated;
