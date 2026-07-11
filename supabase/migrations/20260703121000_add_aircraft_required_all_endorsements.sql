alter table public.aircraft
  add column if not exists required_endorsement_all_types text[] not null default '{}'::text[];

comment on column public.aircraft.required_endorsement_all_types is
  'Aircraft solo-hire endorsement types where the member must hold every listed endorsement.';
