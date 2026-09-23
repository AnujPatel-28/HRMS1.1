# Session handoff: v0.9.1 in production; next is UI/UX, then biometric handoff, then docs (2026-09-23)

Written by Opus 5.5 (senior engineer / lead) at the end of the session. **Read this first.** It replaces
`doc/session_context_2026-09-23-cleanup-complete.md` as the entry point. That file stays valid for its
§5 environment facts and traps, which still apply and are not repeated in full here.

---

## 1. Role and working rules (unchanged, owner-confirmed)

- You are the **senior engineer / lead**. Do the work **in-session**. Don't delegate implementation to
  Sonnet agents; the owner hit usage limits before. A `web-fetch` agent for reading URLs is fine.
- **Measure before you fix.** Write the failing test first and keep the before and after logs. Derive
  changed function bodies from live `pg_get_functiondef()` with an anchored generator (pattern:
  `scratch/c10-gen.mjs`, `scripts/tools/derive-function-body-example.mjs`).
- **Accept only after every suite runs** (`tests/m1m2/`, now **23**) with exit codes captured as
  `node $f > log 2>&1; rc=$?`, plus a grep of every log for `AssertionError|HarnessBlocked|^FAIL`.
- Report to the owner in plain language. They are the product owner, not a database engineer.
- **The owner wants the repo to meet industry standard, with docs that are never false.** A doc that
  can't be verified gets archived, not trusted.

## 2. Where things stand

