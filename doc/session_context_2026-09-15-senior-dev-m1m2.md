# Session handoff — senior-developer session, M1/M2 non-payroll execution

Written 2026-09-15 by Opus 5, ending a long session. **Read this first in the next session.**
Branch `p1-00-harness-reconciliation`, HEAD at time of writing: `e34baab` + the acceptance commit
that follows it.

---

## 1. How to act in the next session

This session ran a specific division of labour that worked. Keep it.

**You are the senior engineer. You do not implement packages.** You survey the live backend, write
briefs grounded in measured defects, hand them to a junior model, then **verify the work yourself
rather than reading the report**. Every package this session was accepted only after independent
re-verification, and that caught real things a report-reading review would have missed.

**The rule that produced every significant find:** run the thing. Four static P6 contract reviews
found nothing wrong with the environment; one read-only `schedules list` found an active cron on the
test branch writing into production. A migration-naming convention error survived five document
reviews and died the first time anyone ran the CLI. Prefer thirty minutes of commands over another
round of reading.

**Check your own alarms before reporting them.** Twice this session I measured something alarming —
RLS at 4/9/0, policy drift at 55, a `docs.google.com` string still present — and each was an artifact
of *when* or *where* I measured. Re-measure before you write it down. A reviewer who cries wolf costs
more than one who is slow.

**Model tiering** (`tasks.md` has per-package assignments, but budget overrides them):
- Opus (you): briefs, reviews, decisions. Not implementation.
- Sonnet: most packages, once the brief names the defects concretely.
- Sol / GPT-5.6 high (Codex, separate budget): reserve for the packages where subtle correctness in
  dangerous existing code matters. The user was down to ~13% at the end of this session.
- Never run several Opus agents in parallel; it hits the spend limit.

---

## 2. Where the work stands

| Package | Status |
|---|---|
| P1-00 harness/target/reconciliation | **Closed at reduced scope** (v0.5). Criteria 5, 9, 11 deferred with owners |
| P1-01 capability seam | **Accepted** `bed95aa` — AC2, AC5 UNTESTED (no runtime failure injection) |
| P1-02 membership/grants/invites/ownership | **Accepted** `5f40414` — AC4 upgraded to PASS on catalogue proof |
| P1-03 dated organization/reporting | **Accepted** `93b4e03` — AC7 PARTIAL (structurally untestable) |
| P2-01 shared calendar resolver | **Accepted** `caf9ec6` |
| P2-02 attendance/corrections/punch-out gate | **Accepted** `98aff7a` |
| P2-03 kiosk/device | **BLOCKED — hardware, not software** |
| P2-04 leave workflow/absence | **Accepted** `562a7d4` — AC5 split, AC6 feature gap |
| P3-01 policy privacy/versioning | **Accepted** `e34baab` |
| **P3-02 projects/membership/task lifecycle** | **NEXT** — brief not yet written |
| P3-03 realtime/storage communication | Last security-critical package. **Reserve Codex budget for it** |

Plan documents are `doc/execution/non-payroll-monday/` — `tasks.md` v0.5 and `contracts.md` v0.5 are
normative; `reconciliation.md` carries the environment record; `reviews/` has a package review for
every accepted package, each listing what was verified independently.

---

## 3. The environment, and the two things that can hurt you

**Test backend `TB-M1M2`** is a full branch of the parent: project `fb9a8659-9950-4637-a58e-4a882ef24419`,
`https://rq3qmu8y-j9g.ap-southeast.insforge.app`. **Never write to the parent
`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`.** The harness guard (`npm run test:m1m2:target`) fails closed
on wrong project, BASELINE-RO, branch lineage and unsafe CLI arguments.

Fixtures: `npm run test:m1m2:seed`, `:personas`, `:reset`. Password in
`tests/m1m2/persona-password.local` (git-ignored, `*.local`). **The invariant every package reports
is 1 / 2 / 0** — Company A `employees` as employee.a / hr-employee.a / employee.b.

**Two standing hazards:**

1. **`attendance-derivation-hourly` is repointed to the branch host and `isActive: false`.** It spent
   a day firing into production. Any lane needing derived rows must enable it explicitly, verify the
   URL contains `-j9g`, and set it back. **Whether `branch reset` re-arms it is still unmeasured** —
   nobody has run a reset. Measure it the first time someone does.
2. **No backup exists and the schema is not reconstructible from `migrations/`.** `backups list`
   returns empty. `migrations/` was never a schema source — 45 objects including `tenants` and
   `employees` are created by no repo file, and `db export` corrupts RESTRICTIVE policies into
   PERMISSIVE. P3-01 added a second item to this debt: the `hr-policies` privacy flag cannot be set
   from SQL, so a migration-only rebuild comes up public again.

---

## 4. Open items with no owner

These are real and nobody is assigned:

- **`employee-documents` and `expense-receipts` are public buckets holding personal data.** Same
  exposure `hr-policies` had, confirmed by bucket listing, untested. Needs a small package.
- **No re-derivation entrypoint for an already-derived attendance day** (`reconciliation.md` §14.2).
  Cancelling leave restores the data but not the displayed status.
- **`day_fraction` has a read path and no write path** — half-day leave is unreachable (§14.3).
- **`employee_apply_leave_request` still uses server-UTC `CURRENT_DATE`** for minimum-notice and
  joining eligibility (§14.1). In IST that is yesterday until 05:30.
- **The legacy `manager_id` fallback in `is_manager_of` is dead code** — zero employees rely on it.
  Needs a removal trigger (`reviews/package-review-P1-03.md` §3).
- **P1-00 deferred trio:** policy/grant classification (criterion 5), credential rotation (9),
  database-function classification (11).

---

## 5. User actions that never happened, and why they matter

Raised repeatedly; still outstanding. State them once per session, then drop it.

1. **`git push`.** ~23 commits sit only on a local branch. I am sandbox-blocked from pushing to a
   public repo — the user must run
   `git push -u origin p1-00-harness-reconciliation`. I scanned all outgoing commits: no keys,
   `persona-password.local` never committed.
2. **`backups create`.** One command. There is no restore path and the schema exists nowhere else.
3. **`secrets rotate api-key`.** An admin key (`ik_48f0f767…`) is in committed history of a **public**
   GitHub repo. Safe for the frontend — `.env` holds a proper `anon_…` key — so rotating only
   invalidates the local `.insforge` link, fixed with `link --project-id`.

---

## 6. Traps this repo keeps re-teaching

Each of these cost real time, more than once:

- **`CREATE OR REPLACE FUNCTION` with an appended DEFAULT parameter creates a second overload**, it
  does not replace. P2-01 nearly shipped two live business-date functions. Always assert `pg_proc`
  holds one row per name afterwards.
- **Dropping a unique index orphans every `ON CONFLICT` that inferred it.** Recurred in P2-04:
  `approve_leave_request` was silently inserting phantom evidence-free attendance rows.
- **RLS does not backstop a `SECURITY DEFINER` function.** Every definer needs its own tenant fence,
  a pinned `search_path`, and no `anon` EXECUTE.
- **A PERMISSIVE policy is a grant**, it ORs with the others. A tenant fence must be RESTRICTIVE.
- **RLS cannot scope columns.** The pattern that works, established in P2-02 and reused in P2-04:
  reads policy-scoped, writes revoked at **both** GRANT and policy level, mutations through definer
  RPCs with an explicit column allowlist.
- **Migration filenames use hyphens**, not underscores; the CLI rejects underscores.
- **A PostgREST self-referencing embed returns children, not the parent** — silently.
- **`db query` chokes on aggregates** (`array_agg` error). Use plain row selects and aggregate in
  Node.

---

## 7. What the next session should do first

1. Confirm the three user actions in §5 — especially the push, or a bad afternoon costs everything.
2. Write the **P3-02 brief** (projects, membership, task lifecycle, migration `20260912188000`).
   Survey first: project membership does not exist yet — `project:<id>` scope is explicitly
   unadvertised until P3-02 provides and enforces it (`contracts.md` §3), and the capability resolver
   currently filters project/channel grants out at emit time. P3-02 is what makes them real.
3. Then **P3-03**, the last security-critical package: realtime cross-tenant isolation with raw
   socket evidence. The contract is explicit that **client-side filtering is not evidence**. Global
   `chat_messages` / `chat_channels` topics and the `'chat:' || channel` name collision are the known
   risks. Reserve the remaining Codex budget for it.
4. P2-03 stays blocked until hardware exists. Do not let a package claim it.
