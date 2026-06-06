/*
  Add course-level flying declarations and student signatures.

  Courses can require an electronic declaration before a student proceeds with
  training. The student_course_enrolments row stores the signed snapshot so
  later wording changes do not rewrite what the student agreed to.
*/

alter table public.training_courses
  add column if not exists requires_flying_declaration boolean not null default false,
  add column if not exists flying_declaration_title text not null default 'Flying Declaration',
  add column if not exists flying_declaration_text text not null default '',
  add column if not exists flying_declaration_version integer not null default 1;

alter table public.student_course_enrolments
  add column if not exists declaration_signed_at timestamptz,
  add column if not exists declaration_signed_name text,
  add column if not exists declaration_member_number text,
  add column if not exists declaration_text_snapshot text,
  add column if not exists declaration_version integer;

drop policy if exists "Students can sign own course declarations" on public.student_course_enrolments;

create policy "Students can sign own course declarations"
  on public.student_course_enrolments for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

update public.training_courses
set
  requires_flying_declaration = true,
  flying_declaration_title = 'Flying Declaration',
  flying_declaration_text = 'Persons undertaking flying training and other types of flying in recreational aircraft are advised that there are risks involved.

These risks cannot be specifically quantified; however, recreational aircraft used for pilot training and private flight are constructed, operated and maintained under exemptions from the regulations.

These exemptions are from the regulations that apply to CASA registered aircraft. Whilst similar rule sets apply to our organisation and replace those that we are exempt from, it must be accepted that the overall safety of recreational flying is generally below the well-known commercial air transport standards in Australia.

I, ________________________________, Member Number: __________________ declare that I am aware of and understand the risks involved in recreational flying training.',
  flying_declaration_version = greatest(coalesce(flying_declaration_version, 1), 1),
  last_updated = now()
where title in ('RAAus Ab-Initio RPC', 'RAAus Ab-Initio RPC - Group A (3-Axis)');
