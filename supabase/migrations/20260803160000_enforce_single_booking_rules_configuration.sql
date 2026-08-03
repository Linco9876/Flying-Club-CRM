-- The portal and server-side booking checks both treat this table as a
-- singleton. Retain the most recently updated configuration if historical
-- writes created duplicates, then prevent the ambiguity recurring.

do $$
begin
  lock table public.booking_rules_settings in share row exclusive mode;

  with ranked_settings as (
    select
      id,
      row_number() over (
        order by updated_at desc nulls last, created_at desc nulls last, id desc
      ) as row_rank
    from public.booking_rules_settings
  )
  delete from public.booking_rules_settings settings
  using ranked_settings ranked
  where settings.id = ranked.id
    and ranked.row_rank > 1;

  create unique index if not exists booking_rules_settings_singleton_idx
    on public.booking_rules_settings ((true));
end
$$;

comment on index public.booking_rules_settings_singleton_idx is
  'Enforces the single booking and fatigue rules configuration expected by portal and database enforcement.';
