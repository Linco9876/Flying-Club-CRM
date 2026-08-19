-- Senior instructors and CFIs use the instructor booking form. Keep the stored
-- role configuration explicit as well as relying on the client-side hierarchy.
update public.booking_field_settings
set applies_to_roles = array(
  select distinct configured_role
  from unnest(
    applies_to_roles || array['senior_instructor', 'cfi']::text[]
  ) as configured_role
  order by configured_role
),
updated_at = now()
where 'instructor' = any(applies_to_roles)
  and (
    not ('senior_instructor' = any(applies_to_roles))
    or not ('cfi' = any(applies_to_roles))
  );
