# Bendigo Flying Club CRM Capability Guide

This guide describes the operational capabilities of the Bendigo Flying Club (BFC) CRM and the controls that must remain true as the portal evolves.

## Core platform

- React/Vite member and staff portal hosted on Cloudflare Pages.
- Supabase authentication, PostgreSQL data, row-level security, scheduled lifecycle jobs and Edge Functions.
- Role-based access for members, instructors, senior instructors and administrators.
- Aircraft bookings, flight records, training, instructor duty, senior-instructor supervision, maintenance, safety, billing, Xero and Stripe integrations.
- A separate lightweight, installable Duty Clock PWA uses the same Supabase duty records. Native APK distribution has been retired.

## RPC course lesson identification

The RAAus Ab-Initio course retains each syllabus code as its stable identifier for imports, historical records and competency mapping. Every lesson also has a plain-English title, and course navigation shows the code and title together—for example, **1.01-3 · Effects of Controls** and **RPC-FLT-TEST · Pilot Certificate Flight Test**. Long lesson titles wrap rather than being cut off.

## Historical student record imports

Authorised instructors, senior instructors and administrators can open a person's Pilot File and use **Import / Export Data** to load historical lesson records or exam results from CSV. The open Pilot File remains the source of truth for the student. Course templates carry that student's portal ID and display name for traceability, but the server refuses a row whose portal ID differs from the open file.

Lesson and exam imports use separate, course-specific templates. Each template is bound to the selected course version and pre-fills its lesson or exam rows. The portal automatically detects rows where record details have been entered; **Yes**, **X**, **Completed** and **Done** are also accepted in the optional **Include** column. **Skip** deliberately excludes a filled row. Older templates whose untouched Include cells contain **No** remain compatible and populated rows are still detected. Lesson rows show the stable syllabus code and plain-English name together, such as **1.01-3 · Effects of Controls**. Code-only files downloaded previously remain import-compatible. Lesson templates include both forms of assessment configured for the selected course: the course criteria matrix (including the RAAus **NC / S / C / -** system) and, where present, detailed syllabus competency codes with 1/2/3 standards and optional per-code comments. A downloadable criteria and competency guide explains every column, its permitted grades and the lessons where it applies.

The **Export current data** button produces the student's existing course data in exactly the same round-trip format, including stable record references, NC/S/C criteria grades and detailed competency results. The browser accepts Australian or ISO dates and common time formats, validates every row, and refuses student, course-version, lesson, exam, criterion or competency mismatches. It never silently creates courses, lessons, assessment criteria, competency codes, exams, aircraft or instructors. A server preview repeats the validation and marks exact duplicates before the import button becomes available.

The import operation is atomic and subject to these controls:

- only existing, active students and existing course content can be referenced;
- one batch is limited to 500 rows and 2 MB, with MFA required above 25 rows;
- repeated uploads are idempotently skipped using a tenant-local fingerprint plus an existing-record check;
- the source filename, row number, historical instructor, source organisation, reference, signed-in importer and immutable batch ID remain attached to each record;
- lesson data and its competency results are committed atomically in the same batch, so they cannot become separated by a partial import;
- the course ID, course version and competency-result count are retained in the student's visible import history;
- imported lessons are locked historical records by default and do not create an acknowledgement task unless staff explicitly request one;
- administrators can undo an entire batch with MFA, while retaining the batch's reversal history; and
- CSV imports never create bookings or operational flight logs, change aircraft tach/Hobbs time, affect maintenance, create invoices, alter prepaid balances, or invoke Stripe/Xero.

Rows that fail browser or server validation can be downloaded as a corrected CSV with a `problem` column. File-level errors preserve every original data row and column instead of producing only headings. Spreadsheet-active leading characters are escaped in this error export.

## Pilot file loading and resilience

Opening a student Pilot File fetches only that selected member's profile, student details, roles, licences and endorsements. It does not download the entire member directory. The profile code is prefetched while the member list is idle and again when a member row receives pointer or keyboard focus, so the transition normally begins before the user clicks.

A layout-matched, accessible loading shell appears immediately and keeps the Back control usable. Once identity data is available, the real header and tabs render while training totals and course progress continue loading in their own reserved areas. The portal never presents temporary zero-hours or “No training records” messages as if loading were complete. Safety reports, exam results, billing data and payment settings are requested only when their relevant tab needs them. A failed member request remains on the Pilot File route and offers an explicit retry instead of unexpectedly returning the user to the member list.

