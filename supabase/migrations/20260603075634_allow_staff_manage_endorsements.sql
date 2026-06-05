do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'endorsements'
      and policyname = 'Staff can insert endorsements'
  ) then
    create policy "Staff can insert endorsements"
      on public.endorsements
      for insert
      to authenticated
      with check (
        exists (
          select 1
          from public.user_roles
          where user_roles.user_id = auth.uid()
            and user_roles.role in ('admin', 'instructor', 'senior_instructor')
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'endorsements'
      and policyname = 'Staff can update endorsements'
  ) then
    create policy "Staff can update endorsements"
      on public.endorsements
      for update
      to authenticated
      using (
        exists (
          select 1
          from public.user_roles
          where user_roles.user_id = auth.uid()
            and user_roles.role in ('admin', 'instructor', 'senior_instructor')
        )
      )
      with check (
        exists (
          select 1
          from public.user_roles
          where user_roles.user_id = auth.uid()
            and user_roles.role in ('admin', 'instructor', 'senior_instructor')
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'endorsements'
      and policyname = 'Staff can delete endorsements'
  ) then
    create policy "Staff can delete endorsements"
      on public.endorsements
      for delete
      to authenticated
      using (
        exists (
          select 1
          from public.user_roles
          where user_roles.user_id = auth.uid()
            and user_roles.role in ('admin', 'instructor', 'senior_instructor')
        )
      );
  end if;
end $$;
