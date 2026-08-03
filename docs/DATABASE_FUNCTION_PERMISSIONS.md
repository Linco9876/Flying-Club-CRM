# Database function permission review

Review date: 3 August 2026  
Environment reviewed: Bendigo Flying Club production Supabase project  
Status: remediation required; no confirmed privilege-escalation exploit

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

## Required target state

Every function signature must be listed in a version-controlled permission
manifest as exactly one of:

1. anonymous/token-public;
2. authenticated self-service;
3. staff with server-enforced AAL2;
4. service worker only; or
5. trigger/internal only.

Each migration must revoke `EXECUTE` from `PUBLIC` first and then grant only the
classified roles. `SECURITY DEFINER` functions must use a fixed safe
`search_path`, schema-qualified object names, internal authorisation checks and
tests proving denial for every lower-privilege role. New functions must not
receive an implicit `PUBLIC` execute grant.

## Safe remediation sequence

1. Add default-privilege revocation for future functions.
2. Inventory exact signatures and their application callers.
3. Revoke trigger/internal and clearly worker-only functions first.
4. Migrate staff functions to explicit AAL2 and role checks, then narrow grants.
5. Test anonymous, member, instructor, CFI, admin and worker access after each
   batch.
6. Deploy in small batches with database and Edge Function rollback scripts.

A blanket revoke is deliberately not being applied in one release. It could
silently break sign-up, secure email links, booking rules or queue workers. The
incremental approach reduces the current exposure without trading it for an
uncontrolled availability incident.

## Completion criteria

- no application function is executable through PostgreSQL `PUBLIC`;
- every anonymous function is deliberately documented and token-abuse tested;
- staff-sensitive functions enforce AAL2 inside the database or Edge Function;
- worker-only functions cannot be called with browser credentials;
- CI fails when a new or changed function is absent from the manifest; and
- the final grant matrix is independently reviewed during penetration testing.
