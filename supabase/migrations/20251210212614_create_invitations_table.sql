/*
  # Create invitations table

  1. New Tables
    - `invitations`
      - `id` (uuid, primary key)
      - `email` (text, unique, not null)
      - `name` (text, not null)
      - `phone` (text)
      - `role` (text, not null, default 'student')
      - `invited_by` (uuid, references users)
      - `status` (text, not null, default 'pending')
      - `invited_at` (timestamptz, not null, default now())
      - `accepted_at` (timestamptz)
      - `user_id` (uuid, references users)
      
  2. Security
    - Enable RLS on invitations table
    - Admins and instructors can view all invitations
    - Admins and instructors can create invitations
    - Users cannot delete invitations
*/

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'student',
  invited_by uuid REFERENCES users(id) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  user_id uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and instructors can view invitations"
  ON invitations
  FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin' OR get_user_role() = 'instructor'
  );

CREATE POLICY "Admins and instructors can create invitations"
  ON invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'admin' OR get_user_role() = 'instructor'
  );

CREATE POLICY "Admins and instructors can update invitations"
  ON invitations
  FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'admin' OR get_user_role() = 'instructor'
  );

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
