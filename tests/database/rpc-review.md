# RPC flight test regression checks

The RPC review is the authoritative assessment. A submitted attempt produces one
linked summary in an active/completed RAAus Ab-Initio enrolment. The course summary
links back to the review; acknowledgement occurs on the review.

Run against an empty, disposable PostgreSQL 17 database with the `anon`,
`authenticated`, and `service_role` roles already created:

```sh
psql -v ON_ERROR_STOP=1 \
  -f tests/database/rpc-review-schema.sql \
  -f supabase/migrations/20260912020000_unify_rpc_flight_tests.sql \
  -f tests/database/rpc-review-workflow.sql
npm run test:rpc-review
```

The schema fixture contains no member data. It includes the production completion,
formal-findings, course-outcome, audit-update, and deficiency guards. Authentication
and unrelated currency helpers are stubbed; this does not replace a full production
schema or authenticated integration test. The SQL workflow rolls back its data.

Assertions cover log-derived details, failed and passed course entries, immutable
original evidence, distinct later flights, inclusive day 30/exclusive day 31,
unchangeable retest ancestry, idempotent draft creation and course synchronisation,
carried competencies, outstanding assessments, refreshed hours, deficiency gates,
and reviewer access. Unit tests cover preservation of existing values and the
original-date boundary across successive attempts.

Migration preservation: existing submitted RPC assessment fields and checklist
items are retained. Only the course link and normal audit metadata change. Old
prefill triggers are replaced so they cannot overwrite private-aircraft details or
new logbook totals. Retest drafts retain prior satisfactory items and their source
IDs, while outstanding items require new assessment. The 30-day window is anchored
to the first unsuccessful test flight, not the date the draft is entered.
