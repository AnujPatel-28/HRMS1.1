-- Drop two development artifacts that were shipped to production.
--
-- Both were flagged as leftovers in system-audit-2026-08/04-security-findings.md (S7) and were the
-- last two tables in the database with RLS disabled.
--
-- Verified before dropping (2026-08-14):
--   * public.test_log        — 1 row, single `msg` column, contents: 'Success, count: 3'
--   * public.test_mcp_sync   — 0 rows
--   * No foreign key anywhere references either table
--   * No reference to either name in src/ or functions/
--
-- Dropping these also closes the RLS-disabled gap: afterwards, every table in `public` has row level
-- security enabled.

DROP TABLE IF EXISTS public.test_log;

DROP TABLE IF EXISTS public.test_mcp_sync;
