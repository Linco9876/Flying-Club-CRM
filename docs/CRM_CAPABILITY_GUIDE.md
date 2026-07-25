# Bendigo Flying Club CRM Capability Guide

This guide describes the operational capabilities of the Bendigo Flying Club (BFC) CRM and the controls that must remain true as the portal evolves.

## Core platform

- React/Vite member and staff portal hosted on Cloudflare Pages.
- Supabase authentication, PostgreSQL data, row-level security, scheduled lifecycle jobs and Edge Functions.
- Role-based access for members, instructors, senior instructors and administrators.
- Aircraft bookings, flight records, training, instructor duty, senior-instructor supervision, maintenance, safety, billing, Xero and Stripe integrations.
- A separate lightweight, installable Duty Clock PWA uses the same Supabase duty records. Native APK distribution has been retired.

## BFC club membership

Club membership is a distinct record from all of the following:

- RAAus membership and aviation-compliance expiry details;
- a portal login;
- pilot licences, endorsements, medicals, flight reviews and recency;
- permission to instruct or the requirement for senior-instructor supervision.

The portal labels this feature **BFC membership** or **Club membership**. Existing aviation-compliance fields continue to be labelled **RAAus membership**.

### Membership classes

| Class | Annual fee | Voting rights | Self-service signup |
| --- | ---: | --- | --- |
| Full | $150 | Yes | Yes |
| Junior | $75 | No | Yes, with guardian details when under 18 |
| Affiliate | $45 | No | Yes |
| Life | $0 | No | No - assigned by an administrator after the relevant club decision |

The financial year is 1 July to 30 June. A new member's first fee is prorated by the number of days remaining in that financial year. Life membership is fee exempt.

### Application and commencement

Signup collects the applicant's name, residential address, address for service, date of birth, requested class and any required guardian details. It also records declarations supporting the club's purposes and accepting the Constitution, member guarantee, By-laws, Code of Conduct and Members Manual.

Each acknowledgement is stored against a versioned document record. Replacing a governance document must create a new version instead of overwriting the old record, so historic evidence remains intelligible.

After submission:

1. The application enters `pending` status.
2. Administrators receive escalating in-portal reminders after 14, 21 and 27 days.
3. The committee or its authorised delegate can approve or reject the application. A rejection requires a recorded reason.
4. If no earlier decision is recorded, membership commences automatically 30 days after the complete application.
5. Commencement creates the legal register entry and the prorated financial-year fee record.

This implements clauses 13-16 of the July 2019 Constitution: written application data, committee consideration, commencement on entry to the register or within 30 days, and cessation for fees unpaid for 60 days.

### Legal status and financial clearance

Legal membership and booking access are intentionally separate.

| Situation | Legal BFC membership | Aircraft self-booking |
| --- | --- | --- |
| Fee paid in Xero | Current | Allowed |
| Annual fee waived by an administrator | Current | Allowed |
| Life membership | Current | Allowed |
| Invoice required, invoiced or overdue but less than 60 days | Current | Blocked in enforced mode |
| Fee remains unpaid for 60 days | Ceased for non-payment | Blocked |
| Genuine guest booking | Not required | Staff may create the booking |
| Staff creates a booking for a non-financial/non-member user | Unchanged | Allowed only after a warning and a reason of at least 10 characters |

Membership overrides are recorded per booking with the staff member, timestamp, reason, warning code and the eligibility snapshot used for the decision. An override does not bypass safety, aircraft grounding, licensing, instructor duty or senior-supervision controls.

### Xero and fee waivers

The source-of-truth split is:

| Information | Source of truth |
| --- | --- |
| Invoice, amount outstanding and payment status | Xero |
| Legal membership status and commencement/cessation | CRM |
| Committee-authorised free membership for a financial year | CRM fee waiver audit record |
| BFC booking eligibility decision and override | CRM |
| RAAus membership/compliance | Existing pilot compliance record |

Administrators configure a Xero sales item code whose account and tax treatment have been approved by the club's accountant. The CRM can then:

- create an authorised Xero accounts-receivable invoice for one membership period;
- create and email a renewal batch of up to 100 outstanding invoices using Xero's default email template;
- refresh linked invoices and immediately clear booking access when Xero reports them paid;
- allow a member to request a priority refresh of their own linked invoice;
- retain Xero invoice ID, number, status, amount due, last refresh and any sync error.

### Payment preferences and scholarship contributions

Applicants and current members can choose one payment preference:

- **BECS direct debit (preferred):** saves a bank debit mandate through Stripe;
- **Xero invoice:** emails an invoice for manual payment; or
- **Card:** saves a card through Stripe.

The club does not add a card or payment surcharge. A separate annual scholarship contribution is offered instead. It is unchecked by default, starts at $5 when selected and can be changed by the member to another positive amount. The contribution is shown as its own line on the Xero invoice using the accountant-approved scholarship item code; it is never represented as a fee surcharge.

Saving a card or BECS mandate requires explicit payment authority. Stripe Checkout is used only to save and verify the payment method; completing that setup does not transfer funds. Selecting **automatic annual payment** is also optional and unchecked by default. The initial membership invoice may be collected using the selected saved method after membership commences; future annual invoices are collected automatically only when annual payment authority remains enabled. No membership payment is taken while an application is still pending.

Xero remains the accounting source of truth. Successful Stripe collections are applied to the matching Xero invoice through the configured Stripe clearing account and the webhook updates the CRM from that result.

For manual annual payment, the CRM checks Xero-confirmed overpayments and prepayments when the membership invoice is issued. Verified credit is allocated to that invoice first; a partial credit leaves only the remainder payable. The legacy portal balance is not treated as spendable unless it is represented by a matching Xero credit.

### Public joining journey and welcome email

The permanent public entry point is `https://portal.bendigoflyingclub.com.au/join`. The main Bendigo Flying Club website should link its **Join the club** call-to-action directly to that URL.

The public journey uses four short steps: membership class and fee, applicant/account details, legal acknowledgements, then payment preference. It explains proration, the committee-or-30-day commencement rule, the separation between BFC and RAAus membership, and the distinction between saving a payment method and taking payment. BECS is presented as preferred; automatic renewal and the optional scholarship contribution both require a positive opt-in.

Submitting creates the portal account and membership application together. When email confirmation is enabled, the confirmation returns to the portal so the applicant can finish secure Stripe setup. Applicants can use the portal as soon as their account is active, while aircraft self-booking remains subject to financial clearance.

A welcome email is sent only when legal membership actually commences, either after committee approval or the 30-day lifecycle. The delivery log prevents duplicate sends, approval attempts delivery immediately, and the daily membership job retries unsent messages. Two variants are selected from the saved preference:

- **Automatic renewal:** explains the 1 July attempt, 60-day payment window after failure, cessation for non-payment and aircraft booking restriction while unpaid.
- **Annual invoice:** explains invoice-based renewal, the same booking/non-payment rules and the use of Xero-verified prepaid credit when available.

Both versions introduce the member portal and its calendar, profile/RAAus details, flight and training records, logbook, membership and payment features.

When a member cancels through the portal, the CRM withdraws a pending application or resigns a current membership and disables automatic renewal. Any in-flight Stripe collection must be stopped before cancellation continues. A linked unpaid Xero invoice is then deleted while still a draft, or voided after authorisation. Paid or part-paid invoices are retained for accounting history and are not automatically refunded.

The 60-day lifecycle will not automatically cease a membership from a linked Xero invoice if the cached Xero result is missing or older than the configured staleness threshold. The administrator must refresh Xero and rerun the lifecycle; this prevents a false cessation when payment data is stale.

The `daily-membership-xero-refresh` GitHub workflow issues due membership renewals and then refreshes linked membership invoices at 01:00 AEST / 02:00 AEDT, ahead of the database lifecycle. It uses the same `ENABLE_XERO_SYNC_WORKER`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configuration as the existing Xero queue worker. A failed issue or refresh operation fails visibly in GitHub Actions and the stale-data guard remains the safety backstop.

A fee waiver is annual, requires a reason of at least 10 characters, records the authorising administrator and does not create a fake Xero payment. This supports complimentary memberships for substantial volunteer work while preserving accurate accounts.

### Membership administration

The **Club Membership** page provides:

