/*
  # Add trigger to keep users.role in sync with user_roles

  ## Problem
  Dozens of RLS policies check users.role, but the authoritative source is the user_roles
  table. When user_roles changes (insert/delete), users.role can drift out of sync,
  causing RLS violations for users whose role changed.

  ## Solution
  A trigger fires on INSERT and DELETE on user_roles and immediately updates users.role
  to reflect the highest-priority role that user has.

  Priority order: admin > senior_instructor > instructor > pilot > student
*/

CREATE OR REPLACE FUNCTION sync_user_primary_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id uuid;
  new_role text;
BEGIN
  -- Determine which user was affected
  IF TG_OP = 'DELETE' THEN
    target_user_id := OLD.user_id;
  ELSE
    target_user_id := NEW.user_id;
  END IF;

  -- Calculate the highest-priority role for this user
  SELECT CASE
    WHEN bool_or(role = 'admin') THEN 'admin'
    WHEN bool_or(role = 'senior_instructor') THEN 'senior_instructor'
    WHEN bool_or(role = 'instructor') THEN 'instructor'
    WHEN bool_or(role = 'pilot') THEN 'pilot'
    ELSE 'student'
  END INTO new_role
  FROM user_roles
  WHERE user_id = target_user_id;

  -- Fall back to student if no roles exist
  IF new_role IS NULL THEN
    new_role := 'student';
  END IF;

  -- Update users.role
  UPDATE users SET role = new_role WHERE id = target_user_id;

  RETURN NEW;
END;
$$;

-- Revoke public execute (security best practice)
REVOKE EXECUTE ON FUNCTION sync_user_primary_role() FROM PUBLIC;

-- Drop old trigger if it exists
DROP TRIGGER IF EXISTS trg_sync_user_primary_role ON user_roles;

-- Attach trigger to user_roles for both INSERT and DELETE
CREATE TRIGGER trg_sync_user_primary_role
  AFTER INSERT OR DELETE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_primary_role();
