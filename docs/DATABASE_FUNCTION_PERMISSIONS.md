# Database function permission review

Review date: 3 August 2026  
Environment reviewed: Bendigo Flying Club production Supabase project  
Status: manifest enforced; grant reduction implemented and pending release evidence

## What was found

The production `public` schema contained 178 functions at the time of review. Of
those, 161 were declared `SECURITY DEFINER`, 44 could be executed by the `anon`
role, 79 could be executed by the `authenticated` role, and 32 retained an
execute permission inherited from PostgreSQL's `PUBLIC` role.

`has_function_privilege()` includes permissions inherited through `PUBLIC`, so
these counts overlap. They are exposure counts, not counts of exploitable
functions. Many affected functions also perform their own staff, ownership or
AAL2 checks, and trigger functions normally reject a direct call. The problem is
that a database grant is broader than the intended application contract. A later
change to one of those function bodies could therefore turn an apparently safe
grant into a privilege-escalation path.

Examples requiring explicit classification include membership decisions and fee
waivers, Xero queue helpers, integration API-key and webhook creation, automatic
duty reconciliation, and internal trigger functions. Token-based public
operations, such as narrowly scoped acknowledgement links, may legitimately
remain anonymous when their token validation, expiry, replay protection and data
minimisation are tested.

## Implemented target state

Every production-derived function signature is listed in the version-controlled
`config/database-function-permissions.json` manifest and classified as exactly one of:
manifest as exactly one of:

1. anonymous/token-public;
2. authenticated self-service;
3. staff with server-enforced AAL2;
4. service worker only; or
5. trigger/internal only.

Migration `20260803200000_enforce_function_permission_manifest.sql` revokes
`EXECUTE` from `PUBLIC`, `anon`, `authenticated` and `service_role` for every
public function, then re-grants only the roles in the manifest. It also revokes
the default implicit function grants for future public-schema functions. Of the
178 reviewed signatures, 81 trigger/internal functions have no client execute
grant and only five deliberately public token/configuration functions retain
anonymous execution.

CI runs `npm run audit:function-permissions` and fails on duplicate or invalid
signatures, unexpected anonymous access, client-executable trigger functions,
or a migration that does not enforce the recorded grants. The database
migration itself refuses to run if the live public-function inventory or
security metadata differs from the reviewed manifest.

`SECURITY DEFINER` functions must continue to use a fixed safe
`search_path`, schema-qualified object names, internal authorisation checks and
tests proving denial for every lower-privilege role. New functions must not
receive an implicit `PUBLIC` execute grant.

## Incremental follow-up sequence

1. Keep the exact-signature manifest synchronized with every function migration.
2. Add direct denial tests for anonymous, member, instructor, CFI, admin and
   worker callers as each functional area changes.
3. Continue body-level review of staff functions for server-enforced AAL2,
   fixed `search_path` and schema qualification.
4. Review the final matrix in the independent penetration test and remediate
   any privilege boundary finding before broad integration access.

The grant change is exact rather than name-only: secure email links retain only
their five reviewed anonymous RPCs, browser workflows retain authenticated
execution, workers retain service-role execution, and trigger functions retain
no client execution. Recovery and six-role physical-device acceptance remain
required release evidence so availability regressions are detected outside the
production database.

## Completion criteria

- no application function is executable through PostgreSQL `PUBLIC`;
- every anonymous function is deliberately documented and token-abuse tested;
- staff-sensitive functions enforce AAL2 inside the database or Edge Function;
- worker-only functions cannot be called with browser credentials;
- CI fails when a new or changed function is absent from the manifest; and
- the final grant matrix is independently reviewed during penetration testing.
