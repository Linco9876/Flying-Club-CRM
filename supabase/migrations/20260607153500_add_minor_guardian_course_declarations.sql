/*
  Add under-18 parent/guardian declaration support for course declarations.

  The course stores editable parent/guardian declaration wording. The enrolment
  stores a separate guardian signature snapshot when the student is under 18.
*/

alter table public.training_courses
  add column if not exists requires_guardian_declaration_for_minors boolean not null default true,
  add column if not exists guardian_declaration_title text not null default 'Under 18 Years - Parent/Guardian Declaration',
  add column if not exists guardian_declaration_text text not null default '';

alter table public.student_course_enrolments
  add column if not exists guardian_declaration_signed_at timestamptz,
  add column if not exists guardian_declaration_signed_name text,
  add column if not exists guardian_declaration_relationship text,
  add column if not exists guardian_declaration_email text,
  add column if not exists guardian_declaration_phone text,
  add column if not exists guardian_declaration_text_snapshot text,
  add column if not exists guardian_declaration_version integer;

update public.training_courses
set
  requires_guardian_declaration_for_minors = true,
  guardian_declaration_title = 'Under 18 Years - Parent/Guardian Declaration',
  guardian_declaration_text = 'I, ____________________________________ (the parent or legal guardian of the applicant named above) declare that I am aware of and understand the risks involved in recreational flying training.

I give consent for the above applicant to undertake such training. I am aware RAAus has a policy in place for working with children and vulnerable people. This policy is available from RAAus on request.

Parent/Guardian Signature: ______________________________, Date: _______________________

*Only required to be filled in when member is under the age of 18 years.',
  last_updated = now()
where title in ('RAAus Ab-Initio RPC', 'RAAus Ab-Initio RPC - Group A (3-Axis)');
