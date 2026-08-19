-- A single RAAus training flight can contain both a dual segment and a
-- supervised solo segment. Keep the student allocation explicit and prevent
-- clients from double-counting or losing part of the aircraft flight time.
ALTER TABLE public.flight_logs
  DROP CONSTRAINT IF EXISTS flight_logs_student_time_allocation_check;

ALTER TABLE public.flight_logs
  ADD CONSTRAINT flight_logs_student_time_allocation_check
  CHECK (
    coalesce(dual_time, 0) >= 0
    AND coalesce(solo_time, 0) >= 0
    AND (
      flight_duration IS NULL
      OR (
        flight_duration >= 0
        AND abs(
          coalesce(dual_time, 0)
          + coalesce(solo_time, 0)
          - flight_duration
        ) <= 0.051
      )
    )
  ) NOT VALID;

ALTER TABLE public.flight_logs
  VALIDATE CONSTRAINT flight_logs_student_time_allocation_check;

COMMENT ON CONSTRAINT flight_logs_student_time_allocation_check
  ON public.flight_logs IS
  'Student dual plus solo/PIC time must equal the logged aircraft flight duration, within half of one decimal-hour increment.';
