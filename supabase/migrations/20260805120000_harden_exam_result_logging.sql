-- Keep exam logging aligned with the portal's canonical staff-role helper.
-- Older accounts may carry their valid staff role in public.users or JWT
-- metadata even when a legacy user_roles row is absent.
drop policy if exists "Staff can insert student exam results" on public.student_exam_results;

create policy "MFA staff can insert their student exam results"
on public.student_exam_results
for insert
to authenticated
with check (
  public.current_user_has_staff_role()
  and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  and instructor_id = (select auth.uid())
  and record_origin = 'portal'
  and import_batch_id is null
  and imported_by is null
  and import_source_row is null
);

-- Use the same canonical role helper for the MFA boundary. This closes the
-- inverse mismatch where a legacy staff account recognised through
-- public.users could otherwise be treated as a non-staff AAL1 session.
create or replace function public.staff_session_has_required_assurance()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    auth.role() = 'service_role'
    or not public.current_user_has_staff_role()
    or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke all on function public.staff_session_has_required_assurance() from public, anon;
grant execute on function public.staff_session_has_required_assurance() to authenticated, service_role;

-- A failed insert, an edited attachment, or a deleted result can leave the
-- answer sheet without a matching database row. Let an MFA-verified staff
-- uploader remove their own object so cleanup is reliable without expanding
-- access to anyone else's evidence.
drop policy if exists "Owner instructor or admin with MFA can delete student exam files" on storage.objects;

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

select private.assert_function_permission_manifest();
