-- A restored production database can retain the storage bucket and migration
-- history while missing individual storage policies. Recreate the complete
-- staff-only policy set so exam evidence remains private and usable.

drop policy if exists "Students and staff can read student exam files" on storage.objects;
drop policy if exists "Staff with MFA can read student exam files" on storage.objects;

create policy "Staff with MFA can read student exam files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-exam-uploads'
  and public.current_user_has_staff_role()
  and public.staff_session_has_required_assurance()
);

drop policy if exists "Staff can upload student exam files" on storage.objects;
drop policy if exists "Staff with MFA can upload student exam files" on storage.objects;

create policy "Staff with MFA can upload student exam files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'student-exam-uploads'
  and public.current_user_has_staff_role()
  and public.staff_session_has_required_assurance()
);

drop policy if exists "Owner instructor or admin can update student exam files" on storage.objects;
drop policy if exists "Owner instructor or admin with MFA can update student exam files" on storage.objects;

create policy "Owner instructor or admin with MFA can update student exam files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'student-exam-uploads'
  and public.current_user_has_staff_role()
  and public.staff_session_has_required_assurance()
  and (
    owner_id = (select auth.uid())::text
    or exists (
      select 1
      from public.student_exam_results result
      where result.storage_path = storage.objects.name
        and result.instructor_id = (select auth.uid())
    )
    or public.current_user_is_admin()
  )
)
with check (
  bucket_id = 'student-exam-uploads'
  and public.current_user_has_staff_role()
  and public.staff_session_has_required_assurance()
);

-- Keep deletion aligned with the restored read/write rules. The long policy
-- name is intentionally repeated: PostgreSQL resolves it consistently even
-- though identifiers are displayed truncated in catalog views.
drop policy if exists "Owner instructor or admin with MFA can delete student exam files" on storage.objects;
drop policy if exists "Uploader instructor or admin with MFA can delete student exam files" on storage.objects;

create policy "Uploader instructor or admin with MFA can delete student exam files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'student-exam-uploads'
  and public.current_user_has_staff_role()
  and public.staff_session_has_required_assurance()
  and (
    owner_id = (select auth.uid())::text
    or exists (
      select 1
      from public.student_exam_results result
      where result.storage_path = storage.objects.name
        and result.instructor_id = (select auth.uid())
    )
    or public.current_user_is_admin()
  )
);
