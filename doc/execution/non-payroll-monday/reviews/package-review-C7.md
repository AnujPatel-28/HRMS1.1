# Package review — C7 PERMISSIVE tenant-only write policies

Lead: Opus 5.5, 2026-09-23, in-session. **Verdict: ACCEPTED.** Found during C3; brief in
`prompts/c2_c6_cleanup_packages_2026-09-22.md` §C7. Migration renumbered `198000` → **`194500`**
so C4–C6 (`195000`–`197000`, not yet written) are not older than an applied migration.

## 1. Before (live, TB-M1M2, plain employee `employee.a`) — `scratch/c7-before.log`, 16/32

| Table | Employee could | Impact |
|---|---|---|
| `office_locations` | create / edit / delete | move or delete the office geofence |
| `attendance_location_exceptions` | create an **approved** exception for self; edit/delete colleagues'; read colleagues' | geofence self-bypass |
| `shifts` | create / edit / delete (delete cascaded `employee_shifts`) | wipe shift assignments |
| `employee_shifts` | create for others | reassign anyone's shift |
| `payroll_runs` | create / set `status='paid'` / delete | payroll integrity (payroll-enabled tenants: 14/15 in prod) |
| `it_declaration_windows` | create / edit / delete | open/close tax windows |
| `it_declarations` | create for HR/colleagues | forge declarations |
| `employee_onboarding` | create / edit / delete | corrupt onboarding state |
| `employee_policy_acknowledgements` | insert for a colleague (stopped only by an FK) | forge acknowledgements |

Re-sweep (every PERMISSIVE write policy without a role check, `scratch/c7-sweep.mjs`): the same 9
tables; nothing else of this shape.

## 2. Fix — `20260912194500_m1m2-permissive-tenant-write-policies.sql`

Tenant-only PERMISSIVE policy dropped on all 9. Added where missing: RESTRICTIVE
`tenant_active_restrictive`, `<table>_hr_all` (`can_access_tenant AND is_hr`), and read policies for
paths the app uses: `shifts`/`office_locations`/`payroll_runs`/`it_declaration_windows` tenant SELECT;
`employee_shifts` self SELECT. Existing self policies (exceptions read, declarations, acknowledgements)
kept. A DO-block guard RAISEs if any tenant-only PERMISSIVE write policy remains on these tables.

Client paths checked (grep `src/`, `functions/`): employee reads — `useEmployeeShift`, `PunchInOut`,
`MyPayslips`, `TaxDeclaration`; HR writes — ShiftManagement/OfficeLocations/EmployeeDetail/RunPayroll/
TaxDeclarationHR; `create-employee-user` writes `employee_onboarding` with the **HR caller's token**
(covered by `employee_onboarding_hr_all`); other functions use the admin key. No frontend change.

**Who can still write (checked after acceptance):** writes now require `is_hr()` (JWT role `hr` or an
active `hr_admin` employee role), the same predicate as 72 other policies. The HR portal opens on
capability grants (`employee.write`/`org.manage`/`access.manage` company), so a future Company Admin or
Owner *without* HR would see these pages but fail to save — the deferred "one resolver" seam
(`doc/product_direction_review_2026-09-09.md`), not a C7 regression. Measured: every admin-template
holder in TB today is `hr_admin` with `is_hr()` true, so nobody loses access.
**Dependents:** no invoker function references the 9 tables (`position()` sweep); their only triggers
set `updated_at`. Forward-fix slot for C7: `20260912194600`.

## 3. After — `tests/m1m2/c7_tenant_write_policies.mjs`: **32/32 PASS**

Every employee insert → `42501`; every update/delete of a non-owned row → 0 rows, row intact; employee
reads of shifts / office / own shift / payroll-run status / tax window / own exception = 1, colleague's
exception = 0, cross-tenant = 0; employee inserts own declaration = ALLOWED; HR insert/update/delete on
7 tables = ALLOWED. Company A has payroll OFF, so the fixture enables it for the run and restores it
(verified `enabled=false` after). RLS 1/2/0 before and after.

## 4. Every suite (exit code captured per suite)

```
c1_employee_self_edit rc=0
c2_business_date rc=0
c3_manager_convergence rc=0
c7_tenant_write_policies rc=0
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
`p3_realtime_isolation` rc=1 = item 6 only (accepted InsForge platform limit). No other log has a FAIL
or stack trace. Policy drift **42** of 333 (was 44: two untracked policies were among those dropped).

## 5. Left for later (recorded, not fixed)

- **Payroll research:** `declarations_self_all` lets an employee write any column of their own
  declaration (incl. status); `payroll_runs_tenant_select` shows every run row to employees (MyPayslips
  needs only status). Decide in the payroll decision lock.
- `acknowledgements_employee_self` is ALL — an employee can delete their own acknowledgement.
- Storage: profile-photo policies key on tenant only — any employee can overwrite/delete a colleague's
  photo (low).
- **`expenses` — MEASURED 2026-09-23:** `employee.a` inserted an expense with `status='approved'`
  (row created, then deleted). `expenses_self_insert` checks ownership only. Money path → **first item
  of C6**.

## 6. Production

Migration only, no frontend dependency; order-independent of C3's frontend. Apply after `194000`.