- **My membership:** legal status, class, commencement, fee status, due/grace date, voting entitlement, payment preference, optional scholarship contribution, cancellation and a member-initiated Xero refresh.
- **Applications:** pending applications, automatic-commencement countdown, approval and reasoned rejection.
- **Membership register:** member search, current legal/fee state, Xero invoice actions, annual waivers and existing-member import.
- **Settings:** Xero membership and scholarship item codes, 30-day commencement, 60-day non-payment grace, Xero staleness threshold and staged booking enforcement.

Existing members can be imported without reapplying. The import records the original commencement date, class and an opening financial state. Use `invoice required` unless a payment has already been verified; use `waived` only with documented authority.

### Staged rollout

The migration defaults to `staff_warning` so existing users are not unexpectedly locked out while the register is established.

1. **Information only:** calculate and display status without blocking or requiring a staff reason.
2. **Staff warning:** staff bookings require a reason when the subject is not financially cleared; members are not yet hard-blocked.
3. **Enforced:** non-financial members cannot self-book aircraft; staff can continue only with a recorded reason.

Before switching to **Enforced**:

- import every current member;
- validate class and voting entitlement;
- configure the Xero membership item and link or issue current invoices;
- record approved annual waivers and Life memberships;
- refresh Xero and resolve all sync errors;
- test guest, member, instructor and administrator booking flows;
- confirm the committee has approved the operational policy.

### Governance documents

The source documents reviewed for this capability are:

- Bendigo Flying Club Constitution, July 2019;
- Bendigo Flying Club By-laws, July 2019;
- Bendigo Flying Club Code of Conduct, version 1 dated 12 January 2018;
- Bendigo Flying Club Members Manual, second edition 2024.

The July 2019 By-laws still list the old calendar-year fees ($140/$70/$40/$0) and refer to instructor discretion for fee variations. The 2018 Code of Conduct also describes voting as a right of members generally. The CRM uses the requested financial-year fees ($150/$75/$45/$0), limits voting to Full members and requires administrator-authorised annual waivers, but the governance documents themselves require committee review. Upload each approved replacement as a new `membership_documents` version and mark the old version non-current; do not alter historical acknowledgements.

## Instructor duty and supervision

- Instructors and administrators record duty start, rest periods and duty end in the Duty page.
- Duty start, finish and break fields use a touch-friendly clock-face picker with high-contrast light and dark themes, large hour/minute controls, explicit AM/PM selection, exact-minute dial input, date selection and a typed-time accessibility fallback. Users can click, tap or drag continuously around the clock face; hovering over the hour or minute readout and using the scroll wheel adjusts that value, while arrow keys provide the same fine control. The Android Duty Clock app explicitly requests the matching native clock presentation.
- Logged flight time pre-fills actual flight time in duty-period entry.
- If an instructor has not clocked in, duty is automatically inferred from 30 minutes before their first flight.
- If they do not clock out, the system assumes the configured maximum allowed duty duration.
- Booking checks forecast duty exposure from recorded duty, inferred duty and that day's bookings. Warnings may be overridden only with a reason; the source duty records remain unchanged.
- Administrators designate authorised senior instructors and their supervision priority.
- Instructor bookings requiring supervision remain pending unless an authorised senior instructor is available.
- The assigned supervisor appears in small print on the booking. If that person becomes unavailable, the booking moves to the next available authorised supervisor; if none remains, senior instructors are warned and the booking returns to pending.

## External calendar integration

The portal provides a read-only calendar layer for Apple Calendar, Google Calendar, Outlook and any standards-compliant calendar application. The CRM remains the source of truth: external calendars cannot create, edit, approve or cancel bookings.

### Private live subscription

Every full-portal user can create a private subscription under **Account Settings → Calendar**. The subscription uses a high-entropy bearer URL because consumer calendar applications cannot send a portal login session when refreshing an internet calendar.

The user can:

- subscribe through Apple Calendar or copy the URL into Google Calendar or Outlook;
- include or exclude pending bookings;
- include assigned senior-instructor supervision and duty periods where relevant;
- pause delivery without changing the URL; and
- replace the private URL immediately if it is disclosed.

