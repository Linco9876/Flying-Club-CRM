/*
  Keep instructor_absences compatible with both historical schema names.

  Older migrations created user_id, newer ones created instructor_id, and the
  current RLS policies check instructor_id. The app writes both, and this
  trigger keeps either entry path in sync.
*/

ALTER TABLE public.instructor_absences
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.instructor_absences
ADD COLUMN IF NOT EXISTS instructor_id uuid REFERENCES public.users(id) ON DELETE CASCADE;

UPDATE public.instructor_absences
SET user_id = instructor_id
WHERE user_id IS NULL
  AND instructor_id IS NOT NULL;

UPDATE public.instructor_absences
SET instructor_id = user_id
WHERE instructor_id IS NULL
  AND user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_instructor_absence_identity_columns()
RETURNS trigger AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := NEW.instructor_id;
  END IF;

  IF NEW.instructor_id IS NULL THEN
    NEW.instructor_id := NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_instructor_absence_identity_columns_trigger
ON public.instructor_absences;

CREATE TRIGGER sync_instructor_absence_identity_columns_trigger
BEFORE INSERT OR UPDATE ON public.instructor_absences
FOR EACH ROW
EXECUTE FUNCTION public.sync_instructor_absence_identity_columns();
