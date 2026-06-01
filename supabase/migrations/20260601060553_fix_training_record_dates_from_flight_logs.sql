/*
  Fix training record dates that were saved one day early by UTC conversion.

  Training records are date-only entries and should match the local flight day
  in Australia/Sydney, not the UTC date component of the booking/flight time.
*/

UPDATE training_records tr
SET date = (fl.start_time AT TIME ZONE 'Australia/Sydney')::date
FROM flight_logs fl
WHERE tr.flight_log_id = fl.id
  AND tr.date IS DISTINCT FROM (fl.start_time AT TIME ZONE 'Australia/Sydney')::date;
