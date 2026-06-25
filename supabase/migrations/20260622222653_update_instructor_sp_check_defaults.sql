-- Reconstructed from remote supabase_migrations.schema_migrations history.
-- This file preserves migration history so local Git and the linked database agree.

ALTER TABLE public.safety_compliance_settings
  ALTER COLUMN instructor_sop_check_months SET DEFAULT 3,
  ALTER COLUMN senior_instructor_sop_check_months SET DEFAULT 12;

UPDATE public.safety_compliance_settings
SET
  instructor_sop_check_months = 3,
  senior_instructor_sop_check_months = 12,
  updated_at = now()
WHERE coalesce(instructor_sop_check_months, 12) = 12
  AND coalesce(senior_instructor_sop_check_months, 24) = 24;

