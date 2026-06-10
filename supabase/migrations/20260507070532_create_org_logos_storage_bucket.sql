/*
  # Create org-logos storage bucket

  A public bucket for the business/organisation logo so it can be displayed
  without authentication. Admins can upload/update; anyone can read.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('org-logos', 'org-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Admins can upload / replace the logo
CREATE POLICY "Admins can upload org logo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update org logo"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

-- Anyone (including anon) can read the public logo
CREATE POLICY "Public can read org logo"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'org-logos');
