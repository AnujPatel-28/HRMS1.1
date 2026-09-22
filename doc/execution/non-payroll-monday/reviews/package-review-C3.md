# Package review — C3 manager authority converges on the primary reporting relationship

Lead: Opus 5.5, 2026-09-23. Implemented **in-session** (user budget preference; no subagent).
**Verdict: ACCEPTED** (suite results in §5).

## 1. What changed

Migration `20260912194000_m1m2-manager-id-convergence.sql`:

| § | Change | Why |
|---|---|---|
| 1 | Asserts 0 employees with `manager_id` and no active primary row (RAISE otherwise); re-syncs display `manager_id` to the active primary row | Removal trigger from `package-review-P1-03` §3. Measured: 0 orphans, **1 drifted** display value (QA Normal Employee showed their pre-2026-09-02 manager) |
| 2 | `is_manager_of` — legacy `target.manager_id = me.id` fallback removed (exact signature, same attributes) | Primary relationship row is now the sole authority |
| 3 | DROP `managers_can_view_own_draft_reports`, `managers_can_delete_own_draft_reports` on `employees` | Managers read reports' **full rows (bank, PAN, Aadhaar)**; any employee could delete draft-shaped rows incl. exited reports |
| 4 | **Scope addition:** DROP PERMISSIVE `tenant_isolation_policy` on `employee_reporting_relationships`; add RESTRICTIVE `tenant_active_restrictive`; REVOKE ALL from anon | **Live proof before the fix:** `employee.a` inserted a primary row naming themself manager of `hr-employee.a`; `is_manager_of` flipped false → true. Removing the fallback meant nothing while the authoritative row was employee-writable |
| 5 | `new_hire_requests` status gains `cancelled`; new DEFINER `c1_cancel_new_hire_request(uuid)` — requester only, pending only | Replaces MyTeam's cancel, which deleted an `employees` row |
| 6 | New DEFINER `my_direct_report_ids()` → `SETOF uuid`, built on `is_manager_of` | The team list comes from the same predicate the server enforces (P3-02b principle) |

Frontend:
- `src/hr/EmployeeCreate.tsx` — the edit/recovery path no longer writes `manager_id`/`secondary_manager_id`
  directly; calls `update_employee_reporting_relationship` (which syncs the display columns).
- `src/employee/MyTeam.tsx` — team from `my_direct_report_ids()` + `employee_directory_public`;
  draft-profile card + employee-delete cancel removed; **Cancel Request** on pending new-hire requests.
- `src/hooks/useManagerView.tsx` — `directReportIds` from `my_direct_report_ids()` (it read `employees`
  through the dropped policy; MyLeaves/MyTasks manager mode would have gone empty).
- `src/employee/MyTasks.tsx` — team names from the directory view (it fetched reports' rows with `select *`,
  i.e. bank/identity, through the dropped policy).
- `src/types/index.ts` — `NewHireRequest.status` gains `"cancelled"`.

Files beyond the brief's allow-list (`useManagerView.tsx`, `MyTasks.tsx`, `types`) were required:
both hooks read `employees` through the dropped SELECT policy and would have silently returned nothing.

## 2. Consumers of the dropped SELECT policy (checked before dropping)

`grep` for `from("employees")` / `employees(` embeds outside `src/hr`: the only manager-context readers
were `useManagerView` and `MyTasks` (both moved). `MyLeaves` already used the directory view.
`Connect.tsx` embeds `author:employees(...)` — already resolves only for self/HR (no colleague read
policy existed apart from the dropped one); unchanged, noted for the UI audit. `employee_directory_public`
has no `security_invoker` (runs as owner), so the view path survives the drop.

## 3. Checked and ruled out

- C1's onboarding window reads `employee_onboarding_self`, **not** `employee_onboarding` — the
  permissive `employee_onboarding` policy is not a C1 regression (moved to C7).
- `update_employee_reporting_relationship` syncs `manager_id`/`secondary_manager_id` — confirmed live (§5).

## 4. Found, not fixed here → **C7** (briefed)

PERMISSIVE tenant-only write policies on ~9 more tables (`office_locations`, `attendance_location_exceptions`,
`employee_shifts`, `shifts`, `employee_policy_acknowledgements`, `employee_onboarding`, `payroll_runs`,
`it_declarations`, `it_declaration_windows`). Only `employee_onboarding` was proven writable (Company A
has no rows in the rest). Brief: `prompts/c2_c6_cleanup_packages_2026-09-22.md` §C7. Do before C4.

## 5. Verification

`tests/m1m2/c3_manager_convergence.mjs` — 24 PASS lines, RLS 1/2/0 before and after, fixture torn down:
HR reassigns via the RPC → primary row moves, `is_manager_of` new=true / old=false, display column synced;
legacy orphan → no scope; manager reads report via `employees` → 0 rows, via the directory view → basic
columns, no `account_number`/`pan_number`; manager/employee delete of employees rows → 0 rows; employee
insert of a primary relationship → `42501`; org-chart read still works; cancel: other manager DENIED,
requester ALLOWED → `cancelled`, re-cancel DENIED, HR approve of cancelled DENIED.

Build clean. Policy drift 44 of 326 (baseline 44). Full suite run: see §6.

## 6. Every suite

All 16 `tests/m1m2` suites, run sequentially, exit code captured per suite:

```
c1_employee_self_edit rc=0
c2_business_date rc=0
c3_manager_convergence rc=0
p1_capability_contract rc=0
p1_membership_invitation_revocation rc=0
p1_organization_transfer rc=0
p1_owner_lifecycle rc=0
p2_attendance_corrections rc=0
p2_leave_workflow rc=0
p2_work_calendar_resolver rc=0
p3_chat_connect rc=0
p3_policy_center rc=0
p3_private_buckets rc=0
p3_projects_tasks rc=0
p3_realtime_isolation rc=1
p3_scope_advertising rc=0
```

`p3_realtime_isolation` rc=1 is solely item 6 (`FAIL 6 PLATFORM_LIMIT existing revoked socket`, the accepted InsForge limit) — its only FAIL line. Every log was also grepped for `AssertionError`/stack traces: none elsewhere.

**Caught during acceptance:** the first full run reported every suite as exit 0 because the loop read `$?` after a `$(basename)` substitution. `p1_organization_transfer` was actually failing — its `is_manager_of` consumer guard (new consumer `my_direct_report_ids`) and two assertions that the legacy fallback *grants*. Updated (brief allowed this file): consumer set + `my_direct_report_ids`; mentor+legacy and not-yet-migrated cases now expect **no** scope; the AC5 client-shape check now calls `my_direct_report_ids()` instead of the old `employees.manager_id` query.

## 7. Production promotion

**Migration `194000` BEFORE the frontend** (reverse of P3-02b): the new frontend calls
`my_direct_report_ids` / `c1_cancel_new_hire_request`, which must exist. With the old frontend on the
new schema: MyTeam lists via the view (still works), `useManagerView`/`MyTasks` team lists go empty
until the frontend deploys, and the old draft-cancel deletes 0 rows with a false success toast. Deploy
both in the same window.
