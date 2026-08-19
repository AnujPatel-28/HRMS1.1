# System Audit — 2026-08-12

Independent architecture & security audit of TalentMesh HRMS, derived from **source code + the live production database** (not from the existing repo `.md` docs).

> Internal security assessment — keep in-repo, do not publish, contains no secrets by design.

## Read in order
1. [`00-executive-summary.md`](./00-executive-summary.md) — verdict, top findings, is-it-reliable answer.
2. [`01-architecture.md`](./01-architecture.md) — stack, request flow, tenancy model.
3. [`02-database-and-rls.md`](./02-database-and-rls.md) — 57 tables, RLS map, function/grant analysis (live-verified).
4. [`03-modules.md`](./03-modules.md) — every module's call path: component → hook → db/rpc/function → table.
5. [`04-security-findings.md`](./04-security-findings.md) — severity-ranked findings S1–S7 with fixes.
6. [`05-edge-cases.md`](./05-edge-cases.md) — edge cases handled vs missed.
7. [`06-recommendations.md`](./06-recommendations.md) — prioritized fixes + tech-stack guidance.

## TL;DR
Well-architected, feature-complete multi-tenant HRMS with a mostly-solid RLS foundation and genuinely good transactional leave/attendance logic — **undermined by a few catastrophic but easy-to-fix holes**: `anon`-callable arbitrary-SQL and password-reset RPCs (S1/S2), 10 RLS-disabled tables with anon grants (S3), and public PII buckets (S4). Close those, add tests/CI, and it's a reliable system. No new core tech stack required.
