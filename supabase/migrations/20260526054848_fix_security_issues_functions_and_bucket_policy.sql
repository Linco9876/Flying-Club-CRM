/*
  # Fix security issues

  1. Revoke public EXECUTE on SECURITY DEFINER functions
     - `notify_instructor_booking_request` — anon and authenticated should not call this directly
     - `sync_user_primary_role` — anon and authenticated should not call this directly
       (it is a trigger function, not an RPC endpoint)

  2. Remove broad SELECT policy on org-logos storage bucket
     - The policy "Public can read org logo" allows listing all files in the bucket
     - Object URLs work without a storage policy; remove to prevent directory enumeration
*/

-- Revoke EXECUTE from anon and authenticated on notify_instructor_booking_request
REVOKE EXECUTE ON FUNCTION public.notify_instructor_booking_request(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_instructor_booking_request(uuid) FROM authenticated;

-- Revoke EXECUTE from anon and authenticated on sync_user_primary_role
REVOKE EXECUTE ON FUNCTION public.sync_user_primary_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_user_primary_role() FROM authenticated;

-- Remove the overly-broad storage SELECT policy that allows listing the org-logos bucket
DROP POLICY IF EXISTS "Public can read org logo" ON storage.objects;
