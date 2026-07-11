alter table portal_ux_settings
  add column if not exists kiosk_theme text not null default 'day-night';

alter table portal_ux_settings
  drop constraint if exists portal_ux_settings_kiosk_theme_check;

alter table portal_ux_settings
  add constraint portal_ux_settings_kiosk_theme_check
  check (kiosk_theme in ('light', 'dark', 'day-night', 'auto'));

alter table user_preferences
  alter column theme set default 'auto';

update user_preferences
set
  theme = 'auto',
  preferences = coalesce(preferences, '{}'::jsonb) || jsonb_build_object('theme', 'auto')
where theme is null or theme = 'light';
