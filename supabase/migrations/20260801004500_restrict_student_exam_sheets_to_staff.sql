-- Uploaded exam/answer sheets may contain the questions, model answers and
-- instructor markings. Students can see their result and feedback in
-- student_exam_results, but the source file is staff-only evidence.

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

-- Require the same assurance level for every mutation of this sensitive
-- bucket so an AAL1 shared/kiosk session cannot upload, replace or remove exam
-- evidence even if it belongs to a staff identity.
drop policy if exists "Staff can upload student exam files" on storage.objects;
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
create policy "Owner instructor or admin with MFA can update student exam files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'student-exam-uploads'
  and public.staff_session_has_required_assurance()
  and (
    exists (
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

drop policy if exists "Owner instructor or admin can delete student exam files" on storage.objects;
create policy "Owner instructor or admin with MFA can delete student exam files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'student-exam-uploads'
  and public.staff_session_has_required_assurance()
  and (
    exists (
      select 1
      from public.student_exam_results result
      where result.storage_path = storage.objects.name
        and result.instructor_id = (select auth.uid())
    )
    or public.current_user_is_admin()
  )
);
