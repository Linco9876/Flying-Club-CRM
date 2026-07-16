create index if not exists instructor_schedule_changes_instructor_id_idx
  on public.instructor_schedule_changes (instructor_id);

create index if not exists instructor_schedule_changes_user_id_idx
  on public.instructor_schedule_changes (user_id);

drop policy if exists "Admins can insert any instructor weekly schedule" on public.instructor_weekly_schedules;
drop policy if exists "Admins can update any instructor weekly schedule" on public.instructor_weekly_schedules;
drop policy if exists "Admins can delete any instructor weekly schedule" on public.instructor_weekly_schedules;
drop policy if exists "Instructors can insert own weekly schedule" on public.instructor_weekly_schedules;
drop policy if exists "Instructors can update own weekly schedule" on public.instructor_weekly_schedules;
drop policy if exists "Instructors can delete own weekly schedule" on public.instructor_weekly_schedules;

create policy "Staff can insert permitted weekly schedules"
  on public.instructor_weekly_schedules for insert to authenticated
  with check (
    public.current_user_is_admin()
    or (
      coalesce(user_id, instructor_id) = (select auth.uid())
      and public.current_user_has_staff_role()
    )
  );

create policy "Staff can update permitted weekly schedules"
  on public.instructor_weekly_schedules for update to authenticated
  using (
    public.current_user_is_admin()
    or (
      coalesce(user_id, instructor_id) = (select auth.uid())
      and public.current_user_has_staff_role()
    )
  )
  with check (
    public.current_user_is_admin()
    or (
      coalesce(user_id, instructor_id) = (select auth.uid())
      and public.current_user_has_staff_role()
    )
  );

create policy "Staff can delete permitted weekly schedules"
  on public.instructor_weekly_schedules for delete to authenticated
  using (
    public.current_user_is_admin()
    or (
      coalesce(user_id, instructor_id) = (select auth.uid())
      and public.current_user_has_staff_role()
    )
  );

drop policy if exists "Admins can insert any instructor schedule change" on public.instructor_schedule_changes;
drop policy if exists "Admins can update any instructor schedule change" on public.instructor_schedule_changes;
drop policy if exists "Admins can delete any instructor schedule change" on public.instructor_schedule_changes;
drop policy if exists "Instructors can insert own schedule change" on public.instructor_schedule_changes;
drop policy if exists "Instructors can update own schedule change" on public.instructor_schedule_changes;
drop policy if exists "Instructors can delete own schedule change" on public.instructor_schedule_changes;

create policy "Staff can insert permitted schedule changes"
  on public.instructor_schedule_changes for insert to authenticated
  with check (
    public.current_user_is_admin()
    or (
      coalesce(user_id, instructor_id) = (select auth.uid())
      and public.current_user_has_staff_role()
    )
  );

create policy "Staff can update permitted schedule changes"
  on public.instructor_schedule_changes for update to authenticated
  using (
    public.current_user_is_admin()
    or (
      coalesce(user_id, instructor_id) = (select auth.uid())
      and public.current_user_has_staff_role()
    )
  )
  with check (
    public.current_user_is_admin()
    or (
      coalesce(user_id, instructor_id) = (select auth.uid())
      and public.current_user_has_staff_role()
    )
  );

create policy "Staff can delete permitted schedule changes"
  on public.instructor_schedule_changes for delete to authenticated
  using (
    public.current_user_is_admin()
    or (
      coalesce(user_id, instructor_id) = (select auth.uid())
      and public.current_user_has_staff_role()
    )
  );
