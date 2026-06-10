-- Allow in-flight draft training records to be started before an aircraft/flight log exists.
-- Submitted records that are attached to a logged flight continue to carry aircraft details.

ALTER TABLE public.training_records
  ALTER COLUMN aircraft_id DROP NOT NULL,
  ALTER COLUMN aircraft_type SET DEFAULT '',
  ALTER COLUMN registration SET DEFAULT '';