| Thing | State |
|---|---|
| Production | **v0.9.1 live** (tags `v0.9.0`, `v0.9.1`; GitHub releases published). `main` = `6a31d85` (PR #2). Migration head **`20260923162654`** (146 applied). Payroll hidden. |
| Release record | `doc/release/v0.9.0-production-promotion-runbook.md` (Status + Release log), `v0.9.0-rehearsal-report.md`, `CHANGELOG.md` |
| Test backend | TB-M1M2 `fb9a8659…`, at the same schema as production (C10 applied). CLI linked to TB; guard passes. |
| Branch slots | TB-M1M2 plus **one free slot** (rehearsal branch and `updateSuggestion` deleted) |
| Backups | 1/1 manual slot used: `pre-v0.9.0-2026-09-23` (`efd811db`). A new backup needs that one deleted first (owner decision). C10 rollback bodies are in `doc/release/rollback/`. |
| Repo | **Public** (owner's call; see §5.2). Branch `p1-00-harness-reconciliation` is merged into `main`, and new work should branch from `main`. |
| Prod schedule | `attendance-derivation-hourly` is **active** on production (owner kept it). C8 marks no-punch shifted days `absent` within a 2-day lookback. |

Accepted today, in order: rehearsal (rc.1) → **v0.9.0** production release → **C10** (leave review
authorizes before it reveals; 6/11 → 11/11; 23/23 suites; production verified) → **v0.9.1**.

## 3. What to do next, in the owner's order

### 3.1 UI/UX design (next session starts here)

- **Input:** `doc/ui-ux-audit-2026-09-22/` (committed). Its README recommends redesigning navigation
  and the key journeys, not a rewrite. The promise is: "Know what needs you, finish it, and know it
  worked."
- **First deliverable: a short plan for the owner to approve before any screen changes.** Cover:
  - one shell with **My Work / Team / Administration**, by capability (the checks already exist)
  - the five daily interactions: clock in/out, request leave, review a request, submit work, resolve an
    attendance issue
  - correct the misleading home-screen numbers
  - consistent behaviour of optional modules when switched off
  - payroll-off boundary items (`04-launch-without-payroll.md`: onboarding fields, exits "external
    finance clearance", no payroll text anywhere)
- **Versioning:** each UI/UX batch is a `0.x` minor (`0.10.0`, `0.11.0`, …). `1.0.0` = first real customer.
- **How:** branch `feat/ui-…` from `main`, one PR per batch, mobile width must work, and the
  `bundle-marker` check after each deploy. A UI batch that needs a migration follows the frontend-first
  and deploy-skew rules (memory: deploy skew).
- Use the frontend-design skill or the Artifact tool for mockups if the owner wants to see options.

### 3.2 Hand the biometric track (Track B) to the teammate

- **Docs:** `devloper_doc/attendanceModule/12-track-b-biometric-build-plan.md` (+ 10, 11). Before
  handing over, **re-verify doc 12 against today's state**:
  - the teammate should branch from `main` now, not from `p1-00-…`
  - one branch slot is free, so they can create `tb-biometric`
  - migrations use `db migrations new` (C10 was the first; it works)
- **Owner decisions still open** (doc 12 §4): O1 gateway hostname, O2 Cloudflare account, O3 access
  for the teammate (GitHub, InsForge org, Cloudflare), O4 buy SpeedFace V5L + MB160 (returnable).
- The lead reviews each D-package PR against doc 12 §2 "Acceptance".

### 3.3 Developer-docs accuracy pass (then the repo restructure)

Evidence gathered 2026-09-23 (grep of `devloper_doc/` against the live feature set):

| Doc set | Last touched | Known gaps |
|---|---|---|
| `attendanceModule/` (13 files) | 2026-09-23 | mostly current. Check against C4 (Recalculate), C5 (half-day), C8 (absence watermark) |
| `leaveModule/` (7) | 2026-08-31 | no half-day (`allow_half_day`), no `assert_leave_reviewer` / C10 ordering, no re-derive on cancel (C4) |
| `onboardingModule/` (7) | 2026-09-03 | no new-hire requests (C1), no access/invitation model (P1) |
| `organizationModule/` (8) | 2026-09-03 | reporting authority changed (C3); access model (memberships, capabilities) missing |
| **missing entirely** | — | tasks/projects, chat/Connect, policy center, exits/offboarding, users & access (P1), storage/buckets, expenses |

Method: verify every claim against live TB (functions, policies, columns) or the code. Add
`Owner:` and `Last verified: YYYY-MM-DD` headers. Anything unverifiable goes to archive. Then the
repo restructure per `doc/i-want-to-maintain-serene-feigenbaum.md` (four doc lifecycles, ADRs,
AGENTS.md in-repo, CONTRIBUTING, CI with lint/tsc/policy-drift/gitleaks), on branch
`chore/repo-structure`, with memory paths updated in the same commit.

### 3.4 Smaller follow-ups (not yet scheduled)

- **Low-risk existence leaks** (C10 sweep): `accept_owner_transfer` (NOT_FOUND vs TARGET_REQUIRED) and
  `hr_activate_draft_employee` ("profile not found" before the HR check; it also reads the role from JWT
  metadata; a legacy 9-argument overload is still deployed).
- Payroll findings for the payroll track: `declarations_self_all`, `payroll_runs_tenant_select`,
  half-day LOP.
- Payroll-off product work (new tenants provisioned payroll off; month-end attendance/leave CSV export)
  from the repo plan §6. It can merge into the UI/UX plan.

## 4. New environment facts and traps (learned today; §5 of the previous handoff still applies)

1. **Re-link rule:** to point the CLI at a branch, run `link --project-id <parent>` and then
   `branch switch <name>`. **Never** `link --project-id <branch-id>`: it drops the lineage, and the
   harness guard then refuses TB (`BRANCH_LINEAGE_MISMATCH`).
2. **New branches serve no functions** until each is redeployed. The list shows them as `active`, but the
   host returns 404. Function writes are **rate-limited** (about 15 per few minutes: "Too many
   functions write requests"), so wait 60 s and retry.
3. **The CLI refuses a migration older than the target's head.** Create migrations with
   `db migrations new` (real timestamp).
4. **A connection reset during `db migrations up`:** check `db migrations list` **and** whether the
   migration's objects exist before retrying (a positive-controlled `pg_proc` check). `199000` rolled
   back cleanly and a retry was safe.
5. **Storage buckets:** migrations `187000`/`189000`/`190000` require buckets to be private around
   them. Use `scripts/tools/bucket-private.mjs` (production only with `--production`, and only when
   linked to the parent).
6. **Tools:**
   - `scripts/tools/bundle-marker.mjs <symbol>` checks the live site's JS chunks for a symbol.
   - `scripts/tools/rehearsal-smoke.mjs [--production] <label>` runs the QA-tenant sign-in smoke.
   - `M1M2_TARGET=<name>` in `tests/m1m2/_target.mjs` selects a non-TB branch target.
7. **Vercel Hobby + a private repo:** deploys are **Blocked** when the commit author is not the Vercel
   account's linked Git login. The Vercel account `talentmeshdb-8813` differs from GitHub `AnujPatel-28`.
8. **Auto-mode safety check:** it blocks pushes to `main` and edits to Claude's own settings. Merge by
   PR (`gh pr create/merge`), or ask the owner to run the command with `!`. Don't work around it.
9. Leave has **no `updated_at`**. Snapshot rows with `row_to_json()` in tests.
10. `tests/m1m2/c10_leave_review_order.mjs` uses fixture ids `a2a00000-…`; keep new suites out of that
    namespace.

## 5. Owner actions outstanding

1. **Remove the temporary `/permissions` allow rules** added for the v0.9.0 release.
2. **Repo visibility:** it is public now. To make it private again without blocking deploys, first
   connect GitHub `AnujPatel-28` to the Vercel account `talentmeshdb-8813`, or move to Vercel Pro.
3. **Track B decisions** O1–O4 (§3.2).
4. **Untracked files not created by this lead:** `doc/payroll/` (payroll architecture from another
   session; memory says "awaiting owner lock"), plus root `AGENTS.md`, `doc/i-want-to-maintain-…md` and
   `prompts/non_payroll_…md`, which are due in the restructure. Ask before committing `doc/payroll/`.
5. **Backups:** decide whether to replace the single pre-v0.9.0 backup with a fresh one (e.g. before
   the first UI/UX release that carries a migration).
