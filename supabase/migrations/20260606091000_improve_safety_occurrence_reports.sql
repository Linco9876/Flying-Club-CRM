/*
  Improve safety occurrence reporting for flying school and flying club operations.

  Adds the operational fields needed for useful incident, accident, near miss,
  hazard and risk-assessment records while preserving existing reports.
*/

alter table public.safety_reports
  add column if not exists occurrence_at timestamptz,
  add column if not exists aircraft_id uuid references public.aircraft(id) on delete set null,
  add column if not exists phase_of_flight text,
  add column if not exists witnesses text,
  add column if not exists injury_reported boolean not null default false,
  add column if not exists damage_reported boolean not null default false,
  add column if not exists reportable_to_authority boolean not null default false,
  add column if not exists corrective_action text,
  add column if not exists closed_at timestamptz;

do $$
declare
  constraint_name text;
begin
  select conname
  into constraint_name
  from pg_constraint
  where conrelid = 'public.safety_reports'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%report_type%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.safety_reports drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.safety_reports
  add constraint safety_reports_report_type_check
  check (report_type in ('incident', 'hazard', 'risk_assessment', 'near_miss', 'accident'));

create index if not exists idx_safety_reports_occurrence_at
  on public.safety_reports(occurrence_at desc);

create index if not exists idx_safety_reports_aircraft_id
  on public.safety_reports(aircraft_id);