The feed includes only bookings in which the user is the hirer, instructor or assigned supervisor. It never exports private booking notes, payment details, membership data, duty declarations or fatigue information. Pending bookings are marked tentative and cancelled bookings are published as cancelled so compatible calendar clients can update an existing event. Event UIDs remain stable across reschedules.

Calendar applications decide how often subscribed calendars refresh. This can take hours in some applications, so all subscription UI and event descriptions state that the portal is authoritative.

### Individual booking actions

The booking action menu provides **Add to calendar** for active bookings. Users can add the current event to Google Calendar, Outlook, Apple Calendar or another application through a standard `.ics` file. This is a one-time copy; users who want automatic reschedule and cancellation updates should use the live subscription.

Trial-flight voucher confirmation and update emails include a prominent **Add to calendar** button. Each booking has a stable, opaque calendar token. Opening the email button loads the current booking from the CRM and then offers Google, Outlook and `.ics` options, so an old email does not embed stale dates after a reschedule. Cancelled bookings show a cancellation notice. Tokens expose only the minimum event details and can be revoked server-side.

### Calendar service controls

- `calendar_feed_settings` stores user-owned feed preferences and revocable feed keys behind row-level security.
- `booking_calendar_links` stores per-booking email tokens and is inaccessible to anonymous and authenticated database roles; only the calendar Edge Function's service role can exchange a token.
- The public `calendar-feed` Edge Function accepts only opaque tokens, adds no-index/no-referrer/security headers, and serves standards-compliant UTC iCalendar data with escaped and folded lines.
- Subscription access timestamps are updated at most hourly to avoid a database write for every polling request.
- Calendar feeds cover the previous 180 days and the next 540 days, keeping payloads bounded while preserving useful recent history.

### Calendar release verification

Before release:

1. Apply `20260723100000_add_secure_calendar_integrations.sql`.
2. Deploy the `calendar-feed` and `trial-voucher-public` Edge Functions.
3. Run `npm run test:calendar` and the production portal build.
4. Confirm a full-portal user can create, pause and replace a private subscription.
5. Confirm another authenticated user cannot read or change that subscription row.
6. Confirm a trial-voucher booking confirmation contains the calendar button and its link shows the current booking.
7. Import the same event in Google, Outlook and an `.ics` client; then reschedule or cancel it and verify the live feed retains its UID and changes status or time.

## Deployment checklist for the membership change

1. Review and push `supabase/migrations/20260721120000_add_club_membership_management.sql`.
2. Deploy the `xero-sync`, `member-xero-balance`, `membership-payment-setup`, `send-membership-welcome-email` and `trial-voucher-stripe-webhook` Edge Functions.
3. Confirm the daily `process-bfc-membership-lifecycle` cron job and `daily-membership-xero-refresh` GitHub workflow are active.
4. In Membership settings, set the accountant-approved Xero membership and scholarship item codes and keep rollout in **Staff warning**.
5. Import the current register, verify Xero status and add any authorised annual waivers.
6. Confirm the versioned governance PDFs under `public/membership-documents/` open from the application form. Replace them only by adding a new document version and path.
7. Test signup, payment-method setup, optional scholarship contribution, committee approval, automatic commencement, invoice email, Stripe collection, cancellation/voiding, payment refresh, guest booking, member block and staff override in a non-production account.
8. Switch to **Enforced** only after the register reconciliation is complete.
9. Build the frontend and deploy it to Cloudflare Pages.

## Verification performed for this change

- Production Vite build.
- ESLint on the new membership dashboard, membership hook and updated signup flow.
- Deno type checks for the membership payment setup, Xero sync and Stripe webhook Edge Functions.
- Supabase linked migration dry run.
- PostgreSQL migration integration tests covering proration, class restrictions, automatic commencement, waivers, guest bookings, staff override audit, stale-Xero deferral, fresh unpaid 60-day cessation and the scholarship contribution snapshot added to a financial period.
- Manual review of the supplied Constitution, By-laws, Code of Conduct and Members Manual PDFs.

Local full-database reset requires Docker Desktop. If Docker is unavailable, run the migration first in a Supabase staging branch and exercise the checklist above before production rollout.

