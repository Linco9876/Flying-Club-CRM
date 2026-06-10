/*
  # Fix missing user_roles rows

  Inserts a user_roles row for any user who has a role set in the users table
  but no corresponding entry in user_roles. This ensures role lookups work
  correctly for all users.
*/

INSERT INTO user_roles (user_id, role)
SELECT u.id, u.role
FROM users u
WHERE u.role IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
  );
