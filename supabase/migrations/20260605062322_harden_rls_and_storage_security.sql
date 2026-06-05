-- Tighten sensitive table reads, storage exposure, and definer function execution.

revoke execute on function public.promote_pilot_after_passed_flight_review() from public, anon, authenticated;
alter function public.sync_instructor_absence_identity_columns() set search_path = public;

update storage.buckets
set public = false
where id = 'defect-attachments';

drop policy if exists "Authenticated users can read users" on public.users;
drop policy if exists "Authenticated users can read students" on public.students;
drop policy if exists "Authenticated users can read training_records" on public.training_records;
drop policy if exists "Authenticated users can read training_sequence_results" on public.training_sequence_results;
drop policy if exists "Authenticated users can read flight_logs" on public.flight_logs;
drop policy if exists "Authenticated users can read endorsements" on public.endorsements;
drop policy if exists "Authenticated users can read invoices" on public.invoices;
drop policy if exists "Authenticated users can read invoice_items" on public.invoice_items;
drop policy if exists "Authenticated users can read invitations" on public.invitations;
drop policy if exists "Authenticated users can read maintenance_audit_log" on public.maintenance_audit_log;
drop policy if exists "Authenticated users can read student_syllabi" on public.student_syllabi;
drop policy if exists "Users can delete own user record" on public.users;
drop policy if exists "Users can delete own student record" on public.students;

create policy "Users and staff can read relevant member rows"
on public.users
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'instructor', 'senior_instructor')
  )
);

create policy "Users and staff can read relevant student rows"
on public.students
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'instructor', 'senior_instructor')
  )
);

create policy "Students instructors and staff can read relevant training records"
on public.training_records
for select
to authenticated
using (
  student_id = auth.uid()
  or instructor_id = auth.uid()
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'instructor', 'senior_instructor')
  )
);

create policy "Students instructors and staff can read relevant sequence results"
on public.training_sequence_results
for select
to authenticated
using (
  exists (
    select 1
    from public.training_records tr
    where tr.id = training_sequence_results.training_record_id
      and (
        tr.student_id = auth.uid()
        or tr.instructor_id = auth.uid()
        or exists (
          select 1 from public.user_roles
          where user_id = auth.uid()
            and role in ('admin', 'instructor', 'senior_instructor')
        )
      )
  )
);

create policy "Users and staff can read relevant flight logs"
on public.flight_logs
for select
to authenticated
using (
  student_id = auth.uid()
  or instructor_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'instructor', 'senior_instructor')
  )
);

create policy "Staff can read invitations"
on public.invitations
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'instructor', 'senior_instructor')
  )
);

create policy "Staff can read maintenance audit log"
on public.maintenance_audit_log
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'instructor', 'senior_instructor')
  )
);

create policy "Students and staff can read relevant student syllabi"
on public.student_syllabi
for select
to authenticated
using (
  student_id = auth.uid()
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'instructor', 'senior_instructor')
  )
);

revoke truncate on all tables in schema public from anon, authenticated;
