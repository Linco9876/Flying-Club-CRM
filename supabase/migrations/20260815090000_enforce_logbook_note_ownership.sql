comment on table public.logbook_entry_notes is
  'Notes saved by a logbook owner against flights in their own logbook. Authorised staff may read but not change them.';
comment on column public.logbook_entry_notes.user_id is
  'The owner of both the logbook and note. Only this authenticated user may insert, update or delete the note.';

drop policy if exists "Users can read own logbook notes" on public.logbook_entry_notes;
drop policy if exists "Logbook owners and staff can read notes" on public.logbook_entry_notes;
create policy "Logbook owners and staff can read notes"
  on public.logbook_entry_notes
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_has_staff_role()
  );

drop policy if exists "Users can create own logbook notes" on public.logbook_entry_notes;
drop policy if exists "Logbook owners can create notes" on public.logbook_entry_notes;
create policy "Logbook owners can create notes"
  on public.logbook_entry_notes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.flight_logs flight
      where flight.id = flight_log_id
        and (flight.student_id = auth.uid() or flight.instructor_id = auth.uid())
    )
  );

drop policy if exists "Users can update own logbook notes" on public.logbook_entry_notes;
drop policy if exists "Logbook owners can update notes" on public.logbook_entry_notes;
create policy "Logbook owners can update notes"
  on public.logbook_entry_notes
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.flight_logs flight
      where flight.id = flight_log_id
        and (flight.student_id = auth.uid() or flight.instructor_id = auth.uid())
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.flight_logs flight
      where flight.id = flight_log_id
        and (flight.student_id = auth.uid() or flight.instructor_id = auth.uid())
    )
  );

drop policy if exists "Users can delete own logbook notes" on public.logbook_entry_notes;
drop policy if exists "Logbook owners can delete notes" on public.logbook_entry_notes;
create policy "Logbook owners can delete notes"
  on public.logbook_entry_notes
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.flight_logs flight
      where flight.id = flight_log_id
        and (flight.student_id = auth.uid() or flight.instructor_id = auth.uid())
    )
  );
