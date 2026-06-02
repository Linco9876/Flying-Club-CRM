alter table public.portal_ux_settings
  drop constraint if exists portal_ux_settings_theme_check;

alter table public.portal_ux_settings
  add constraint portal_ux_settings_theme_check
  check (theme in ('light', 'semi-dark', 'dark', 'auto'));

notify pgrst, 'reload schema';
