# Integration API and webhooks

The portal now has a versioned, server-to-server integration surface. It is intentionally separate from browser sessions and Supabase's general REST endpoint.

## API keys

Administrators create scoped keys in **Settings → Integrations → Developer API and webhooks** after MFA verification. A key is displayed once. Only its SHA-256 hash is stored.

Base URL:

```text
https://joarmzswpufrduectjse.supabase.co/functions/v1/integration-api/v1
```

Send the key as `Authorization: Bearer bfc_...`. Keys are rate-limited to 60 requests per minute, can be revoked immediately, and have separately assignable scopes.

Endpoints:

- `GET /aircraft` — serviceability and aircraft identity (`aircraft:read`)
- `POST /availability` — next conflict-free aircraft/instructor combinations (`availability:read`)
- `GET /bookings?changed_since=<ISO timestamp>` — up to 500 changed booking records without member names or contact details (`bookings:read`)

Availability request example:

```json
{
  "after": "2026-07-24T00:00:00Z",
  "durationMinutes": 120,
  "searchDays": 30,
  "aircraftIds": null,
  "instructorIds": null,
  "limit": 8
}
```

## Webhooks

Admins register public HTTPS endpoints and choose event types. The signing secret is displayed once. Delivery retries use exponential backoff for up to eight attempts, including temporary DNS resolution failures. Unsafe or non-allowlisted destinations are abandoned immediately. Each attempt uses an atomic five-minute delivery lease, so a worker interruption is reclaimed instead of leaving an event permanently stuck.

Delivery is fail-closed. The exact destination hostname must be listed in the Edge Function secret `INTEGRATION_WEBHOOK_ALLOWED_HOSTS` as a comma-separated allowlist. Immediately before every request, the worker resolves all available A and AAAA records and rejects the destination if any answer is loopback, link-local, private, reserved or otherwise non-public. The TLS connection is pinned to one of those validated addresses while the certificate and SNI are still checked against the approved hostname, closing the second-lookup DNS-rebinding window. Redirects and non-standard HTTPS ports are rejected. This allowlist is intentionally empty until a third-party integration has been approved.

Headers:

- `X-BFC-Event-Id` — stable delivery/event identifier; use it for idempotency
- `X-BFC-Event-Type` — for example `bookings.update`
- `X-BFC-Timestamp` — Unix seconds
- `X-BFC-Signature` — `v1=` followed by a hex HMAC-SHA256

Verify the signature over:

```text
<X-BFC-Timestamp>.<raw request body>
```

Reject stale timestamps and compare signatures in constant time. Respond with a 2xx status only after the event has been durably accepted.

The scheduled worker needs `INTEGRATION_WORKER_SECRET` in both Supabase Edge Function secrets and GitHub Actions secrets. Supabase also needs `INTEGRATION_WEBHOOK_ALLOWED_HOSTS`; update it only through the controlled integration-onboarding process. API keys and webhook signing secrets must never be used in browser code.
