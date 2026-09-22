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
**Migration:** `20260912194000_m1m2-manager-id-convergence.sql`.
**Allowed files:** migration(s); `src/hr/EmployeeCreate.tsx`; `tests/m1m2/p1_organization_transfer.mjs`
(only if needed); new `tests/m1m2/c3_manager_convergence.mjs`.
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