## Platform hardening and extensibility release (23 July 2026)

### Recovery

- The backup job discovers the current Supabase REST schema instead of relying on a manually maintained table list.
- Auth identities, all discoverable CRM tables and every Storage bucket are included.
- Every file has a size and SHA-256 digest in the manifest. Any skipped table, Auth failure or bucket failure makes the job fail rather than publishing a partial recovery point.
- Cloud backups are packaged and encrypted with `age` before leaving the runner. Only encrypted archives and their external checksums reach OneDrive or GitHub artifacts.
- A monthly recovery drill first validates the latest encrypted OneDrive archive, then performs a real encrypted database restore into a separate Supabase recovery project. It compares public-table and Auth-user counts after restoring application schemas, grants, data, Storage metadata, Auth identities and password hashes. The reset is repeatable, preserves Supabase-managed publications and excludes only provider-managed migration/vector tables. Keep a second copy of the private `age` identity offline.

### Quality-gated releases

- Pull requests and every push to `main` run the production dependency audit, the code-quality ratchet, local migration audit, full portal/PWA build, every Edge Function type check and every Deno unit test.
- CodeQL and Dependabot provide continuous security scanning and grouped weekly dependency updates.
- Production is an ordered, single release: database dry-run and migration, all Edge Functions, frontend build, then Cloudflare Pages direct upload.
- The GitHub `production` environment requires a reviewer. `main` has strict, admin-enforced protection requiring the portal, Edge Function, quality CodeQL and scheduled CodeQL checks, linear history and resolved conversations.
- Cloudflare automatic production and preview Git deployments are disabled. The reviewed direct-upload workflow is the only normal production publisher.
- The quality baseline is zero ESLint errors and zero TypeScript errors. CI fails on any compiler or lint error; the reviewed React warning ceiling can only decrease.

### Authentication and browser security

- Instructor, senior-instructor and administrator sessions require TOTP MFA. The second factor is retained for the authenticated session, so users are normally prompted only on a new browser or device.
- Members can enable the same authenticator protection from Account Security without being forced to do so.
- The shared database admin helper now requires AAL2, so every older policy and privileged function that already relies on admin status inherits MFA enforcement. High-impact staff settings also have restrictive AAL2 policies; browser UI checks are not the security boundary.
- Cloudflare static responses set a restrictive content security policy, HSTS, clickjacking protection, MIME sniffing protection, referrer controls, cross-origin isolation controls and a narrow permissions policy.
- Public membership signup supports Cloudflare Turnstile when `VITE_TURNSTILE_SITE_KEY` and the matching Supabase CAPTCHA secret are configured.
- Password creation and reset screens require at least 12 characters.
- Stripe is explicitly pinned to Test Mode, the database default is Test Mode, failures report the fail-safe test state, and test transactions cannot sync into Xero. A later switch to live collection remains a deliberate MFA-protected administrator action.

### Membership privacy and usability

- Date of birth is required for every membership class, address-for-service validation is explicit, and guardian requirements remain age-based.
- The versioned `/privacy` notice explains collection, purposes, role access, Supabase/Cloudflare/Stripe/Xero processing, retention, security and member choices.
- A separate, unchecked privacy acknowledgement is required. Its notice version and acceptance timestamp are stored with the application and enforced by the database.
- The public login hero is delivered as a substantially smaller WebP asset. Progress contrast, semantic current-step state, password controls and public privacy navigation have been improved.
- The scholarship contribution remains optional, unchecked by default and editable from the $5 suggestion.

### Progressive Web Apps

- The complete role-aware portal is installable from its header on iPhone, iPad, Android and desktop.
- The root manifest provides portal shortcuts for Calendar, Duty and Membership. Its service worker caches only the static shell and same-origin assets; Supabase/API data is never cached as an offline source of truth.
- A dedicated offline page explains that live bookings and club records require a connection.
- Duty Clock is PWA-only. Its manifest, maskable icons, automatic update path, app-shell service worker and platform-specific install guidance are part of every portal build.
- Duty actions remain server-authoritative. The PWA does not claim an offline clock event succeeded when it has not reached Supabase.

### Availability search

The booking form's **Find the next available slot** action searches aircraft and instructors as a combined resource:

- only serviceable, non-archived aircraft;
- only active instructor, senior-instructor or administrator accounts;
- weekly schedules, one-off changes and absences through the established availability rule;
- no overlapping aircraft or instructor booking;
- selected aircraft/instructor filters when the user has already made a choice;
- 15-minute increments, bounded duration, range and result count.

Choosing a result fills both resources and the start/end values. Final submission still applies membership, endorsements, aircraft state, duty, supervision and safety controls, so availability search can never bypass an operational rule.

### Integration API and webhooks

- `integration-api/v1` provides scoped read endpoints for aircraft, availability and privacy-minimised changed bookings.
- API keys are generated with 256 bits of randomness, displayed once, stored only as SHA-256 hashes, individually scoped and immediately revocable. Per-key rate limiting and request audit records are built in.
- Webhook endpoints must use an explicitly approved hostname and public HTTPS on port 443. The worker re-resolves A and AAAA records before every request, rejects any non-public answer, pins TLS to a validated address while verifying the approved hostname, and does not follow redirects. Signing secrets are service-role-only and displayed once.
- Booking, club-membership and membership-financial events enter a transactional outbox. A scheduled worker atomically leases deliveries, reclaims interrupted work after five minutes, signs the exact body with HMAC-SHA256, supplies stable event IDs and retries network, HTTP and temporary DNS failures with exponential backoff.
- Consumers must verify timestamp and signature, use `X-BFC-Event-Id` idempotently, and return 2xx only after durable acceptance. See `docs/INTEGRATIONS_API.md`.

### Required repository and service configuration

Before the first gated production release, configure or complete:

- GitHub secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_RECOVERY_PROJECT_REF`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`, `BACKUP_AGE_PUBLIC_KEY`, `BACKUP_AGE_PRIVATE_KEY`, `RCLONE_CONFIG`, `RCLONE_REMOTE`, `ONEDRIVE_BACKUP_PATH`, `INTEGRATION_WORKER_SECRET`, and optionally `VITE_TURNSTILE_SITE_KEY`.
- Supabase Edge Function secret `INTEGRATION_WORKER_SECRET` with the same value used by GitHub Actions, plus a comma-separated `INTEGRATION_WEBHOOK_ALLOWED_HOSTS` allowlist. Leave the allowlist empty until a third-party integration is approved.
- The Cloudflare Turnstile secret in Supabase Auth CAPTCHA settings when Turnstile is enabled.
- A durable, scoped Cloudflare API token with Pages Write access in `CLOUDFLARE_API_TOKEN`. The local Wrangler OAuth token is intentionally not copied to CI because it expires.
- Real authenticated acceptance on at least one current physical iPhone and one current physical Android device for all six roles. The manual Quality Gates workflow provisions disposable recovery-project accounts and MFA factors, connects through BrowserStack Local, runs the matrix, and removes the test identities.
- An independent manual web/API penetration test, remediation of all critical/high findings, and a clean retest before live payments or broad third-party API access. See `docs/PENETRATION_TEST_SCOPE.md`.

### Release-readiness evidence (25 July 2026)

- Encrypted isolated restore passed with 125 public tables, 26 Auth users, 25 profiles, 150 bookings, 104 flight logs, 1 club membership, 10 Storage buckets and 14 Storage objects matching production.
- Authenticated emulated acceptance passed for admin, CFI, senior instructor, instructor, pilot and student on iPhone/WebKit and Android/Chromium configurations. Test users and MFA factors are disposable and removed after the run.
- Authenticated physical-device acceptance passed for the same six roles on an iPhone 16 running iOS 18/Safari and a Samsung Galaxy S23 Ultra running Android 13/Chrome. The run covered staff MFA, role-specific navigation, calendar/profile journeys and horizontal-overflow checks through BrowserStack Local.
- Portal/PWA production build, dependency audits, migration audit, 25 Edge Function type checks and 12 Edge Function unit tests pass.
- ESLint: 0 errors. TypeScript: 0 errors. React hook/refresh warnings: 69 and ratcheted after the ESLint 10/React Hooks 7 upgrade.
- Stripe remains explicitly in Test Mode.
