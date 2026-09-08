# Private aircraft instruction

The preloaded **Private aircraft** option is disabled initially. Administrators can enable it and set instruction-only rates under **Settings → Billing & Rates → Private aircraft instruction**. Rates can vary by Payment Type and include the existing fixed-fee, no-charge, surcharge and payment-method rules. Save these settings using **Save private aircraft settings**. Optional logging fields use **Settings → Flight Log Form → Private aircraft**.

Selecting the option requires an instructor, aircraft type and registration. Bookings reserve the instructor; concurrent private aircraft bookings do not conflict with the shared option. Matching registrations generate an advisory warning. Normal instructor availability, duty and supervision checks continue to apply.

Log actual flying duration in decimal hours. All private instruction is dual time; any separately charged ground briefing uses a ground session. Each log preserves the actual aircraft details and applied rate. Corrections to the logged aircraft update linked training records. Student and instructor flying hours include private flights, while fleet profiles, maintenance and fleet utilisation exclude the system option. Guest flights retain the same details through the existing guest workflow.

Disabling the option prevents new selections and new bookings. Existing bookings remain editable and completable. Historical logs retain their rates when settings change. A stale price at submission is rejected so the operator can reload and review the current amount. An existing payment, Stripe checkout or Xero invoice prevents changes to the charge until linked billing is reversed through the existing correction workflow.

## Stripe and Xero

Private instruction uses the existing flight-log charge pipeline, Stripe checkout/saved-card handling, Xero invoice creation, Payment Type accounting codes, tax handling and reconciliation. Descriptions use the actual private registration. No fleet tracking option is assigned automatically. Disconnected providers retain the existing behaviour: logs are saved without financial data.

The configuration row uses reserved ID `00000000-0000-4000-8000-000000000001` so existing rate, field-setting and accounting foreign keys remain usable. It is not an individual aircraft and must not acquire a fleet profile or cumulative meter history.

## Rollout

Deploy as one coordinated release:

1. Apply `20260909120000_private_aircraft_instruction.sql`.
2. Deploy `create-flight-payment-checkout`, `charge-flight-saved-card` and `xero-sync`.
3. Deploy the frontend, configure rates, then enable Private aircraft.
4. Configure and enable the option when ready. Connected Stripe/Xero acceptance testing is deferred at the user's request; no provider transactions are performed for this release.

Local browser verification used dummy credentials and mocked backend/provider responses. Release checks use static analysis and local tests without calling Stripe or Xero.

## Verification

- TypeScript, changed-file ESLint, production portal build and migration/function-permission audits.
- Focused Node tests covering pricing, private resource conflicts, registration warnings, logbook identity, ground billing, flight-log rules and recurring edits.
- All three modified financial edge functions pass `deno check`.
- The full migration compiles in a disposable PostgreSQL 17 fixture. Database assertions cover disabled bookings, administrator access, rate validation, instructor conflicts, historical completion, guest identity, training-record corrections, price snapshots, stale prices, paid/invoiced charge protection and system-row protection. Unrelated application dependencies are stubbed in this fixture; it is not a full Supabase deployment test.
- Separate database connections verify simultaneous private bookings and competing instructor reservations.
- Playwright CLI checks the real forms using mocked backend/provider responses: private selection and required fields, desktop/mobile flight logging, and a $180 log dispatching both Stripe checkout and Xero invoice sync. No live provider transaction has been verified.

Run the focused utility tests with `npm run test:private-aircraft`.

For SQL tests, create a **new disposable database** on a local PostgreSQL server, named `private_aircraft_test_v2`, then run:

```powershell
psql -X -h 127.0.0.1 -p 55441 -U postgres -d private_aircraft_test_v2 -f tests/database/private-aircraft-fixture.sql -f tests/database/private-aircraft-assertions.sql
node tests/database/private-aircraft-concurrency.mjs
```

The concurrency script accepts `PRIVATE_AIRCRAFT_TEST_PORT` and `PRIVATE_AIRCRAFT_TEST_DATABASE`; it only connects to loopback and requires a test database name. Never run the fixture against the CRM database.
