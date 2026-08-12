create or replace function private.require_published_review_import_form()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.record_type = 'review' and not exists (
    select 1
    from public.training_courses course
    where course.id = new.course_id
      and course.status = 'published'
      and course.course_purpose in ('flight_review', 'flight_test', 'proficiency_check')
  ) then
    raise exception 'Choose a published review or test form before importing records.';
  end if;

  return new;
end;
$$;

revoke all on function private.require_published_review_import_form()
from public, anon, authenticated, service_role;

drop trigger if exists require_published_review_import_form
on public.student_record_import_batches;

create trigger require_published_review_import_form
before insert or update of record_type, course_id
on public.student_record_import_batches
for each row
execute function private.require_published_review_import_form();

comment on function private.require_published_review_import_form() is
  'Prevents historical review/test imports from using draft or non-review course configurations.';

select private.assert_function_permission_manifest();