## Aircraft maintenance and defect control

The Maintenance Board is available to administrators, instructors and senior instructors. It shows the complete defect lifecycle, one-time and recurring maintenance milestones, signed hour/date remaining values, overdue alerts and secure defect attachments. Historic fixed, MEL and deferred defects remain available through the status filters; they are not hidden by the open-defect aircraft query.

Any staff or full-portal user can report a defect. The database records the signed-in user as the reporter, regardless of any submitted display value, and validates the summary, description, severity, discovery time, aircraft hours, attachment count and secure-storage paths. The configurable attachment rule is enforced in the database as well as the form. Reporters may manually ground an aircraft for any defect. Major and Critical defects are automatically grounded when that rule is enabled.

Grounding is fail-safe:

- an active grounding defect keeps the aircraft `unserviceable` until staff resolve or reclassify it;
- resolving one defect cannot release the aircraft while another grounding defect remains open;
- an overdue maintenance milestone can also ground the aircraft when configured;
- a review timer reminds administrators to investigate but never returns an unresolved aircraft to service;
- new bookings for an unserviceable aircraft are rejected in the database, even if a browser has stale aircraft data;
- existing future bookings are held for review and are rechecked for genuine aircraft/instructor conflicts when grounding clears; and
- deleting or changing a defect or milestone reconciles aircraft and booking state rather than leaving stale grounding flags.

Defect status changes to MEL or Deferred require operational limitations or a deferral reason. Marking a defect Fixed requires fix notes and, when maintenance approval is enabled, administrator approval with MFA. Delete controls are administrator-only.

Recurring milestones support tach hours, calendar months or the first of both limits. Calendar intervals use real calendar-month arithmetic rather than 30-day approximations. Milestone state is refreshed when aircraft hours change and hourly for calendar deadlines. Upcoming, urgent and overdue administrator notifications are deduplicated for each exact deadline.

Completing maintenance is one atomic database operation: it validates the completion date and tach against the aircraft and previous completion, writes an idempotent completion record, advances the next deadline, updates the aircraft maintenance date, reconciles grounding and creates an immutable audit entry. One-time milestones close without creating another deadline. A milestone with completion history cannot be deleted.

Defect edits, status changes, milestone changes and completions are recorded in staff-only audit history. Browser clients cannot forge these history rows or edit/delete the audit log.

## GST-inclusive pricing

All prices, rates, fees and surcharges configured or shown in the portal are GST/tax inclusive. The portal never adds tax on top of a displayed amount. Customer invoices and credit notes are sent to Xero with `LineAmountTypes: Inclusive`, so Xero extracts GST from the supplied amount using the configured tax type. Account top-ups, payments, credits, balances and liability transfers are financial movements rather than additional prices and must not have GST added merely because they appear in the billing area.

## BFC club membership

Club membership is a distinct record from all of the following:

- RAAus membership and aviation-compliance expiry details;
- a portal login;
- pilot licences, endorsements, medicals, flight reviews and recency;
- permission to instruct or the requirement for senior-instructor supervision.

The portal labels this feature **BFC membership** or **Club membership**. Existing aviation-compliance fields continue to be labelled **RAAus membership**.

### Membership classes

| Class | Annual fee (incl. GST) | Voting rights | Self-service signup |
| --- | ---: | --- | --- |
| Full | $150 | Yes | Yes |
| Junior | $75 | No | Yes, with guardian details when under 18 |
| Affiliate | $45 | No | Yes |
| Life | $0 | No | No - assigned by an administrator after the relevant club decision |

The recommended financial year is 1 July to 30 June. Administrators can configure the start month/day and choose daily, whole-month or no proration for a new member's first fee, including an optional minimum prorated amount. The production default remains daily proration to 30 June with no minimum. Life membership is fee exempt.

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
| Xero invoice, amount outstanding and Xero payment status | Xero, while connected |
| Stripe-only membership collection and provider status | Stripe plus the CRM provider-payment ledger |
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

Applicants and current members can choose from the payment preferences supported
by the providers that are currently connected:

- **BECS direct debit (preferred):** saves a bank debit mandate through Stripe;
- **Xero invoice:** emails an invoice for manual payment; or
- **Card:** saves a card through Stripe.

