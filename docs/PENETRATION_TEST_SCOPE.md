# Independent penetration-test scope

## Release gate

Do not enable live Stripe payments or broad third-party API/webhook access until an independent tester has completed this scope, all critical and high findings are fixed, and the tester has issued a clean remediation retest or formal residual-risk statement.

## Target

- Test environment running the exact release candidate for `portal.bendigoflyingclub.com.au`.
- Supabase Auth, PostgREST/RLS boundaries, Storage policies and all deployed Edge Functions.
- The scoped integration API and webhook administration/worker paths.
- Cloudflare Pages headers, caching, PWA manifest and service-worker behaviour.
- Stripe must remain in Test Mode. Xero testing must use a non-production tenant or agreed mocks.

The supplier receives disposable accounts for `admin`, `cfi`, `senior_instructor`, `instructor`, `pilot` and `student`, plus separate unauthenticated and revoked credentials. No production member password is shared.

## Required coverage

- OWASP Web Security Testing Guide and OWASP API Security Top 10.
- Authentication, password reset, invitation, MFA enrollment/challenge/recovery, token/session handling and privilege changes.
- Horizontal and vertical authorisation, IDOR/BOLA, Supabase RLS, Storage object access, mass assignment and privileged database functions.
- Booking, duty-limit override, supervision reassignment, membership/payment override, voucher, billing and audit-log business logic.
- Injection, XSS, CSRF, SSRF, open redirects, CORS, CSP, file upload, content-type confusion and rate-limit abuse.
- Integration API key storage/scopes/revocation, webhook signing/replay/idempotency, destination validation and delivery-worker isolation.
- PWA cache poisoning, sensitive response caching, offline behaviour and service-worker update controls.
- Dependency and exposed-secret review sufficient to validate the external attack surface; source-assisted review is preferred.

## Rules of engagement

- Agree written test dates, source IPs, emergency contacts and stop conditions.
- No denial of service, destructive data changes, social engineering or contact with real members.
- Use only disposable test records and payment instruments.
- Immediately report any critical finding instead of waiting for the final report.
- Delete supplied data and credentials at engagement close and confirm deletion in writing.

## Deliverables

- Executive and technical reports with evidence, affected roles/endpoints, CVSS or equivalent severity, exploit narrative and practical remediation.
- Explicit statement of manual versus automated coverage and tester certifications.
- Findings mapped to OWASP categories.
- Free or pre-priced remediation retest within 30-60 days.
- Final attestation listing closed findings and accepted residual risks.

## Procurement shortlist

Obtain comparable fixed-scope quotes from at least two independent Australian providers. Appropriate candidates include CREST-accredited providers such as CyberCX, Vectra, Borderless CS or Stratus Security, or a senior-led provider offering equivalent CREST/OSCP application-testing credentials. Confirm the named tester and subcontractors, data location, professional indemnity insurance, start date, retest terms and conflict of interest before appointment.

### Procurement status

Fixed-price quote requests were sent on 3 August 2026 to CyberCX, Stratus
Security and Vectra, with Lincoln Cottingham copied at
`lincoln@bbkm.com.au`. The requests specify the preferred 25 July–30 August
2026 window, this scope, fixed pricing including GST, named tester credentials,
data and subcontractor locations, insurance, reporting, critical escalation and
one remediation retest. The requests explicitly do not authorise testing or
commit the club to a purchase. Testing remains blocked until the club selects a
provider, approves its quote and signs provider-specific rules of engagement.
