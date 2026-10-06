# Portal data protection — 6 October 2026

## Verified protection

- Production Supabase project: `kcfjnpngnouyvcuvfleu`, Pro plan.
- Seven completed physical database backups verified through `supabase backups list`. Latest verified recovery point: 2026-10-05 19:04:52 UTC (6 October, 06:04 Melbourne).
- Native database restore was **not** run against production. Daily backup retention is seven days; changes after the latest recovery point may be lost on restore.
- Uploaded files are copied by the private Cloudflare Worker `bfc-storage-backup` into R2 bucket `bfc-portal-backups` (Oceania location hint). Public R2 development URL is disabled.
- The Worker checks every 15 minutes and starts a new snapshot when the last completed copy is six hours old. Initial/large copies resume in batches of 20 downloads to respect platform limits. It downloads only new/changed source versions.
- SHA-256 checked on copy and verification. Old source versions and deleted files remain in previous snapshots. `blobs/` and `snapshots/` have 90-day bucket locks. There is no automatic backup deletion policy.
- First snapshot: 38 files / 44,516,701 bytes. A separate local recovery drill downloaded and verified all 38 from R2 without changing production.
- Failures or missing source contents are reported to the portal owner's account only when the incident changes. No routine success notices. If Supabase itself is unavailable, delivery will be retried by later scheduled runs.

## Known recovery gap

Supabase has ten pre-existing file metadata records whose object downloads return missing: one medical PDF, four exam images and five older profile/background images. These are explicitly recorded in each snapshot's `missing` list and cause degraded status. They were not deleted by this work. No exact originals were found in the retained local OneDrive backup directories checked. The owner identified the legacy Wix CMS as the source for the medical and exam originals. Wix CMS tools are not exposed in the current session, and the alternative connector returned no usable Wix actions. Existing local lesson/client CSV exports checked did not contain attachment links. Recovery is pending Wix access; no substitute files were uploaded. Do not delete metadata to conceal the gap.

Existing OneDrive archives and age identities are retained. The OneDrive scheduled jobs remain disabled/removed.

## Operator access and recovery

- Source service key and operator token are encrypted Worker secrets; never put them in source or client code.
- `STORAGE_BACKUP_OPERATOR_TOKEN` is also held as a GitHub repository secret for future independent monitoring. No new GitHub monitoring schedule is currently active.
- Authenticated `GET /status` returns 503 for missing/stale/failed backups. It includes the completed snapshot key and last verification result.
- Authenticated `POST /backup` starts/resumes a copy. A `pending` count means call again; it has not published an incomplete snapshot.
- Authenticated `POST /verify` checks every available file in the latest snapshot. Success verifies the available files, not recovery of entries in `missing`.
- `GET /manifest?snapshot=...` and `POST /file` expose only authenticated recovery access. File downloads must name a bucket/path present in that snapshot.
- To verify independent recovery: set `STORAGE_BACKUP_OPERATOR_TOKEN` and run `node scripts/restore-storage-backup.mjs <new-local-directory>`. It verifies checksums, retains original paths in the manifest and uses hash-named local files to prevent path traversal. It never uploads into production.
- A stale `run.lock` after an interrupted invocation needs operator review. Verify no run is active before removing that single lock object; do not delete snapshots or blobs.
- Restoring production requires choosing a recovery point and assessing affected changes. Database restoration alone does not restore uploaded files.

## Security and stability work

- Supabase leaked-password protection enabled and read back as enabled.
- `duty_geo_distance_metres` now has a fixed `pg_catalog` search path; output checked against known coordinates.
- New inventory RPC is read-only and executable only by `service_role`; anon/member denial was verified.
- The calendar security-definer view was inspected: it explicitly requires portal access and masks private fields for other members. It was not changed simply to silence the advisory.
- DOMPurify updated to 3.4.16 and available compatible dependency patches installed. Expo Location aligned with the SDK patch version; 21/21 Expo Doctor checks passed.
- TypeScript, backup regression tests, production-hardening tests and portal/PWA builds passed.
- Remaining dependency audits: upstream `braces` and `node-forge` issues in build tooling. No audit suppression or forced major framework upgrade was used. These continue to block the repository's dependency gate; the cleanup/safety PR remains subject to that gate.

This is a verified improvement in backup coverage, not a claim that every historic file has been recovered or every possible vulnerability eliminated.