The club does not add a card or payment surcharge. A separate annual scholarship contribution is offered instead. It is unchecked by default, starts at $5 when selected and can be changed by the member to another positive amount. The contribution is shown as its own line on the Xero invoice using the accountant-approved scholarship item code; it is never represented as a fee surcharge.

Saving a card or BECS mandate requires explicit payment authority. Stripe Checkout is used only to save and verify the payment method; completing that setup does not transfer funds. Selecting **automatic annual payment** is also optional and unchecked by default. The initial membership invoice may be collected using the selected saved method after membership commences; future annual invoices are collected automatically only when annual payment authority remains enabled. No membership payment is taken while an application is still pending.

When both providers are connected, Xero remains the accounting source of truth
and a successful Stripe collection is applied to the matching Xero invoice
through the configured Stripe clearing account. When Xero is disconnected,
Stripe can collect an approved membership directly and the CRM webhook/provider
ledger supplies financial clearance until accounting is reconnected and
reviewed. Stripe is never presented as a Xero balance or invoice substitute.

For manual annual payment, the CRM checks Xero-confirmed overpayments and prepayments when the membership invoice is issued. Verified credit is allocated to that invoice first; a partial credit leaves only the remainder payable. The legacy portal balance is not treated as spendable unless it is represented by a matching Xero credit.

### Public joining journey and welcome email

The permanent public entry point is `https://portal.bendigoflyingclub.com.au/join`. It first offers a **Portal account only** path and an **Account and club membership** path. The main Bendigo Flying Club website can link account creation or club-membership calls-to-action directly to that URL.

The account-only journey uses three short steps: choose account-only, enter basic account details, then acknowledge the portal privacy notice. It does not request membership-register details and cannot create a membership application, membership-document acknowledgement, invoice, Stripe authority or scholarship contribution. A non-member can use the portal features available to their account and apply later from the Membership tab; aircraft self-booking remains subject to the configured membership rules.

The account-and-membership journey uses four short steps: membership class and fee, applicant/account details, legal acknowledgements, then payment preference. It explains proration, the committee-or-30-day commencement rule, the separation between BFC and RAAus membership, and the distinction between saving a payment method and taking payment. BECS is presented as preferred; automatic renewal and the optional scholarship contribution both require a positive opt-in.

Residential and address-for-service fields provide keyboard-accessible Australian address suggestions while retaining manual entry. OpenStreetMap results prefer the specific suburb or district over a broader regional city label, so addresses such as Strathfieldsaye are not relabelled as Bendigo.

Membership-path submission creates the portal account and membership application together. Account-only submission creates only the portal identity and student profile. When email confirmation is enabled, the confirmation returns to the appropriate portal continuation. Applicants can use the portal as soon as their account is active, while aircraft self-booking remains subject to membership and financial clearance.

Administrators can also use **Members → Add user** to add a portal user without sending an invitation. An email address is still required, but no usable password or setup link is exposed to the administrator. If that person later tries to create an account with the same email address, the portal sends a rate-limited verification link to that mailbox and lets them choose their own password. The public request returns the same response whether or not a pending account exists, and its setup link can return only to the configured portal origin.

A welcome email is sent only when legal membership actually commences, either after committee approval or the 30-day lifecycle. The delivery log prevents duplicate sends, approval attempts delivery immediately, and the daily membership job retries unsent messages. Two variants are selected from the saved preference:

- **Automatic renewal:** explains the 1 July attempt, 60-day payment window after failure, cessation for non-payment and aircraft booking restriction while unpaid.
- **Annual invoice:** explains invoice-based renewal, the same booking/non-payment rules and the use of Xero-verified prepaid credit when available.

Both versions introduce the member portal and its calendar, profile/RAAus details, flight and training records, logbook, membership and payment features.

The welcome email uses the organisation name, logo, contact email and portal URL from Organisation Settings, with safe Bendigo Flying Club defaults. Its responsive, email-client-safe layout puts the commenced membership status and portal action first, then presents portal capabilities and the selected payment journey in short cards. Automatic and invoice wording remains distinct, a matching plain-text version is always sent, and light/dark email-client styles maintain readable contrast.

When a member cancels through the portal, the CRM withdraws a pending application or resigns a current membership and disables automatic renewal. Any in-flight Stripe collection must be stopped before cancellation continues. A linked unpaid Xero invoice is then deleted while still a draft, or voided after authorisation. Paid or part-paid invoices are retained for accounting history and are not automatically refunded.

