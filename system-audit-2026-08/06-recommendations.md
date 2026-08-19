# 06 — Recommendations & tech-stack guidance

## A. Do these NOW (hours of work, before anything else)

1. **Drop/revoke the arbitrary-SQL and password RPCs (S1, S2).** No app impact — verified unused.
   ```sql
   DROP FUNCTION IF EXISTS public.exec_sql(text);
   DROP FUNCTION IF EXISTS public.query_json(text);
   DROP FUNCTION IF EXISTS public.update_user_password(uuid, text);
   REVOKE ALL ON FUNCTION public.get_auth_user_details_by_email(text) FROM anon, authenticated, public;
   ```
2. **Enable RLS + add tenant policies on the 10 exposed tables (S3);** drop `test_log`/`test_mcp_sync`.
3. **Make `employee-documents`, `expense-receipts`, `chat-attachments` buckets private (S4);** serve via signed URLs.
4. **Apply all of the above to BOTH the parent (`rq3qmu8y`) and the branch (`rq3qmu8y-jx7`).**
5. **Rotate the anon key and any exposed keys** after closing S1/S2, on the assumption the holes may have been reachable.

> Ship these as one InsForge migration (`npx @insforge/cli db migrations new security-hardening-2026-08`) so they're versioned and repeatable across projects/branches.

## B. Do these THIS SPRINT

6. **Add ownership + server-side hours to `punch_out_attendance` (S5).** Recompute `work_hours` from timestamps; verify caller owns the row.
7. **Add a fixed `search_path` to the 26 SECURITY DEFINER functions (S6).**
8. **DB trigger to reject reporting-line cycles** (don't rely on the client util).
9. **Wire up `check_rate_limit` on login** to throttle credential stuffing.
10. **Move payroll calc — or at least a verification pass — into an RPC** so stored payslip amounts are provably derived from salary structure + attendance, not just trusted from the browser.

## C. The biggest reliability gap: testing & CI

There is **no test framework** — only ad-hoc scripts in `scratch/`. For an HRMS handling pay and PII, this is the top structural risk.

- Add **Vitest** for unit tests. Start with `payroll-calc.ts` (proration, PF/ESI/TDS, LOP, anomaly normalization), `utils/leave.ts`, `utils/attendance.ts`, `managerCycleValidation.ts`.
- Add a **database policy test suite**: for each sensitive table, assert a user in tenant A cannot read/write tenant B (would have caught S3), and that `anon` cannot call privileged RPCs (would have caught S1/S2).
- Add **GitHub Actions CI**: `eslint` + `tsc` + `vitest` on every PR, plus a guard query that fails the build if any table has RLS off while granting DML to `anon`/`authenticated`.

## D. Do you need more tech stack? — targeted answer

**You do NOT need new core infrastructure.** InsForge (Postgres + RLS + RPC + auth + storage + edge functions) is an appropriate, sufficient backend for this system. The gaps are enforcement and process, not missing platforms. Specifically:

| Ask | Verdict | What to add |
|---|---|---|
| Security tooling | ✅ worth it | **Vitest + RLS test suite + CI guard** (above). This is the real "security tech stack" you're missing. |
| Error/uptime monitoring | ✅ worth it | **Sentry** (or equivalent) for the SPA + edge functions. Today failures are invisible. |
| Secrets management | 🟢 fine as-is | `.env` gitignored; keys in env. Just rotate after S1/S2. |
| Rate limiting / WAF | 🟠 partial | Use the existing `rate_limits`/`check_rate_limit` for auth; consider Vercel/Cloudflare rate limits at the edge. |
| Payroll correctness | ✅ process | Server-side recompute RPC + unit tests (not a new vendor). |
| PII/document handling | 🟠 config | Private buckets + signed URLs (S4) — no new tech, just configuration. |
| Observability of DB | 🟢 available | Use `insforge diagnose advisor` / `diagnose db` regularly — it already flags RLS/security/perf issues. |
| New frameworks (Next.js, separate API tier, etc.) | ❌ not needed | The SPA + BaaS split is fine. Don't add an API tier; put invariants in RPCs where they already live. |

**One caveat worth a decision:** if payroll/compliance auditability becomes a hard requirement, consider a thin **server-side payroll service** (an edge function or compute service) that owns the calculation and writes signed, immutable payslip records. That's the only place a *new* runtime is arguably justified — and even that can live inside InsForge edge functions.

## E. Housekeeping
- Remove duplicated function overloads (`approve_task_request`, `hr_activate_draft_employee`, `punch_out_attendance`, `submit_task_request`).
- Prune `scratch/` and the numerous root-level `test-*.js` / one-off SQL files, or move them under a clearly-marked `dev/` dir excluded from deploys.
- Reconcile the `.env` backend target: point production at the intended live project and document it.

---

### Priority ladder (if you only read one thing)
1. S1 + S2 — arbitrary SQL & password takeover → **drop today**.
2. S3 — RLS-off tables with anon grants → **enable RLS today**.
3. S4 — public PII buckets → **make private this week**.
4. Tests + CI guard → **so these never regress**.
5. S5/S6 + payroll server-side + cycle trigger → **this sprint**.

Everything else is polish. The core system is well-architected and, once S1–S4 are closed and tests exist, this is a genuinely reliable HRMS.
