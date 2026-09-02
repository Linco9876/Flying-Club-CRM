alter table public.instructor_absences
  add column if not exists updated_at timestamptz not null default now();

comment on column public.instructor_absences.updated_at is
  'Time this instructor absence was most recently changed.';

create or replace function private.touch_instructor_absence_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_instructor_absence_updated_at() from public, anon, authenticated;
grant execute on function private.touch_instructor_absence_updated_at() to service_role;

drop trigger if exists touch_instructor_absence_updated_at on public.instructor_absences;
create trigger touch_instructor_absence_updated_at
before update on public.instructor_absences
for each row execute function private.touch_instructor_absence_updated_at();
