# Bendigo Flying Club CRM Capability Guide

This guide describes the operational capabilities of the Bendigo Flying Club (BFC) CRM and the controls that must remain true as the portal evolves.

## Core platform

- React/Vite member and staff portal hosted on Cloudflare Pages.
- Supabase authentication, PostgreSQL data, row-level security, scheduled lifecycle jobs and Edge Functions.
- Role-based access for members, instructors, senior instructors and administrators.
- Aircraft bookings, flight records, training, instructor duty, senior-instructor supervision, maintenance, safety, billing, Xero and Stripe integrations.
- A separate lightweight Duty Clock application uses the same Supabase duty records.

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

Saving a card or BECS mandate requires explicit payment authority. Selecting **automatic annual payment** is also optional and unchecked by default. The initial membership invoice may be collected using the selected saved method after membership commences; future annual invoices are collected automatically only when annual payment authority remains enabled. No membership payment is taken while an application is still pending.

Xero remains the accounting source of truth. Successful Stripe collections are applied to the matching Xero invoice through the configured Stripe clearing account and the webhook updates the CRM from that result.

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
- Logged flight time pre-fills actual flight time in duty-period entry.
- If an instructor has not clocked in, duty is automatically inferred from 30 minutes before their first flight.
- If they do not clock out, the system assumes the configured maximum allowed duty duration.
- Booking checks forecast duty exposure from recorded duty, inferred duty and that day's bookings. Warnings may be overridden only with a reason; the source duty records remain unchanged.
- Administrators designate authorised senior instructors and their supervision priority.
- Instructor bookings requiring supervision remain pending unless an authorised senior instructor is available.
- The assigned supervisor appears in small print on the booking. If that person becomes unavailable, the booking moves to the next available authorised supervisor; if none remains, senior instructors are warned and the booking returns to pending.

## Deployment checklist for the membership change

1. Review and push `supabase/migrations/20260721120000_add_club_membership_management.sql`.
2. Deploy the `xero-sync`, `member-xero-balance`, `membership-payment-setup` and `trial-voucher-stripe-webhook` Edge Functions.
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
