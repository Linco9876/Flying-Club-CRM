/*
  Keep the safety occurrence register reachable through the Data API only with
  the privileges required by the application. RLS remains the row-level gate.
*/

REVOKE ALL ON TABLE public.safety_reports FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.safety_reports FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.safety_reports TO authenticated;