The 60-day lifecycle will not automatically cease a membership from a linked Xero invoice if the cached Xero result is missing or older than the configured staleness threshold. The administrator must refresh Xero and rerun the lifecycle; this prevents a false cessation when payment data is stale.

The daily database preparation job creates the next financial-year period at the configured invoice lead time (30 days by default), snapshots the member's optional scholarship contribution and issues deduplicated in-portal reminders. The recommended reminder schedule is 30 and 7 days before renewal, then 7, 30, 45 and 55 days overdue.

The `daily-membership-xero-refresh` GitHub workflow prepares and issues membership renewals and then refreshes linked invoices at 01:00 AEST / 02:00 AEDT, ahead of the database lifecycle. A future renewal invoice can be created and emailed in advance, but automatic card or BECS collection is explicitly held until its due date. Manual-invoice members are never placed into automatic collection. It uses the same `ENABLE_XERO_SYNC_WORKER`, `SUPABASE_URL` and restricted `INTEGRATION_WORKER_SECRET` configuration as the Xero queue worker. A failed issue or refresh operation fails visibly in GitHub Actions and the stale-data guard remains the safety backstop.

A fee waiver is annual, requires an approved waiver type, a reason of at least 10 characters and—by default—a committee-minute or delegated-authority reference. It records the authorising administrator and does not create a fake Xero payment. The default categories are volunteer contribution, hardship, honorary, promotional and administrative correction.

Membership billing has two independent retry schedules:

- technical interruptions retry after 5 minutes, 30 minutes, 2 hours and 12 hours by default;
- a rejected automatic card or bank debit retries after 3 and 7 days by default.

Both schedules are configurable. Every collection attempt reserves its own stable idempotency key, an already-submitted Stripe intent is reconciled rather than resubmitted, and terminal failures are shown to both the member and administrators.

### Membership administration

The **Club Membership** page provides:

- **My membership:** legal status, class, commencement, fee status, due/grace date, voting entitlement, payment preference, optional scholarship contribution, cancellation and a member-initiated Xero refresh.
- **Applications:** pending applications, automatic-commencement countdown, approval and reasoned rejection.
- **Membership register:** member search, current legal/fee state, Xero invoice actions, annual waivers and existing-member import.
- **Settings:** financial-year boundary, commencement, proration and minimum fee; renewal preparation and reminder schedules; separate technical/payment retry schedules; Xero item codes and staleness threshold; structured waiver governance; statutory-register cleanup target; staff override reasons; and staged booking enforcement.
- Every membership setting has a keyboard- and touch-accessible help icon. Its detailed explanation distinguishes display-only choices from legal, booking, billing, privacy and Xero consequences; Escape or the close control returns focus to the setting that opened it.

The register toolbar exports a privacy-minimised statutory CSV. Current entries contain the name, residential address, class and commencement date. A ceased entry exposes only the member name, cessation date and status, while accounting/audit history remains in its purpose-specific CRM records. The configurable cleanup target defaults to 14 days; the statutory projection suppresses the extra fields immediately.

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

- Administrators maintain one shared list of active business locations in **Settings → Organisation → Business Locations**. One location is primary; each entry carries its address, GPS coordinates and Duty Clock geofence radius.
- When more than one location is active, every available instructor roster day and future roster version records the working location. Existing and single-site schedules default to the primary location.
- Authorised supervisors separately select one or more supervision locations for every working day in **Settings → Roster & Availability**. Coverage may differ by weekday and future roster version; supervisor assignment only uses locations selected for that day.
- Booking and supervision checks use stable location IDs while retaining the location name for existing emails, exports and calendar clients. A booking cannot assign an instructor at a location different from that instructor's roster day.
- Instructors and administrators record duty start, rest periods and duty end in the Duty page.
- Duty start, finish and break fields use a touch-friendly clock-face picker with high-contrast light and dark themes, large hour/minute controls, explicit AM/PM selection, exact-minute dial input, date selection and a typed-time accessibility fallback. Users can click, tap or drag continuously around the clock face; hovering over the hour or minute readout and using the scroll wheel adjusts that value, while arrow keys provide the same fine control. The Android Duty Clock app explicitly requests the matching native clock presentation.
- Logged flight time pre-fills actual flight time in duty-period entry.
- When a completed duty exceeds the configured break threshold and no sufficiently long break is recorded, the Duty Clock and portal ask whether a break was taken. A "yes" response requires the actual start and finish times; a "no" response closes the duty without inventing a break and is retained in the mobile duty audit event.
- The default missing-break threshold is more than 5 hours with a minimum 30-minute free-of-duty break, reflecting clause 17.1 of the Pilots Award. Administrators can change both values in **Settings → Bookings & Rules → Fatigue Management**. The club must confirm award coverage and any applicable meal-provision or reimbursement exception; this prompt is an operational record, not legal advice.
- If an instructor has not clocked in, duty is automatically inferred from 30 minutes before their first flight.
- If they do not clock out, the system assumes the configured maximum allowed duty duration.
- Booking checks forecast duty exposure from recorded duty, inferred duty and that day's bookings. Warnings may be overridden only with a reason; the source duty records remain unchanged.
- Administrators designate authorised senior instructors and their supervision priority.
- An account with the Instructor role automatically requires supervision for every flight unless it also has Senior Instructor or CFI authority. This role-based safeguard cannot be disabled in settings; additional manual requirements remain available for other staff.
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

