# Security exceptions

This register records deliberately accepted security design exceptions. An exception does not remove the underlying risk; it records why the design is temporarily required, the controls that limit it, who owns the decision and when it must be reviewed.

## SEC-EXC-001 — owner-evaluated member calendar projection

| Field | Decision |
| --- | --- |
| Status | Active |
| Accepted | 3 August 2026, requested by Lincoln Cottingham as CRM owner |
| Risk owner | Bendigo Flying Club CRM owner; committee review is required if the scope expands |
| Review by | 3 November 2026, and before any change to the projected columns or access helper |
| Affected object | `public.calendar_booking_public` |
| Exception | The view uses `security_invoker = false`, so PostgreSQL evaluates its underlying reads with the view owner's privileges instead of the caller's booking-table RLS policies. |

### Business reason

Pilots and students with full portal access need shared calendar occupancy so they can avoid booking conflicts. The normal `bookings` RLS policy intentionally prevents them from reading another person's complete booking. A narrow owner-evaluated projection supplies the operational occupancy fields while masking private booking, billing, voucher, guest and note content.

### Data exposed and masked

An eligible signed-in member can see booking ID, student/instructor/aircraft identifiers, start and end time, status, conflict/deletion/flight-logged flags, whether the booking is for a guest, and the instructor's display name. Payment type, notes, flight type, voucher identifier, guest contact details and hirer name remain `NULL` unless the caller is staff or owns the booking.

The view is not public internet access. `anon` has no privilege, `authenticated` has `SELECT` only, and the query returns rows only when `current_user_has_full_portal_access()` succeeds.

### Risk

- The view deliberately bypasses the underlying booking-table RLS policy.
- An authorised member can correlate stable identifiers and shared calendar occupancy.
- A future projection or access-helper change could unintentionally expose private fields to every full-portal member.
- A view-owner or helper-function compromise would increase the disclosure impact.

### Compensating controls

- `REVOKE ALL ... FROM anon`; no unauthenticated read path.
- `SELECT` is the only privilege granted to normal authenticated users.
- `security_barrier = true` prevents unsafe predicate pushdown through the masking boundary.
- A full-portal access check is evaluated inside the view for every query.
- The projection explicitly masks private fields for non-staff viewers who do not own the booking.
- The frontend uses the masked view only for non-staff shared-calendar reads; writes continue through protected booking paths.
- Migration review, CodeQL, database migration audit and authenticated role acceptance are required before release.

### Required review and exit criteria

At each review, confirm the live grants, view definition, projected columns, access helper and representative member/staff masking results. Revoke the exception immediately if anonymous access appears or a private field is disclosed.

The preferred long-term replacement is a versioned, narrowly parameterised calendar-occupancy RPC with an explicit return type, internal authorisation, fixed `search_path`, row limits and database integration tests for anonymous, member, owner and staff callers. Remove this exception after the replacement has passed those tests and the view has been revoked.
