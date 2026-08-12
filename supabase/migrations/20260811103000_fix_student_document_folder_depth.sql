-- storage.foldername('student-uuid/file.ext') returns the parent folders only,
-- so a valid student document path has one folder entry. Keep the UUID-folder
-- ownership checks and remove the incorrect two-folder minimum.

drop policy if exists "Full students and staff can upload student document files" on storage.objects;
create policy "Full students and staff can upload student document files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] is not null
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
