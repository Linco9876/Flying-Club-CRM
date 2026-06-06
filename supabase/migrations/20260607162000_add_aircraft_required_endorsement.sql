alter table public.aircraft
  add column if not exists required_endorsement_type text;

comment on column public.aircraft.required_endorsement_type is
  'Optional endorsement type required for solo hire without instructor. Missing endorsement creates a pending approval booking.';
