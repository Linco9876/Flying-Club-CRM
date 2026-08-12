-- Restored projects can retain the student-documents bucket and table policies
-- while losing the matching storage.objects policies. Recreate the complete
-- private-bucket policy set. Staff access requires the normal MFA assurance;
-- full portal members remain limited to their own UUID folder.

drop policy if exists "Full students and staff can read student document files" on storage.objects;
create policy "Full students and staff can read student document files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-documents'
  and (
    (
      public.current_user_has_staff_role()
      and public.staff_session_has_required_assurance()
    )
    or (
      public.current_user_has_full_portal_access()
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  )
);

drop policy if exists "Full students and staff can upload student document files" on storage.objects;
create policy "Full students and staff can upload student document files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'student-documents'
  and array_length(storage.foldername(name), 1) >= 2
  and (
    (
      public.current_user_has_staff_role()
      and public.staff_session_has_required_assurance()
    )
    or (
      public.current_user_has_full_portal_access()
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  )
);

drop policy if exists "Full students and staff can delete student document files" on storage.objects;
create policy "Full students and staff can delete student document files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'student-documents'
  and (
    (
      public.current_user_has_staff_role()
      and public.staff_session_has_required_assurance()
    )
    or (
      public.current_user_has_full_portal_access()
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  )
);