## Calendar kiosk access

The `/kiosk` calendar uses a dedicated high-entropy kiosk key instead of an email address and password. An administrator manages the key in **Settings → Portal & UX → Kiosk access**.

- Creating or viewing the key requires an administrator session with MFA.
- The key is encrypted at rest and is never stored in plaintext on the kiosk device.
- A successful entry exchanges the key for a separate revocable browser grant.
- Rotating or disabling the key revokes all existing kiosk browser grants.
- An active kiosk grant remains usable while the kiosk is regularly used and expires after 30 days of inactivity.
- The kiosk retains its existing calendar, booking and flight-logging permissions; it does not add a new permission role.
- Production requires a separate 32-byte `KIOSK_TOKEN_ENCRYPTION_KEY` stored only in Supabase Edge Function secrets.

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

## Australian hosting migration (3 August 2026)

- The primary Supabase project is hosted in Sydney (`ap-southeast-2`). Cloudflare Pages remains a global edge frontend; CRM data, Auth identities and Storage objects use the Sydney Supabase project.
- The controlled migration restores the `public`, `private`, `auth` and `storage` schemas, preserves user UUIDs and password hashes, copies every Storage object and verifies each file with SHA-256. All 148 public-table counts must match before cutover.
- Auth redirects allow only `https://portal.bendigoflyingclub.com.au/**`; the retired Bolt hostname is not carried into the Australian project. Existing custom SMTP and application email delivery are preserved without placing provider secrets in source control.
- Production deployment reads the immutable project reference from the protected `SUPABASE_PROJECT_REF` GitHub secret. Database migrations, Edge Functions and the frontend therefore cannot silently target different Supabase tenants.
- Recoverable Edge Function secrets are re-applied through the manually approved **Configure Supabase runtime secrets** workflow. Stripe and Xero credentials are deliberately excluded: each provider remains independently disconnected until an administrator completes its approved live connection process.
- The normally dormant Sydney recovery project is started automatically for the monthly restore drill and paused again afterward. The old Singapore project is retained only as a short rollback point after cutover, then paused rather than deleted.
- Authenticated acceptance covers administrator, CFI, senior-instructor, instructor, pilot and student navigation on iPhone and Android. The test runner permits its two exact local origins only for the duration of a run, uses disposable users and removes those origins and accounts in `finally` cleanup.
- Account deletion now permits nested cleanup of role-mandated supervision records and preserves maintenance audit history by nulling the deleted actor reference. Direct attempts to remove a mandatory supervision rule remain blocked.

## Platform hardening and extensibility release (23 July 2026)

### Recovery

