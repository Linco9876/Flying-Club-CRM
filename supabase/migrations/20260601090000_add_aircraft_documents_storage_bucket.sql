INSERT INTO storage.buckets (id, name, public)
VALUES ('aircraft-documents', 'aircraft-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can read aircraft document files" ON storage.objects;
CREATE POLICY "Authenticated users can read aircraft document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'aircraft-documents');

DROP POLICY IF EXISTS "Admins can upload aircraft document files" ON storage.objects;
CREATE POLICY "Admins can upload aircraft document files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'aircraft-documents'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update aircraft document files" ON storage.objects;
CREATE POLICY "Admins can update aircraft document files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'aircraft-documents'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'aircraft-documents'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete aircraft document files" ON storage.objects;
CREATE POLICY "Admins can delete aircraft document files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'aircraft-documents'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );
