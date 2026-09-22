# Session handoff — cleanup C1–C2 done, C3–C6 briefed (2026-09-22)

Written by Opus 5 (senior engineer / lead) at the end of a long session. **Read this first**, then
`doc/session_context_2026-09-21-p3-complete.md` (production promotion order, rules) and
`doc/session_context_2026-09-15-senior-dev-m1m2.md` §1 (how to act) and §6 (traps).

---

## 1. Your role, and how this session worked

You are the **senior engineer**. You survey the live test backend, write briefs grounded in measured
defects, hand implementation to a cheaper model, then **verify the result yourself** — re-running
probes and every test suite — before accepting. Every package this session was accepted only after
independent checks, and those checks caught real defects in four of five packages.

**Budget note (user, 2026-09-22):** Sonnet subagents were consuming a lot of usage and hit the limit
twice mid-task. **The user asked for work to be done in-session rather than via Sonnet.** For small
packages, implement directly; if you do delegate, use Haiku for mechanical work and keep Sonnet for
packages with real judgement. Never run agents in parallel.

**"Run the thing."** Prefer live probes over reading. **Re-measure before reporting an alarm** — twice
this session a query failed silently (empty output, not an empty result) and looked like a finding.

---

## 2. Status

M1/M2 non-payroll **security** scope is complete (P1–P3, see the 09-21 handoff). This session:

| Pkg | Commit | Result |
|---|---|---|
| P3-02b | `b1a674e` | project/channel scopes advertised from the same predicate the server enforces. **Prod: deploy frontend BEFORE migration `191000`.** Also repaired 3 stale P1 suites (revocation coverage had been dark since P3-03) |
| **C1** | `cc694cc` + lead `108934c` | employees could set own `work_mode=remote` (bypasses geofence), bank, PAN, grade, kiosk PIN… → contact-only allowlist. Manager "Add team member" → reviewable new-hire request. **Lead fix `192200`**: onboarding window was open for 15/17 employees (no row = open) and self-grantable |
| **C2** | this session's final commit | 7 functions moved off server-UTC `CURRENT_DATE` to `tenant_business_date`; verified against the parent's true pre-C2 bodies — date expressions only |

Reviews: `doc/execution/non-payroll-monday/reviews/package-review-{P3-02b,C1,C2}.md`.
Plan: `doc/execution/non-payroll-monday/tasks.md` (cleanup table near the end).

**All 16 suites in `tests/m1m2/` pass** (only `p3_realtime_isolation` item 6, an accepted InsForge
platform limit). Policy drift 44 untracked (baseline). Build clean.

---

## 3. Next — C3 to C6 (briefed in `prompts/c2_c6_cleanup_packages_2026-09-22.md`)

Do them **in order, one at a time** (TB writes are serialized; C5 depends on C4):

1. **C3 — manager_id convergence. Do this next; it has a live data exposure.**
   - `managers_can_view_own_draft_reports` (SELECT `manager_id = me`) shows a manager each report's
     **full employee row — bank, PAN, Aadhaar**.
   - `managers_can_delete_own_draft_reports` lets an employee delete rows shaped like exited reports.
   - `MyTeam.tsx` lists the team *through* the first policy, and its cancel button deletes an
     employee row; `EmployeeCreate.tsx` edit path writes `manager_id` around the reporting RPC.
   - Then remove the dead `is_manager_of` fallback (assert no orphans first).
2. **C4 — re-derive one attendance day** (cancelled leave stays `on_leave`). Never overwrite
   `is_locked`; never destroy punch evidence.
3. **C5 — half-day leave** (user decision: build now). New apply signature → DROP old then CREATE.
4. **C6 — P3 residuals**: post edit RPC (author can set type/pin), owner can delete HR-issued files in
   own folder, dead `posts` subscribes in layouts, stale test text.

Then **payroll** (last module: research + decision lock first), then production promotion.

---

## 4. Environment facts you will need

- Test backend **TB-M1M2** `fb9a8659-9950-4637-a58e-4a882ef24419`. **Never write to the parent
  `0431f0f6-…`.** `npm run test:m1m2:target` before any write. CLI:
  `node node_modules/@insforge/cli/dist/index.js` (not npx).
- **Reading the parent safely** (read-only comparison, e.g. true pre-change function bodies): link a
  **throwaway folder** (`cd $TEMP/x && node <cli> link --project-id 0431f0f6-…`), query with
  `--json`, delete the folder. The repo's own link never moves. See `scratch/c2-parent-diff.mjs`.
- `db query` output is flaky for aggregates and sometimes prints nothing on failure — use `runSql`
  from `tests/m1m2/_harness.mjs` in a small node script for anything that matters.
- Storage objects cannot be deleted by SQL — remove via the SDK as the uploader.
- TB storage CDN occasionally times out (`UND_ERR_CONNECT_TIMEOUT` / `fetch failed`) — re-run once.
- Broken persona fixture → `npm run test:m1m2:personas` (idempotent). RLS invariant **1 / 2 / 0**.
- `attendance-derivation-hourly` schedule is repointed to TB and **inactive** — don't enable it.

## 5. Rules that caught real bugs (also in memory)

- Re-run **every** `tests/m1m2` suite at acceptance; never accept "pre-existing failure" unread.
- Fixture-only suites miss existing rows — count real data against any new authority table.
- Widening a SELECT policy widens every check keyed on "can see the row".
- A gate an employee can reopen is not a gate — check who can write the row the gate reads (C1).
- Derive function bodies from the live definition; verify against the **parent**, not `migrations/`.

## 6. User actions still outstanding

1. **`git push`** — ~30 commits exist only on this laptop.
2. **`backups create`** — there is still no backup; the schema is not reconstructible from `migrations/`.
3. An untracked `doc/ui-ux-audit-2026-09-22/` folder appeared this session (not created by the lead);
   it is uncommitted — the user should decide what it is.
