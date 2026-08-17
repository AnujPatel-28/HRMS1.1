# Session Context — 2026-08-13

Working session record: what was found, what changed, what's still open.
Branch: `updateSuggestion`. Backend: InsForge parent `HRMS` / `rq3qmu8y`.

---

## 1. Where we started

The ask: check whether the InsForge **parent** backend (`rq3qmu8y`) is compatible with the
`updateSuggestion` frontend branch, given that the dev backend branch (`rq3qmu8y-jx7`) had stopped
working. If not, make the parent compatible.

Confirmed at the start of the session:

- Parent `rq3qmu8y` — **alive** (HTTP 200)
- Branch `rq3qmu8y-jx7` — **dead** (502, unrecoverable; a previous restore attempt had already failed)
- The app's `.env` pointed at the dead branch

Agreed direction: retire the branch, consolidate on the parent, keep all changes **additive-only**.

---

## 2. The compatibility gap that was found

| Gap | Detail |
|---|---|
| 12 missing RPCs | `create_employee_transaction`, `get_hr_policy_library`, `get_employee_visible_hr_policies`, `acknowledge_policy_transaction`, `create_policy_notifications_transaction`, `save_leave_type_transaction`, `deactivate_leave_type_transaction`, `initialize_leave_balances_transaction`, `complete_exit_transaction`, `update_exit_clearance_transaction`, `update_exit_interview_transaction`, `update_employee_reporting_relationship` |
| 3 missing relations | `posts`, `post_reactions`, `employee_directory_public` (a VIEW) |
| Missing RLS policies | 7 tables would have had RLS enabled with **zero** policies — which reads as "everything is broken" rather than "access denied" |

**How it was recoverable:** the branch's schema could not be read from the dead branch, but every
branch-only object had SQL source in the repo's `migrations/*.sql` — which were sitting **untracked**
on disk. Those were replayed onto the parent.

`posts` / `post_reactions` existed only in the saved merge diff
(`system-audit-2026-08/fixes/branch-vs-parent-merge-diff.sql`) and were rebuilt from it.

> ⚠️ **Do not execute that merge-diff dump.** It contains another product's schema
> (`newsletter_subscribers`, `newsletter_rate_limits`, a `newsletter_status` enum). Use it only as a
> source of object definitions.

---

## 3. Security findings

### 3.1 Still open 🔴 — needs your action

**The production admin key is publicly downloadable.**

`https://hrms.talentmeshsolutions.com/test-admin.html` returns HTTP 200 and serves:

- admin key `ik_aaf7c33902b801271b5ec27017882e87`
- credentials `admin@talentmeshsolutions.com` / `Password123!`

It's a leftover debug page in `public/`, which Vite copies to the site root on every build. The admin
key **bypasses RLS entirely** and was verified still valid late in the session.

Deleted from `public/` on `updateSuggestion`, but production builds from `main`, so it is still live.

**To close it:**
1. `npx @insforge/cli secrets rotate api-key`
2. Change the `admin@talentmeshsolutions.com` password
3. Delete `public/test-admin.html` on `main`, redeploy Vercel
4. Delete the accidental `rq3qmu8y.insforge.site` deployment — it leaks the dead branch's key
   (`ik_48f0f767...`) the same way

### 3.2 Fixed this session

| Finding | Fix |
|---|---|
| `exec_sql`, `query_json`, `update_user_password` had `EXECUTE` granted to `anon` | Revoked from PUBLIC/anon/authenticated; `search_path` pinned. Verified `permission denied` using the real production anon key |
| `verify-employee-code` was an unauthenticated admin-key SQL proxy | Replaced with the repo's hardened version. (It was inert — its `/rawsql` target 404s on the current InsForge version — but it forwarded arbitrary input with the admin key) |
| 6 tables with RLS switched off | RLS enabled + tenant policies: `org_units`, `job_titles`, `locations`, `employment_types`, `exit_clearances`, `exit_clearance_templates` |
| `tenant_settings` RLS off | Read within own tenant, write HR-only. This table holds payroll ceilings and the punch-out gate, so it was both a cross-tenant leak and a privilege-escalation path |
| `attendance_audit_logs` RLS off | Now append-only: HR reads, **nobody** writes directly (its only writer is a SECURITY DEFINER function) |
| No manager scope anywhere | `MyTeam` rendered blank for non-HR managers — see §5 |

### 3.3 The `.env` trap — worth remembering

