# Cleanup packages C2–C6

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch `p1-00-harness-reconciliation`.
Each section is a **separate package**: its own migration, its own commit, its own report.
**Dispatch one at a time** — TB-M1M2 writes are serialized. Order: C2 → C3 → C4 → C5 → C6
(C5 depends on C4). C1 (`c1_employee_self_edit_and_new_hire_requests_2026-09-22.md`) runs first.

**Common rules for every package** (read `doc/session_context_2026-09-21-p3-complete.md` §2–§4 and
`doc/session_context_2026-09-15-senior-dev-m1m2.md` §6 first):
- TB-M1M2 only (`fb9a8659-…`); **never** `0431f0f6-…`; `npm run test:m1m2:target` before writes; CLI
  `node node_modules/@insforge/cli/dist/index.js`; `db query` chokes on aggregates.
- Changing an existing function: derive from `pg_get_functiondef()` on live TB, minimum change, **exact
  signature**, one `pg_proc` row per name asserted in a DO block. DEFINERs: tenant fence, pinned
  `search_path`, no `anon` EXECUTE. Tenant fences RESTRICTIVE. Never set `notifications.user_id`.
- Applied migrations immutable; each package gets **one** pre-authorized forward fix (`…100`).
- Only the package's allowed files; anything else → stop and report. Stage only your own files.
- Disposable fixtures, `finally` teardown, RLS 1/2/0 before/after. **Re-run every `tests/m1m2/*.mjs`**
  at the end and report each exit code (known: `p3_realtime_isolation` item-6 FAIL; CDN timeouts →
  re-run once; broken persona → `npm run test:m1m2:personas`).
- Report per acceptance item PASS / FAIL / UNTESTED with raw lines. Reasoned-not-run = UNTESTED.

---

## C2 — Business date everywhere (server-UTC `CURRENT_DATE` removal)

**Measured 2026-09-22:** 11 functions mention `CURRENT_DATE`; 2 only in comments
(`punch_in_attendance`, `update_employee_reporting_relationship`). **9 real uses** — in IST, between
00:00 and 05:30 the server's UTC date is still yesterday:

| Function | Use | Effect |
|---|---|---|
| `employee_apply_leave_request` | minimum notice; days since joining | notice one day too generous; eligibility flips a day off (reconciliation.md §14.1) |
| `hr_schedule_shift_change` | default `CURRENT_DATE + 1`; guard `<= CURRENT_DATE` | a "from tomorrow" change can land on the current local day |
| `create_employee_transaction` | `v_today` | dates recorded a day early |
| `open_initial_unit_assignment` (trigger) | `LEAST(date_of_joining, CURRENT_DATE)` | org history a day early |
| `attendance_evaluate_location` | fallback when `p_business_date` null | wrong-day exception lookup |
| `expire_location_exceptions` | `end_date < CURRENT_DATE` | expires a day late (per tenant) |
| `fn_accrue_monthly_leaves` | year / month start / `last_accrual_date` | month-boundary drift per tenant |
| `fn_check_insurance_expiries` | 30-day window | insurance (excluded product) |
| `attendance_reconcile_missing_selfies` | lookback window | harmless |

**Do:** replace with `public.tenant_business_date(<tenant>, now())` wherever a tenant is in scope;
for cross-tenant batch jobs (`expire_location_exceptions`, `fn_accrue_monthly_leaves`) compute it
**per row's tenant**. Leave `fn_check_insurance_expiries` and the selfie lookback unchanged but say
so. Afterwards a `prosrc` sweep for `current_date` must show only those two plus comments.
**Migration:** `20260912193000_m1m2-business-date-convergence.sql`.
**Allowed files:** migration(s); new `tests/m1m2/c2_business_date.mjs`.
**Acceptance:** for each changed function, a test that fixes "now" to an IST early-morning instant
where the two dates differ (e.g. drive via a date parameter where one exists, or compare
`tenant_business_date` vs `CURRENT_DATE` around a chosen timestamp) and shows the tenant date is
used; the sweep output; leave application notice check exercised; all suites green.

---

## C3 — `manager_id` converges on the reporting relationship

