alter table public.endorsements
  drop constraint if exists endorsements_type_check;

alter table public.endorsements
  alter column type set not null;

alter table public.endorsements
  drop constraint if exists endorsements_type_not_blank;

alter table public.endorsements
  add constraint endorsements_type_not_blank
  check (length(trim(type)) > 0)
  not valid;

alter table public.endorsements
  validate constraint endorsements_type_not_blank;

notify pgrst, 'reload schema';