- The backup job discovers the current Supabase REST schema instead of relying on a manually maintained table list.
- Auth identities, all discoverable CRM tables and every Storage bucket are included.
- Every file has a size and SHA-256 digest in the manifest. Any skipped table, Auth failure or bucket failure makes the job fail rather than publishing a partial recovery point.
- Cloud backups are packaged and encrypted with `age` before leaving the runner. Only encrypted archives and their external checksums reach OneDrive or GitHub artifacts.
- A monthly recovery drill first validates the latest encrypted OneDrive archive, then performs a real encrypted database restore into a separate Supabase recovery project. It compares public-table and Auth-user counts after restoring application schemas, grants, data, Storage metadata, Auth identities and password hashes. The reset is repeatable, preserves Supabase-managed publications and excludes only provider-managed migration/vector tables. Keep a second copy of the private `age` identity offline.
- Recovery tooling uses the runtime-provided temporary directory rather than a Windows-only environment variable, so the same encrypted restore path is exercised by Linux GitHub runners and Windows break-glass administration.

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
- The deliberately owner-evaluated shared-calendar projection is governed by the time-limited `SEC-EXC-001` register entry in `docs/SECURITY_EXCEPTIONS.md`. Anonymous access remains revoked, private fields are masked and the exception must be reviewed before 3 November 2026.
- The production database function grant snapshot, risk explanation and staged least-privilege remediation criteria are maintained in `docs/DATABASE_FUNCTION_PERMISSIONS.md`.

### Training interface consolidation

- The legacy **Syllabus Management / Training Module Builder** interface has been retired. Staff create and manage database-backed courses through **Training Courses**, while published student preparation remains in **Learning Centre**.
- Existing bookmarks to `/training/syllabus` are redirected to the supported Training Courses workspace. The legacy component and navigation entry are no longer shipped in the production bundle.

### Membership privacy and usability

- Date of birth is required for every membership class, address-for-service validation is explicit, and guardian requirements remain age-based.
- Residential address fields use an accessible Australian address dropdown with keyboard controls and retain manual entry when the lookup service is unavailable. The server-side `address-autocomplete` Edge Function defaults to the low-volume Photon/OpenStreetMap service and restricts results to Australia.
- `/join` detects an existing portal session. Signed-in users receive prefilled name, verified login email, phone, date of birth and residential address; password controls are removed and the login email is read-only. Edited profile details and the membership application are committed together, then the active portal profile is refreshed.
- To use Google Places instead, set the Supabase Edge Function secrets `ADDRESS_AUTOCOMPLETE_PROVIDER=google` and `GOOGLE_MAPS_PLATFORM_API_KEY`. The key remains server-side; no provider credential is included in the portal bundle. The Edge Function enforces a per-client request window; Google project quotas should also be set before enabling the paid provider.
- The versioned `/privacy` notice explains collection, purposes, role access, Supabase/Cloudflare/Stripe/Xero processing, retention, security and member choices.
- A separate, unchecked privacy acknowledgement is required. Its notice version and acceptance timestamp are stored in signup metadata; membership applications also retain and database-enforce the accepted version and timestamp.
- Organisation Settings contains a versioned document library for PDF and Word files. Administrators identify which current documents require membership acknowledgement and publish an updated version without deleting the file previously accepted by applicants.
- Membership applications submit the exact current document IDs shown to the applicant. The database rejects missing, stale or additional IDs and records each accepted title and version with the application. Anonymous access is limited to current signup documents; uploads and document administration require an administrator session.
- The public login hero is delivered as a substantially smaller WebP asset. Progress contrast, semantic current-step state, password controls and public privacy navigation have been improved.
- The scholarship contribution remains optional, unchecked by default and editable from the $5 suggestion.

### Progressive Web Apps

- The complete role-aware portal is installable from its header on iPhone, iPad, Android and desktop.
- The root manifest provides portal shortcuts for Calendar, Duty and Membership. Its service worker caches only the static shell and same-origin assets; Supabase/API data is never cached as an offline source of truth.
- A dedicated offline page explains that live bookings and club records require a connection.
- Duty Clock is PWA-only. Its manifest, maskable icons, automatic update path, app-shell service worker and platform-specific install guidance are part of every portal build.
- Duty actions remain server-authoritative. The PWA does not claim an offline clock event succeeded when it has not reached Supabase.

### Availability search

The calendar header's **Find next slot** action opens a focused search before the new-booking form. It searches aircraft and instructors as a combined resource:

- only serviceable, non-archived aircraft;
- only active instructor, senior-instructor or administrator accounts;
- weekly schedules, one-off changes and absences through the established availability rule;
- the selected business location and each instructor's roster location;
- no overlapping aircraft or instructor booking;
- optional aircraft and instructor filters;
- 15-minute increments, bounded duration, range and result count.

Choosing a result opens the new-booking form with aircraft, instructor, location and start/end values filled. The new-booking form itself does not contain the finder. Final submission still applies membership, endorsements, aircraft state, duty, supervision and safety controls, so availability search can never bypass an operational rule.

