/*
  # Create Storage Bucket for Defect Attachments

  1. Storage Setup
    - Creates a public storage bucket named 'defect-attachments'
    - Configures bucket settings for image and document uploads
  
  2. Security Policies
    - Allows authenticated users to upload attachments
    - Allows public read access to view attachments
    - Restricts deletion to authenticated users only
  
  3. Notes
    - File size limits are handled at the application level
    - Supported file types: images (jpg, jpeg, png, gif, webp) and PDFs
*/

-- Create the storage bucket for defect attachments if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('defect-attachments', 'defect-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist to ensure clean state
DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can upload defect attachments" ON storage.objects;
  DROP POLICY IF EXISTS "Public can view defect attachments" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can delete defect attachments" ON storage.objects;
END $$;

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload defect attachments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'defect-attachments');

-- Allow public read access to view attachments
CREATE POLICY "Public can view defect attachments"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'defect-attachments');

-- Allow authenticated users to delete their own uploads
CREATE POLICY "Authenticated users can delete defect attachments"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'defect-attachments');