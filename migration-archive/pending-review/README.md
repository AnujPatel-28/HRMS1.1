# Archived Pending Migrations

These migration files were validly named but were not recorded in the updateSuggestion preview migration history when reconciliation started.

They are intentionally moved out of the active `migrations/` root so `npx @insforge/cli db migrations up` does not apply old backlog SQL accidentally.

Before restoring any file from this folder:

1. Check whether its schema changes already exist in the preview database.
2. Check whether it contains destructive statements such as `DROP TABLE`, rollback logic, or broad data deletes.
3. Reintroduce one migration at a time and apply it explicitly with `db migrations up <filename>`.

Known current active modernization migrations:

- `20260630103000_offboarding-safety-foundations.sql`
- `20260630113000_transactional-clearance-updates.sql`

Current audit:

- `new update doc/migration_archive_audit.md`

Current decision:

- Keep all files in this folder archived.
- Restore at most one file at a time.
- Prefer rewriting useful SQL into a new reviewed migration when a file touches auth, storage, RLS policies, cron jobs, payroll, attendance, or destructive table drops.