When only one business location is active, bookings and roster days silently use the primary location. When more than one is active, **Settings → Bookings → Booking Form Field Configuration** exposes the Location field controls and the booking form shows the configured location selector.

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
- Optional Supabase Edge Function secrets `ADDRESS_AUTOCOMPLETE_PROVIDER=google` and `GOOGLE_MAPS_PLATFORM_API_KEY` switch address suggestions from the built-in low-volume OpenStreetMap provider to Google Places.
- The Cloudflare Turnstile secret in Supabase Auth CAPTCHA settings when Turnstile is enabled.
- A durable, scoped Cloudflare API token with Pages Write access in `CLOUDFLARE_API_TOKEN`. The local Wrangler OAuth token is intentionally not copied to CI because it expires.
- Real authenticated acceptance on at least one current physical iPhone and one current physical Android device for all six roles. The manual Quality Gates workflow provisions disposable recovery-project accounts and MFA factors, connects through BrowserStack Local, runs the matrix, and removes the test identities.
- The manual physical-device job now starts the normally dormant recovery project, refreshes it from production and validates source/recovery counts, deploys the current Edge Functions, performs the authenticated device matrix and waits for confirmed dormancy when it started the project. A shared lock prevents this lifecycle from overlapping the monthly recovery drill.
- An independent manual web/API penetration test, remediation of all critical/high findings, and a clean retest before live payments or broad third-party API access. See `docs/PENETRATION_TEST_SCOPE.md`.

### Release-readiness evidence (25 July 2026)

- Encrypted isolated restore passed with 125 public tables, 26 Auth users, 25 profiles, 150 bookings, 104 flight logs, 1 club membership, 10 Storage buckets and 14 Storage objects matching production.
- Authenticated emulated acceptance passed for admin, CFI, senior instructor, instructor, pilot and student on iPhone/WebKit and Android/Chromium configurations. Test users and MFA factors are disposable and removed after the run.
- Authenticated physical-device acceptance passed for the same six roles on an iPhone 16 running iOS 18/Safari and a Samsung Galaxy S23 Ultra running Android 13/Chrome. The run covered staff MFA, role-specific navigation, calendar/profile journeys and horizontal-overflow checks through BrowserStack Local.
- Portal/PWA production build, dependency audits, migration audit, 25 Edge Function type checks and 12 Edge Function unit tests pass.
- ESLint: 0 errors. TypeScript: 0 errors. React hook/refresh warnings: 69 and ratcheted after the ESLint 10/React Hooks 7 upgrade.
- Stripe remains explicitly in Test Mode.

## Tenant-safe Xero rollout (29 July 2026)

Xero is deliberately contained while the portal remains in Test Mode. `ENABLE_XERO_SYNC_WORKER` is false, Stripe Test Mode records are never eligible for Xero sync, the connected Horizon Aviation tenant is inventory-only, and every locally known Xero identifier is recorded in a tenant-scoped quarantine. Historical IDs are not trusted merely because they existed before this control was introduced.

### Connection and credential controls

- Connecting Xero requires an administrator session at AAL2, typed `CONNECT XERO` confirmation, Xero authorisation, explicit selection from the returned organisations, and a second phrase containing the exact selected organisation name.
- The first approved BFC selection pins an immutable expected tenant ID. A later OAuth result cannot switch that tenant in place.
- Access, refresh and ID tokens are AES-256-GCM encrypted with `XERO_TOKEN_ENCRYPTION_KEY`, which is stored separately as a Supabase Function secret. Plaintext token columns are cleared during lazy migration.
- Token refresh is centralised behind a leased database lock so concurrent requests cannot rotate the same refresh token.
- Browser CORS is restricted to configured portal origins. Xero administration is server-enforced at AAL2.
- GitHub Xero jobs use only `INTEGRATION_WORKER_SECRET`; the Supabase service-role credential is not sent to either Xero workflow.
- Connection and configuration changes create append-only audit records without token values.

### Tenant-bound processing and reconciliation

