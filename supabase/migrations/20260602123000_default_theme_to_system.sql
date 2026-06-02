-- Make system light/dark the default while preserving the ability for users
-- to choose a fixed light or dark theme later from their preferences.
update public.portal_ux_settings
set theme = 'auto'
where theme is null or theme = 'light';

update public.user_preferences
set
  theme = 'auto',
  preferences = coalesce(preferences, '{}'::jsonb) || jsonb_build_object('theme', 'auto')
where theme is null or theme = 'light';