`.insforge/project.json`'s `api_key` field is the **admin** key, not the anon key. Both start with
`ik_`. It had been set as `VITE_INSFORGE_ANON_KEY`, so **local dev was bypassing RLS entirely** —
which is why permission bugs stayed invisible for months.

`.env` now uses the real anon key (`anon_67695cb0...`, from `secrets get ANON_KEY`). Expect genuine
RLS errors to surface locally that were previously masked. That is correct behaviour, not a regression.

**The live production bundle was checked and never exposed an admin key** — it uses a proper
`role: anon` JWT. Only the stale local `dist/` and `test-admin.html` did.

---

## 4. Payroll work

### Fixed

**Professional Tax was flat per state** → now slab-based (`PROFESSIONAL_TAX_RULES` in
`src/payroll/hr/payroll-calc.ts`, exposed as `resolveProfessionalTax()`):

- Karnataka now exempts ≤₹25,000 — it had been charging ₹200 to everyone, over-deducting from every
  low earner
- Maharashtra gets banded rates plus the ₹300 February top-up
- Tamil Nadu is half-yearly, collected only in September and March — it had been charging ₹209
  *every month*, roughly 5× the correct annual amount

PT is assessed on **full monthly gross**, not prorated, so unpaid leave can't drop someone into a
lower slab.

**ESI contribution-period lock-in** — an employee covered at any point in an Apr–Sep / Oct–Mar period
now stays covered to period end. Previously they dropped out the month their wages crossed ₹21,000,
which under-deducts and breaks filing.

Both verified by `scratch/payroll_pt_esi_verify.ts` (24 checks, all passing). Payslip policy snapshot
bumped to **v3**; existing v2 payslips reprint unchanged.

> ⚠️ The seeded PT rates need **finance/CA sign-off** before a live run. Sources conflict on
> Karnataka's middle band — the ₹150 band for 15,001–25,000 appears to pre-date the 2025 amendment.

### Still open

- **PF employer contribution isn't split** into EPS 8.33% (₹15k cap) / EPF 3.67%; no EDLI, no admin
  charges. **Customers cannot file an ECR return from the system today.**
- **TDS is a manual number.** `it_declarations` collects declarations but nothing consumes them.
  Biggest functional gap in payroll.
- No LWF, no gratuity accrual, no mid-month structure change / arrears, no full-and-final settlement.
- **Design issue:** `professional_tax_state` is one setting per *company*, but PT is levied per
  *state*. A company with offices in two states deducts everyone at one rate. Employee `state` and
  `work_location` already exist — they're just not used for PT.

**Payroll is parked** pending CA answers (`doc/decisions_and_judgment_calls.md`, Part A).

---

## 5. Manager roles

**The bug:** there was no manager scope in the database at all. `attendance` and `leaves` were
self + HR only, so `MyTeam.tsx` — which fetches each team member's attendance and leaves — returned
zero rows for any manager who wasn't HR. The manager rule lived in the frontend as
`.eq("manager_id", ...)`, which is a *query filter, not a permission*.

**Phase 1 (done):** `is_manager_of(uuid)` — SECURITY DEFINER, honours `employees.manager_id`,
`secondary_manager_id`, and effective-dated `employee_reporting_relationships` — plus manager SELECT
policies on both tables. Verified: QA Manager → 4 employees, QA Normal Employee → 0.

**Phase 2 (done):** `employee_roles` stores grants as **data** — `role` (hr_admin / payroll_admin /
manager / employee) × `scope_type` (self / direct_reports / org_unit / department / tenant). Plus
`has_role()`, an extended `is_hr()`, and `can_view_employee()` which unifies every source of
authority.

This means the answers to "what can a manager do?" become rows, not a refactor.

Verified: the original `is_hr()` metadata branch is byte-intact (63 policies depend on it) and
`hr-qa` still satisfies it; a real scoped grant was inserted, confirmed to resolve, and removed.
**An empty `employee_roles` table behaves exactly as before the migration** — nothing widened on its own.

**Phase 3 (not started):** per-workflow approvers + delegation. Deliberately paused — it's
behavioural logic that can't be verified without logging in, and delegation is close to pointless
until email works (B4).

---

## 6. What changed

### Migrations applied to parent (all additive)

| Version | Name | Author |
|---|---|---|
| `20260813070000` | close-anon-sql-and-rls-gaps | this session |
| `20260813080000`–`20260813081800` | 19 replayed branch migrations | replayed from repo |
| `20260813081801` | add-connect-feed-tables | this session |
| `20260813103843` | superadmin-console-hardening | **yours — not from this session** |
| `20260813123936` | tenant-settings-rls | this session |
| `20260813172217` | attendance-audit-logs-rls | this session |
| `20260813183901` | manager-team-read-scope | this session |
| `20260813190500` | explicit-roles-and-scopes | this session |

