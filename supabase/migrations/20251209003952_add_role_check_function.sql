/*
  # Add Role Check Function to Avoid Recursive RLS

  1. Problem
    - Many RLS policies check user roles by querying the users table
    - This creates recursive queries that hang or fail
    - Example: checking if current user is admin requires reading users table

  2. Solution
    - Create a SECURITY DEFINER function to check user roles
    - This function bypasses RLS to read the user's role
    - All policies can use this function instead of subqueries

  3. Changes
    - Add get_user_role() function that returns current user's role
    - Function uses SECURITY DEFINER to bypass RLS
    - Returns NULL if user not found
*/

-- Create a function to get the current user's role without RLS checks
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM users
  WHERE id = auth.uid();
  
  RETURN user_role;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_role() TO authenticated;