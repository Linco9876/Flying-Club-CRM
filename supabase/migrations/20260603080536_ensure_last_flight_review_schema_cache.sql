alter table public.students
  add column if not exists last_flight_review date;

comment on column public.students.last_flight_review is 'Date of last biennial flight review (BFR)';

notify pgrst, 'reload schema';