- Contacts, invoices, payments, bank transactions, journals, tracking options and related queue jobs carry their originating tenant.
- New external IDs cannot be stored unless posting is enabled and the active tenant equals the immutable expected tenant. Existing IDs remain unverified and quarantined until reconciled.
- Queue workers lease atomically with `FOR UPDATE SKIP LOCKED`. A job must have a verified tenant snapshot, persistent operation ID and approved/effective mapping version.
- Local operation history and Xero idempotency keys prevent duplicate submission. Xero correlation IDs, minute/day rate-limit headers, retry advice and response summaries are retained.
- The signed `xero-webhook` endpoint validates the raw request body with `XERO_WEBHOOK_KEY`, stores tenant-bound events and quarantines mismatched tenants. The read-only inventory action uses `If-Modified-Since` as a recovery fallback.
- Terminal failures and review items create deduplicated administrator notifications. Ordinary successful or skipped runs do not generate failure alerts.

### Accountant mapping and release gates

Settings → Integrations includes a mapping wizard backed by the live Xero chart of accounts. It stores account IDs and codes, shows GST-inclusive debit/credit impact using a sample amount, versions each mapping and requires a written approval note plus typed approval. Approved versions are immutable; changes require a new version.

Posting remains disabled after connection and after mapping approval. Before BFC posting can be introduced, the club must:

1. finish the read-only Horizon inventory and mark each artefact matched, retained, voided/deleted or needing review;
2. explicitly reconnect to Bendigo Flying Club and verify the immutable tenant ID;
3. remap contacts, aircraft tracking, items, account IDs/codes and tax types against the live BFC chart;
4. run each contact, draft invoice, payment, credit, cancellation and reconciliation lifecycle in a Xero demo organisation;
5. obtain written treasurer/accountant approval for the mapping and dry-run evidence;
6. reconcile one controlled BFC draft batch; and
7. only then introduce a separately reviewed change that enables posting. Authorised invoices remain a later, separately approved stage.

`xero-read-only-inventory.yml` is manual-only. Its default operation is a read-only inventory; its cleanup operation is restricted to the unpinned, inventory-only legacy tenant and requires both the exact tenant ID and a phrase containing the tenant name. It can delete/void only locally linked payments, bank transactions, unpaid invoices and journals; paid/part-paid invoices become review items, while contacts and configuration records are retained. Both scheduled Xero workflows also require the repository variable `ENABLE_XERO_SYNC_WORKER=true`, including manual dispatch, so a dispatch cannot bypass containment.

### Independent Stripe and Xero operation

The portal derives one server-authoritative financial capability state from the
active provider credentials, provider link, disconnect marker and pinned Xero
tenant. A stored account or tenant ID by itself is not treated as a working
connection.

| Provider state | Portal behaviour |
| --- | --- |
| Stripe and Xero connected | Stripe collects secure payments; Xero supplies balances, invoices and accounting; eligible payments can be reconciled together. |
| Stripe only | Saved cards, BECS/card membership collection, payment links and local Stripe activity remain available. Xero balances, invoices, prepaid credit, sync controls and Xero renewal actions are hidden. |
| Xero only | Xero contacts, balances, invoices, prepaid credit and enabled accounting workflows remain available. Card/BECS setup, Stripe payment links and voucher online checkout are hidden. Members can use manual Xero invoices. |
| Neither connected | Balance/billing navigation, financial administration, payment controls and voucher sales controls are disabled. Operational membership, booking, flight, training, duty, maintenance and safety records remain usable. |

Stripe-only membership collections are held in a provider-bound local payment
record with a unique attempt ID. A failed attempt receives a new idempotency
key; a pending, processing, successful or review-required attempt prevents a
duplicate debit. Stripe webhooks update the membership period and payment
preference without requiring a Xero contact.

Cancellation remains safe in every state. A processing Stripe membership debit
must be retrieved and cancelled before the legal membership is resigned. If
Xero is offline and an unpaid Xero membership invoice already exists, the CRM
cancels the membership locally, marks the invoice void as a review item and
retains the Xero identifier for completion after reconnection. Paid accounting
records are never silently removed.

### Financial privacy and provider disconnection

Xero balances, invoices and prepaid account values are shown only while Xero is
operational and the person has a linked Xero contact. Disconnecting Xero clears
those values from the header, profile, Balance tab and staff views rather than
substituting zeroes or rendering cached figures. Stripe data is independently
available only while Stripe is operational.

The protection is enforced twice:

- provider-aware interfaces do not request or render unavailable provider data;
  and
- restrictive PostgreSQL policies prevent direct client writes to provider
  payment and reconciliation records.

Public membership prices and administrator rate settings remain visible because
they describe the organisation's products rather than a person's balance.
Service-role access is retained only for controlled webhook processing,
reconciliation and account repair.
