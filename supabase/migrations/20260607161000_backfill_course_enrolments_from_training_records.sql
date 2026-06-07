/*
  Backfill explicit course enrolments from existing training records.

  Course declaration popups are driven by student_course_enrolments. If a
  training record was created before staff explicitly enrolled the student,
  the student still needs an active course enrolment so declaration-required
  courses can be signed on login.
*/

insert into public.student_course_enrolments (
  student_id,
  course_id,
  enrolled_by,
  status,
  notes,
  enrolled_at,
  updated_at
)
select
  tr.student_id,
  tr.course_id,
  (array_agg(tr.instructor_id order by coalesce(tr.instructor_sign_timestamp, tr.created_at, now()) asc))[1],
  'active',
  'Auto-enrolled from existing training record',
  min(coalesce(tr.instructor_sign_timestamp, tr.created_at, now())),
  now()
from public.training_records tr
join public.training_courses tc on tc.id = tr.course_id
where tr.student_id is not null
  and tr.course_id is not null
  and coalesce(tc.requires_flying_declaration, false) = true
group by tr.student_id, tr.course_id
on conflict (student_id, course_id) do update
set
  status = case
    when public.student_course_enrolments.status = 'withdrawn' then 'active'
    else public.student_course_enrolments.status
  end,
  notes = coalesce(public.student_course_enrolments.notes, excluded.notes),
  updated_at = now();