**Measured 2026-09-22:** the legacy `manager_id` fallback in `is_manager_of` is still dead
(0 employees with `manager_id` and no primary row) — **but two writers still bypass the model**:
- `src/hr/EmployeeCreate.tsx:~804` — HR editing an existing employee updates `manager_id` /
  `secondary_manager_id` directly, never touching `employee_reporting_relationships`. The displayed
  manager and the actual authority (primary row) can silently diverge.
- `AddTeamMemberModal.tsx` — removed by C1.
`update_employee_reporting_relationship` (P1-03) is the correct path.

**Do:** route the EmployeeCreate edit path through `update_employee_reporting_relationship` (it
takes primary + secondary). Then the removal trigger from `reviews/package-review-P1-03.md` §3 is
met: in the migration, **assert** zero employees with `manager_id` set and no active primary row
(RAISE if not), then remove the `target.manager_id = me.id` fallback branch from `is_manager_of`
(exact signature). Keep `manager_id` as a display column kept in sync by the RPC, or report if the
RPC does not sync it. Update `tests/m1m2/p1_organization_transfer.mjs` only if its assertions name
the fallback.
**Added by the lead after C1 review (2026-09-22) — two legacy `manager_id` policies survive C1:**
- `managers_can_view_own_draft_reports` — `SELECT USING manager_id = get_my_employee_id()`. Not
  limited to drafts: it exposes the **full `employees` row of every report** (bank, PAN, Aadhaar,
  DOB) to their manager via the legacy column, bypassing the "manager = basic read only" rule.
- `managers_can_delete_own_draft_reports` — `DELETE USING status='inactive' AND user_id IS NULL AND
  manager_id = me`. Lets an employee delete employee rows matching that shape — which can include
  **exited former reports**.
Both go. But `src/employee/MyTeam.tsx:~52` lists a manager's team **through** that SELECT policy
(`.eq("manager_id", currentEmployee.id)`), and `handleCancelRequest` (~208) deletes an `employees`
row. So: list reports from the **primary reporting relationship** with **basic columns only** (the
`employee_directory_public` view, or a definer RPC returning the columns `MyTeam` renders — never
bank/identity); and make "cancel" act on the manager's own **pending `new_hire_requests`** row
(add a small definer `c1_cancel_new_hire_request` — requester only, pending only) instead of
deleting an employee. Show pending requests in MyTeam from `new_hire_requests`.
Acceptance additions: a manager sees their primary reports' basic fields and **not** their
`account_number`/`pan_number` (query the table directly as the manager → no row / no sensitive
column); an employee cannot delete any `employees` row; cancel works on a pending request only.

**Migration:** `20260912194000_m1m2-manager-id-convergence.sql`.
**Allowed files:** migration(s); `src/hr/EmployeeCreate.tsx`; `src/employee/MyTeam.tsx`;
`tests/m1m2/p1_organization_transfer.mjs` (only if needed); new `tests/m1m2/c3_manager_convergence.mjs`.
**Acceptance:** HR edits an employee's manager in the UI path → primary relationship row changes;
`is_manager_of` true for the new manager, false for the old; an employee with `manager_id` pointing
at someone but no primary row gets **no** manager scope (fallback gone); all suites green.

---

## C4 — Re-derive an already-derived attendance day

**Measured 2026-09-22:** `approve_leave_request`, `cancel_leave_request`, `hr_run_attendance_derivation`,
`punch_in_attendance` and the scheduler already call `attendance_derive_pass1/2(tenant, shift, from,
to, run_id)`. The gap: **pass 1 only takes events with `attendance_id IS NULL`** and pass 2 fills only
days with no row — so a day already derived is never recomputed. Cancelling approved leave restores
the raw data (P2-04 proved punches survive byte-identically) but the day stays `on_leave`
(reconciliation.md §14.2). `is_locked` rows (HR-corrected) must never be overwritten (D5).

