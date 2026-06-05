/*
  Replace personal background photos with a lightweight colour preference.
*/

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS background_color text DEFAULT '#f3f4f6';

UPDATE public.user_preferences
SET
  background_color = COALESCE(background_color, '#f3f4f6'),
  background_image_url = ''
WHERE background_image_url IS DISTINCT FROM ''
   OR background_color IS NULL;

