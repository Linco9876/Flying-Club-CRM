-- Guard self-service member updates against role, identity, and balance escalation.

create or replace function public.current_user_has_staff_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'instructor', 'senior_instructor')
  );
$$;

revoke execute on function public.current_user_has_staff_role() from public, anon, authenticated;

create or replace function public.guard_users_self_service_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.current_user_has_staff_role() then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.role is distinct from old.role
      or new.is_senior_instructor is distinct from old.is_senior_instructor
      or new.is_active is distinct from old.is_active
      or new.created_at is distinct from old.created_at then
      raise exception 'Only staff can change protected member fields';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_users_self_service_update() from public, anon, authenticated;

drop trigger if exists guard_users_self_service_update on public.users;
create trigger guard_users_self_service_update
before update on public.users
for each row
execute function public.guard_users_self_service_update();

drop policy if exists "Users can insert own user record" on public.users;
create policy "Users can insert own safe user record"
on public.users
for insert
to authenticated
with check (
  id = auth.uid()
  and role in ('student', 'pilot')
  and coalesce(is_senior_instructor, false) = false
  and coalesce(is_active, true) = true
);

create or replace function public.guard_students_self_service_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.current_user_has_staff_role() then
    if new.id is distinct from old.id
      or new.prepaid_balance is distinct from old.prepaid_balance
      or new.last_flight_review is distinct from old.last_flight_review
      or new.created_at is distinct from old.created_at then
      raise exception 'Only staff can change protected student fields';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_students_self_service_update() from public, anon, authenticated;

drop trigger if exists guard_students_self_service_update on public.students;
create trigger guard_students_self_service_update
before update on public.students
for each row
execute function public.guard_students_self_service_update();

drop policy if exists "Users can insert own student record" on public.students;
create policy "Users can insert own safe student profile row"
on public.students
for insert
to authenticated
with check (
  id = auth.uid()
  and coalesce(prepaid_balance, 0) = 0
  and last_flight_review is null
);

drop policy if exists "Users can insert endorsements" on public.endorsements;
drop policy if exists "Users can update own endorsements" on public.endorsements;
drop policy if exists "Users can delete own endorsements" on public.endorsements;