**Do:** one definer entrypoint, e.g. `attendance_rederive_day(p_tenant_id, p_employee_id, p_date)`:
skip if the day is `is_locked`; otherwise un-stamp that employee-day's events (`attendance_id → NULL`)
and clear the derived fields of the unlocked row **without** nulling raw evidence (punch timestamps,
selfies, events — P2-04 rule: evidence is never destroyed), create a run row, and re-run the passes
for that one day. Callers: `cancel_leave_request` and backdated `approve_leave_request` for each
affected date (replace whatever partial handling exists there — derive from live bodies); HR access
for a manual "recalculate day" (company-scope `attendance.correct` or the existing HR derivation
authority — check the catalogue). Do not change the pass functions' logic.
Remember hazard: `attendance-derivation-hourly` schedule is repointed to the branch and **inactive**;
do not enable it; this entrypoint must not depend on it.
**Migration:** `20260912195000_m1m2-attendance-rederive-day.sql`.
**Allowed files:** migration(s); new `tests/m1m2/c4_rederive_day.mjs`; one HR attendance screen for
the recalculate action (report which).
**Acceptance:** approve leave → day `on_leave`; cancel → day snaps back to the punch-derived status
with punch timestamps and event rows byte-identical to before (compare, don't eyeball); a locked day
is untouched; a day with no events returns to absent/weekoff per calendar; retry is idempotent; HR
recalculate works, employee cannot call it; all suites green.

---

## C5 — Half-day leave (user decision 2026-09-22: build now)

**Measured:** `leaves.day_fraction` exists and both derivation passes already map `< 1 → half_day`.
Missing: any setting, UI, or write path. `employee_apply_leave_request(p_tenant_id, p_leave_type_id,
p_start_date, p_end_date, p_reason)` has no fraction parameter.

**Do:**
- `leave_types.allow_half_day boolean NOT NULL DEFAULT false` (HR-configurable in the leave-type
  settings screen / Policy Center leave tab).
- Apply: half-day allowed only when the type allows it **and** start = end; the employee picks
  **first half / second half** (store it: e.g. `leaves.half_day_session text CHECK IN
  ('first','second')`); `day_fraction = 0.5`; balance and business-day counts use 0.5.
- Adding a parameter means a **new signature**: `DROP FUNCTION` the old exact signature, `CREATE` the
  new one, update every caller (`src/`), and grep for other SQL callers. Never CREATE OR REPLACE with
  an appended DEFAULT param (makes an overload).
- Approval writes nothing new beyond what exists; derivation already yields `half_day`. Cancel of a
  half-day leave uses C4's re-derive.
- Punch interaction: a first-half leave day should not flag the employee late for a second-half
  arrival — check how `punch_in_attendance` computes lateness and report what happens; fix only if
  it is a one-line, clearly-correct change, otherwise report.
**Migration:** `20260912196000_m1m2-half-day-leave.sql`.
**Allowed files:** migration(s); `src/employee/MyLeaves.tsx` (apply form); the HR leave-type
settings screen (find it; report which); `src/hooks/useLeaves.ts`; `src/utils/leave.ts`;
`src/types/index.ts`; new `tests/m1m2/c5_half_day_leave.mjs`.
**Acceptance:** type without `allow_half_day` rejects half-day; multi-day half-day rejected; valid
half-day deducts 0.5 from balance; approved → attendance `half_day`; cancel → balance restored and day
re-derived; P2-04 `p2_leave_workflow.mjs` still green; all suites green.

---

## C6 — P3 residuals

Recorded in the P3 reviews; each small:
1. **Post edits** (`reviews/package-review-P3-03-tier2.md` §3): an author can change their own
   post's `type` → `announcement` and `is_pinned`. Revoke UPDATE on `posts` from `authenticated`;
   add a definer `p3_edit_post(p_post_id, p_content, p_image_url)` (author only, content columns
   only); pin/announcement changes only with `feed.moderate@company` (separate RPC). Move
   `Connect.tsx` callers.
2. **Owner deletes HR-issued files** (`package-review-P3-04.md` §2): in `employee-documents`, the
   owner may insert into their own folder but may not delete/overwrite; HR may. Change the storage
   delete/update policy only; keep upload behaviour.
3. **Dead Connect realtime subscribes** in `src/employee/EmployeeLayout.tsx` and
   `src/hr/HRLayout.tsx` (`realtime.subscribe("posts")` — refused since P3-03). Remove.
4. Stale log text in `tests/m1m2/p1_membership_invitation_revocation.mjs` ("private storage and
   realtime remain disabled/incomplete") → update to reflect P3-03/P3-04.
**Migration:** `20260912197000_m1m2-p3-residuals.sql`.
**Allowed files:** migration(s); `src/shared/pages/Connect.tsx`; `src/employee/EmployeeLayout.tsx`;
`src/hr/HRLayout.tsx`; `tests/m1m2/p1_membership_invitation_revocation.mjs` (text only);
new `tests/m1m2/c6_p3_residuals.mjs`.
**Acceptance:** author edits content but cannot change type/pin (denied); moderator can; employee
cannot delete an HR-uploaded file in their own folder, HR can, employee can still upload their own;
no `posts` subscribe calls remain in `src/`; all suites green.

---

## C7 — PERMISSIVE tenant-only write policies (added by the lead 2026-09-23, during C3)

**Why:** C3 proved live that `employee_reporting_relationships.tenant_isolation_policy` (PERMISSIVE
`FOR ALL`, tenant membership only) let **any employee insert a primary row making themself manager
of HR** → `is_manager_of` true. Fixed in C3 (`194000`). A sweep on 2026-09-23 found the same shape
(PERMISSIVE write policy whose only condition is tenant membership, no role/owner check) on:

| Table | Policy | Roles | Likely impact if writable |
|---|---|---|---|
| `office_locations` | `office_locations_tenant_isolation` | public | move the office geofence → punch from anywhere |
| `attendance_location_exceptions` | `exceptions_tenant_isolation` | authenticated | grant self a geofence exception |
| `employee_shifts` | `tenant_isolation` | authenticated | reassign own/others' shift |
| `shifts` | `tenant_isolation` | authenticated | edit shift timings / grace |
| `employee_policy_acknowledgements` | `tenant_isolation` | authenticated | forge/erase others' acknowledgements |
| `employee_onboarding` | `HR can manage employee_onboarding in their tenant` (misnamed — no HR check) | authenticated | **measured:** employee.a UPDATE matched 2 rows (server-side onboarding state, `status`/`last_error`) |
| `payroll_runs` | `tenant_isolation` | authenticated | payroll — record, fix with payroll |
| `it_declarations`, `it_declaration_windows` | `*_tenant_isolation` | authenticated | payroll — record, fix with payroll |

`authenticated` holds INSERT/UPDATE/DELETE on all of them. Company A has 0 rows in most, so a no-op
UPDATE proves nothing — **measure with a REST INSERT as `employee.a` + immediate SQL cleanup** (the
pattern in `scratch/c3-err-probe.mjs`). Treat this list as a lower bound: re-sweep with a regex that
does NOT exclude quals mentioning `auth.uid`/`user_id` (the C3 policy had exactly that shape and
the first sweep missed it).

**Do:** per table, read every other policy first (converting or dropping a PERMISSIVE policy can
remove a legitimate path — e.g. employees reading `shifts`/`office_locations`, employees inserting
their own acknowledgement). Then: tenant-only PERMISSIVE → RESTRICTIVE fence (`tenant_active_restrictive`
house form) + explicit HR write policy + narrow self policies where a client path needs one. Grep
`src/` and `functions/` for every direct client write to each table before closing it.
**Migration:** `20260912194500_m1m2-permissive-tenant-write-policies.sql`.
**Acceptance:** per table, employee INSERT/UPDATE/DELETE DENIED (live, before = ALLOWED shown),
HR path still works, every legitimate employee read/write path listed and exercised; all suites.
**Order:** before C4 (security before correctness). Payroll tables may be deferred to the payroll
module but must be listed in its decision doc.

### C6 additions (lead, 2026-09-23, from C3/C7 acceptance) — do these FIRST in C6

1. **`expenses` self-approval (money path, measured):** `employee.a` inserted an expense with
   `status='approved'` via REST (`scratch/c7-expense-probe.mjs`). Tighten `expenses_self_insert`
   WITH CHECK to `status = 'pending'` plus null reviewer/approval columns; check `expenses_self_*`
   UPDATE paths the same way. Grep the client insert first (it must not send another status).
2. `create_draft_employee` (HR-only, no caller) inserts `manager_id` with no relationship row — drop
   it or route it through `update_employee_reporting_relationship`.
3. Profile-photo storage policies key on tenant only — any employee can overwrite/delete a
   colleague's photo; scope to own folder (+ HR).
4. `acknowledgements_employee_self` is FOR ALL — an employee can delete their own acknowledgement.
C7's forward-fix slot is `20260912194600` (C7 was renumbered from `198000`).
