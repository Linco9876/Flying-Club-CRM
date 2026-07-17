CREATE INDEX IF NOT EXISTS idx_flight_review_records_template_course
  ON public.flight_review_records(template_course_id);
CREATE INDEX IF NOT EXISTS idx_flight_review_records_booking
  ON public.flight_review_records(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flight_review_records_flight_log
  ON public.flight_review_records(flight_log_id) WHERE flight_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flight_review_records_aircraft
  ON public.flight_review_records(aircraft_id) WHERE aircraft_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flight_review_records_created_by
  ON public.flight_review_records(created_by);
CREATE INDEX IF NOT EXISTS idx_flight_review_records_updated_by
  ON public.flight_review_records(updated_by) WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flight_review_attachments_candidate
  ON public.flight_review_attachments(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flight_review_attachments_uploaded_by
  ON public.flight_review_attachments(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_flight_review_audit_actor
  ON public.flight_review_record_audit(actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;