### Code

- `src/payroll/hr/payroll-calc.ts` — PT slab engine, ESI lock-in, snapshot v3
- `src/payroll/hr/RunPayroll.tsx` — ESI coverage lookup, snapshot v3
- `src/payroll/hr/Payslips.tsx` — `SUPPORTED_SNAPSHOT_VERSION = 3`
- `scratch/payroll_pt_esi_verify.ts` — new, 24 checks
- `.env` — repointed to parent with the real anon key
- `.insforge/project.json` — swapped to parent (old branch config kept as `project.branch-dead.json`)
- `public/test-admin.html` — **deleted**
- `functions/verify-employee-code.ts` — hardened version deployed to parent

### Docs

- `new update doc/salary_component_model_design.md` — component model, migration path, compliance gaps
- `doc/decisions_and_judgment_calls.md` — **Part A is forwardable to a CA as-is**
- `doc/module_architecture.md` — module boundaries, per-module gaps vs Frappe, navigation
- `doc/session_context_2026-08-13.md` — this file

---

## 7. InsForge gotchas learned

- **Migrations are strictly forward-only.** All 19 branch migrations predated the remote head and
  were rejected; they had to be renumbered to `2026081308NN00_*` preserving order.
- **Filenames must be `<version>_<migration-name>.sql` with hyphens** — underscores in the name part
  are rejected, and *every* file in `migrations/` is validated on *any* command.
- `db query` runs **one statement per call**; `BEGIN`/`COMMIT` inside a migration file is rejected.
- `db query` **blocks `set_config`**, so you cannot impersonate a user to test RLS from the CLI.
- **Policies on an RLS-off table are inert until RLS is enabled.** `tenant_settings` had a restrictive
  policy sitting dormant that activated the moment RLS was switched on — check for these first.
- The CLI validates against the project in the **current directory's** `.insforge/project.json`.

---

## 8. Open items

### Needs you

| # | Item | Why it matters |
|---|---|---|
| 1 | 🔴 **Rotate the admin key** + fix `main` + redeploy | A working admin key is publicly downloadable. Undermines every other fix |
| 2 | Send Part A to a CA | Blocks the first real payroll run |
| 3 | QA click-through as `hr-qa` / `manager-qa` / `employee-qa` (all `Password@123`) | RLS is genuinely enforced for the first time. `MyTeam` was broken and there are likely more |
| 4 | Decide B1 (modules: cosmetic or pricing), B2 (what managers may do), B3 (payroll maker-checker) | B2 answers become `employee_roles` rows |
| 5 | Set up SMTP (B4) | Unblocks self-service passwords, resets, payslip delivery, notifications. Today HR knows every employee's password |

### Queued for me

- **Leave ledger refactor** — `leave_balances` is a mutable running total; concurrent approvals can
  corrupt it and nobody can explain a balance. Highest-value data fix outside payroll, and it gets
  harder as real balances accumulate
- Phase 3 — per-workflow approvers + delegation
- PF employer split; automated TDS (after CA)
- Command palette (Ctrl+K), breadcrumbs, slide-over drawers
- Performance module — largest whole-module gap
- Drop `test_log` / `test_mcp_sync` (the only remaining RLS-off tables, both junk)

### Unverified risk

The 19 replayed migrations include the branch's **RLS hardening**. Production still serves the older
`main` build, which was written against the looser policies — **some production screens may be broken
right now**. Low real-world impact (all 12 tenants are test orgs) but it has not been checked.

---

## 9. Corrections made during the session

Recorded so they don't get re-derived from stale notes:

- **The anon-key probe.** I initially reported proving the SQL RPCs were callable with the public anon
  key. The probe had used the **admin** key. The finding was real — the Postgres grant to `anon`
  existed and is now revoked and verified — but the original demonstration didn't show what I said it did.
- **Professional Tax was not missing.** It was implemented, in the policy snapshot rather than as a
  column. The real defect was that it was flat per state rather than slab-based.
- **`create_employee_transaction` args matched all along.** An apparent 14-vs-33 parameter mismatch
  was my grep window truncating the call site.
- **Earlier notes claimed parent held ~12 real tenants.** They're all test orgs — QA Testing Org,
  testtest, DEMO COMPANY. Memory has been corrected.
