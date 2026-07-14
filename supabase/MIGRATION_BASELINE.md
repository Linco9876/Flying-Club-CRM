# Supabase migration baseline

The migration history was rebased on 14 July 2026 because the repository and
the linked production project had accumulated different histories through a
mix of Bolt, dashboard, CLI, and direct SQL changes.

`20260714024330_remote_schema_baseline.sql` is a schema-only snapshot of the
linked production database. It also contains the current storage bucket
definitions and object policies. No production data is stored in the
migration.

Before the rebase:

- production schema, data, roles, and storage configuration were dumped to a
  local ignored backup directory;
- the baseline was applied twice to a fresh local Supabase database;
- local and production counts matched: 87 public tables, 279 public policies,
  28 storage object policies, 8 storage buckets, and 41 public routines;
- the production schema itself was not changed by the history repair.

The earlier migration files remain available in Git history before commit
containing this baseline. New schema changes must be created with
`supabase migration new <name>` and committed after the baseline.

Run these checks before pushing a schema change:

```powershell
npm run audit:migrations
supabase db push --linked --dry-run
```

Do not use `migration repair` merely to make a failed deployment pass. Review
the schema and migration history first.
