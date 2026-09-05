-- Endorsements can be known and operationally valid even when their original
-- issue date is unavailable. Preserve dates when supplied, but do not invent
-- one solely to satisfy storage constraints.
ALTER TABLE public.endorsements
  ALTER COLUMN date_obtained DROP NOT NULL;

COMMENT ON COLUMN public.endorsements.date_obtained IS
  'Optional original issue date. Null means the endorsement is recorded but its issue date is unknown.';
