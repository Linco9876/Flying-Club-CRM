ALTER TABLE public.training_syllabus_settings
  ADD COLUMN IF NOT EXISTS medical_types jsonb NOT NULL DEFAULT
    '[
      {"id":"raaus-medical-declaration","name":"RAAus Medical Declaration","validityMode":"until_age","validUntilAge":75,"isActive":true},
      {"id":"driver-licence-medical","name":"Driver Licence Medical","validityMode":"expiry_date","isActive":true},
      {"id":"raaus-instructor-medical-med003","name":"RAAus Instructor Medical (MED003)","validityMode":"expiry_date","isActive":true},
      {"id":"casa-class-5","name":"CASA Class 5","validityMode":"expiry_date","isActive":true},
      {"id":"casa-basic-class-2","name":"CASA Basic Class 2","validityMode":"expiry_date","isActive":true},
      {"id":"casa-class-2","name":"CASA Class 2","validityMode":"expiry_date","isActive":true},
      {"id":"casa-class-1","name":"CASA Class 1","validityMode":"expiry_date","isActive":true}
    ]'::jsonb;

UPDATE public.training_syllabus_settings
SET medical_types = '[]'::jsonb
WHERE medical_types IS NULL OR jsonb_typeof(medical_types) <> 'array';

ALTER TABLE public.training_syllabus_settings
  DROP CONSTRAINT IF EXISTS training_syllabus_settings_medical_types_array_check;

ALTER TABLE public.training_syllabus_settings
  ADD CONSTRAINT training_syllabus_settings_medical_types_array_check
  CHECK (jsonb_typeof(medical_types) = 'array');

COMMENT ON COLUMN public.training_syllabus_settings.medical_types IS
  'Organisation-managed operating medical types. Each type is valid to a member-entered expiry date or until a configured age.';

ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS medical_requirement_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS medical_requirement_age smallint;

ALTER TABLE public.training_courses
  DROP CONSTRAINT IF EXISTS training_courses_medical_requirement_mode_check,
  DROP CONSTRAINT IF EXISTS training_courses_medical_requirement_age_check;

ALTER TABLE public.training_courses
  ADD CONSTRAINT training_courses_medical_requirement_mode_check
    CHECK (medical_requirement_mode IN ('none', 'required', 'age_threshold')),
  ADD CONSTRAINT training_courses_medical_requirement_age_check
    CHECK (
      medical_requirement_mode <> 'age_threshold'
      OR medical_requirement_age BETWEEN 1 AND 120
    );

COMMENT ON COLUMN public.training_courses.medical_requirement_mode IS
  'Whether enrolled students need no medical, always need a medical, or need one from a configured age.';

COMMENT ON COLUMN public.training_courses.medical_requirement_age IS
  'Inclusive age at which a medical becomes required when medical_requirement_mode is age_threshold.';
