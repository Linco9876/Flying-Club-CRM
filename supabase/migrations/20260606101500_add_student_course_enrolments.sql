/*
  Add explicit student course enrolments.

  Course progress was previously inferred only from training records. This table
  lets staff enrol a student in a course before the first lesson has been logged.
*/

create table if not exists public.student_course_enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id) on delete cascade,
  course_id uuid not null references public.training_courses(id) on delete cascade,
  enrolled_by uuid references public.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'completed', 'withdrawn')),
  notes text,
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, course_id)
);

alter table public.student_course_enrolments enable row level security;

create index if not exists idx_student_course_enrolments_student_id
  on public.student_course_enrolments(student_id);

create index if not exists idx_student_course_enrolments_course_id
  on public.student_course_enrolments(course_id);

drop policy if exists "Users can read relevant course enrolments" on public.student_course_enrolments;
drop policy if exists "Staff can manage course enrolments" on public.student_course_enrolments;

create policy "Users can read relevant course enrolments"
  on public.student_course_enrolments for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.users
      where id = (select auth.uid())
        and role in ('admin', 'instructor', 'senior_instructor')
    )
    or exists (
      select 1 from public.user_roles
      where user_id = (select auth.uid())
        and role in ('admin', 'instructor', 'senior_instructor')
    )
  );

create policy "Staff can manage course enrolments"
  on public.student_course_enrolments for all to authenticated
  using (
    exists (
      select 1 from public.users
      where id = (select auth.uid())
        and role in ('admin', 'instructor', 'senior_instructor')
    )
    or exists (
      select 1 from public.user_roles
      where user_id = (select auth.uid())
        and role in ('admin', 'instructor', 'senior_instructor')
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = (select auth.uid())
        and role in ('admin', 'instructor', 'senior_instructor')
    )
    or exists (
      select 1 from public.user_roles
      where user_id = (select auth.uid())
        and role in ('admin', 'instructor', 'senior_instructor')
    )
  );

grant select, insert, update, delete on table public.student_course_enrolments to authenticated;
