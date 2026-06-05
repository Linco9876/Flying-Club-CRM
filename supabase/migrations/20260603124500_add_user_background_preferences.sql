/*
  Add personal portal background preferences.
*/

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS background_image_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS background_filter_color text DEFAULT '#0f172a',
  ADD COLUMN IF NOT EXISTS background_filter_opacity integer DEFAULT 72;

UPDATE public.user_preferences
SET
  background_image_url = COALESCE(background_image_url, ''),
  background_filter_color = COALESCE(background_filter_color, '#0f172a'),
  background_filter_opacity = COALESCE(background_filter_opacity, 72);

