create index if not exists idx_flight_logs_aircraft_end_time
  on public.flight_logs (aircraft_id, end_time desc);
