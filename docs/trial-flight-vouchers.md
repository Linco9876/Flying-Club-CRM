# Trial Flight Gift Vouchers

This checklist covers the Bendigo Flying Club trial instructional flight voucher flow.

## Customer Flow

- Public sales page: `/trial-flight-gift-vouchers`
- Voucher redemption and restricted booking page: `/trial-flight-voucher`
- Voucher links should use `voucherCode` or `code` in the query string so the code is prefilled.
- A redeemed voucher creates a restricted `trial_voucher` portal account. That account must only be used to choose the voucher booking time.

## Admin Flow

- Admin page: `/gift-vouchers`
- Create one product per voucher type, for example Tecnam and PA-28 Archer.
- Configure:
  - voucher duration in minutes
  - price and optional Stripe Price ID
  - eligible aircraft mode or selected aircraft
  - instructors allowed to fly that voucher
  - email subject/body and booking instructions
- A product should not be activated unless there is at least one serviceable matching aircraft and at least one selected instructor qualified for one of those aircraft.

## Availability Rules

- Booking block = voucher flight duration plus 30 minutes.
- Tecnam vouchers can use any serviceable matching Tecnam.
- Archer vouchers require a serviceable PA-28 Archer.
- The instructor must be rostered/available, not absent, and qualified for the aircraft.
- Voucher bookings are created through the database function `book_trial_flight_voucher_slot` so overlap and eligibility checks are enforced server-side.

## Database Security Invariants

- Voucher holder accounts use `portal_access_scope = trial_voucher` and must stay restricted to the voucher booking flow.
- Trial voucher accounts may read only their own voucher and their own linked voucher booking.
- Normal CRM tables such as training records, flight logs, invoices, safety data, student documents, syllabi, and matrix assessments must stay behind `current_user_has_full_portal_access()`.
- Voucher product and voucher tables must have row-level security enabled.
- Voucher booking creation must go through the service-role Edge Function path and the `book_trial_flight_voucher_slot` database function.
- The `prevent_trial_voucher_booking_overlap` booking trigger must remain installed so direct booking inserts/updates cannot bypass duration, overlap, aircraft, instructor, roster, or endorsement checks.

## Required Supabase Edge Function Secrets

Set these in the Supabase project Edge Function secrets before enabling live voucher sales:

- `PUBLIC_SITE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL`
- `BREVO_SENDER_NAME`
- `TRIAL_VOUCHER_INTERNAL_SECRET`
- `TRIAL_VOUCHER_CRON_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

`TRIAL_VOUCHER_INTERNAL_SECRET` is used when one voucher function calls another internally.
`TRIAL_VOUCHER_CRON_SECRET` protects scheduled recipient email delivery.

## Required GitHub Actions Secrets

Set these repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_URL`
- `SUPABASE_URL`
- `TRIAL_VOUCHER_CRON_SECRET`

The voucher function deployment workflow runs Deno checks before deploying. The due-email workflow calls `send-trial-voucher-email` every 10 minutes to send scheduled recipient voucher emails.

## Stripe Setup

- Use **Connect Stripe** in `/gift-vouchers` to open the Stripe API key screen.
- Add the Stripe secret key to Supabase Edge Function secrets as `STRIPE_SECRET_KEY`. Do not paste secret keys into the browser UI or database.
- After a voucher product has been saved with a real AUD price, use **Create & link Stripe** in the product editor to create a Stripe Product and Price from the CRM product and automatically save the Stripe Price ID.
- Alternatively, create Stripe products/prices manually and copy the Stripe Price ID onto the matching voucher product in the CRM.
- Use the admin product editor's **Check Stripe ID** action to verify the pasted Stripe Price ID exists in Stripe, is active, uses AUD, and matches the CRM sale price.
- Set the Stripe webhook endpoint to:

```text
https://<supabase-project-url>/functions/v1/trial-voucher-stripe-webhook
```

- Configure the webhook signing secret as `STRIPE_WEBHOOK_SECRET`.
- At minimum, send checkout session completion/expiry related events to the webhook.

## Verification Before Live Sales

Run these repo checks:

```bash
npm run check:vouchers
npm run test:vouchers
npx --yes deno check --node-modules-dir=false supabase/functions/trial-voucher-public/index.ts
npx --yes deno check --node-modules-dir=false supabase/functions/trial-voucher-admin/index.ts
npx --yes deno check --node-modules-dir=false supabase/functions/create-trial-voucher-checkout/index.ts
npx --yes deno check --node-modules-dir=false supabase/functions/send-trial-voucher-email/index.ts
npx --yes deno check --node-modules-dir=false supabase/functions/trial-voucher-stripe-webhook/index.ts
npm run build
```

Then verify live:

- Migrations have run on the Supabase project.
- All five voucher Edge Functions are deployed.
- Run the live smoke test against the deployed project:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_ANON_KEY=<anon-key> npm run smoke:vouchers
```

Optional smoke-test variables:

- `VOUCHER_TEST_CODE` verifies a real issued voucher code.
- `TRIAL_VOUCHER_CRON_SECRET` verifies the scheduled due-email endpoint.

- A public customer can see only active and ready voucher products.
- A test checkout creates a voucher and sends the styled voucher email.
- Scheduled recipient delivery sends only after the selected delivery time.
- A voucher code/link verifies and creates a restricted account with full name, email, and phone only.
- The restricted account cannot access normal CRM pages or the public sales page while signed in.
- Password setup/reset links for voucher accounts return to `/trial-flight-voucher`.
- Available slots respect aircraft, instructor, duration plus 30 minutes, instructor absence, and existing bookings.
- Booking a slot creates a normal booking linked to the voucher.
- Direct database booking attempts with the wrong duration, unavailable aircraft/instructor, wrong aircraft type, unqualified instructor, or overlapping time are rejected.
