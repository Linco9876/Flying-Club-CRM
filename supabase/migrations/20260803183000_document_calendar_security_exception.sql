-- SEC-EXC-001 is an explicitly accepted, time-limited exception documented in
-- docs/SECURITY_EXCEPTIONS.md. This migration changes metadata only; it does
-- not broaden the existing authenticated SELECT grant or projected columns.
COMMENT ON VIEW public.calendar_booking_public IS
  'SEC-EXC-001: owner-evaluated, security-barrier calendar occupancy projection for authenticated full-portal members. Private booking fields remain masked. Review by 2026-11-03; see docs/SECURITY_EXCEPTIONS.md.';
