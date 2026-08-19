# RLS Security Audit Report

**Audit Date:** 2026-06-15
**Audit Scope:** 8 tables (attendance, attendance_breaks, attendance_selfies, attendance_corrections, overtime_records, leaves, payslips, salary_structures)
**Assessment by policy-as-coded in repository SQL files**

---

## 1. Policy Inventory

### 1.1 Table: `attendance` — ⚠️ RLS status **UNVERIFIED** (no `ENABLE ROW LEVEL SECURITY` found in repo)

| # | Policy Name | Type | Command | Role | USING | WITH CHECK |
|---|---|---|---|---|---|---|
| 1 | `tenant_active_restrictive` | RESTRICTIVE | FOR ALL | public | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |

**No permissive policy exists in any SQL file in this repository.**

### 1.2 Table: `leaves` — ⚠️ RLS status **UNVERIFIED** (no `ENABLE ROW LEVEL SECURITY` found in repo)

| # | Policy Name | Type | Command | Role | USING | WITH CHECK |
|---|---|---|---|---|---|---|
| 1 | `tenant_active_restrictive` | RESTRICTIVE | FOR ALL | public | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |

**No permissive policy exists in any SQL file in this repository.**

### 1.3 Table: `attendance_breaks` — ✅ RLS Enabled

| # | Policy Name | Type | Command | Role | USING | WITH CHECK |
|---|---|---|---|---|---|---|
| 1 | `tenant_isolation` | PERMISSIVE | FOR ALL | authenticated | `tenant_id = get_auth_tenant_id()` | `tenant_id = get_auth_tenant_id()` |
| 2 | `breaks_self_read` | PERMISSIVE | FOR SELECT | authenticated | `EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.user_id = auth.uid())` | — |
| 3 | `breaks_hr_all` | PERMISSIVE | FOR ALL | authenticated | `is_hr()` | `is_hr()` |

### 1.4 Table: `attendance_selfies` — ✅ RLS Enabled

| # | Policy Name | Type | Command | Role | USING | WITH CHECK |
|---|---|---|---|---|---|---|
| 1 | `selfies_tenant_isolation` | PERMISSIVE | FOR ALL | authenticated | `tenant_id = get_auth_tenant_id()` | `tenant_id = get_auth_tenant_id()` |
| 2 | `selfies_tenant_active_restrictive` | RESTRICTIVE | FOR ALL | public | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| 3 | `selfies_hr_all` | PERMISSIVE | FOR ALL | authenticated | `is_hr()` | `is_hr()` |
| 4 | `selfies_self_read` | PERMISSIVE | FOR SELECT | authenticated | `employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())` | — |

### 1.5 Table: `attendance_corrections` — ❌ No `ENABLE ROW LEVEL SECURITY`, No Policies

**Zero RLS policies. Zero ALTER TABLE ENABLE RLS.**

### 1.6 Table: `overtime_records` — ❌ No `ENABLE ROW LEVEL SECURITY`, No Policies

**Zero RLS policies. Zero ALTER TABLE ENABLE RLS.**

### 1.7 Table: `payslips` — ✅ RLS Enabled

| # | Policy Name | Type | Command | Role | USING | WITH CHECK |
|---|---|---|---|---|---|---|
| 1 | `tenant_isolation` | PERMISSIVE | FOR ALL | authenticated | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| 2 | `tenant_active_restrictive` | RESTRICTIVE | FOR ALL | public | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| 3 | `project_admin_policy` | PERMISSIVE | FOR ALL | project_admin | true | true |

### 1.8 Table: `salary_structures` — ✅ RLS Enabled

| # | Policy Name | Type | Command | Role | USING | WITH CHECK |
|---|---|---|---|---|---|---|
| 1 | `tenant_isolation` | PERMISSIVE | FOR ALL | authenticated | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| 2 | `tenant_active_restrictive` | RESTRICTIVE | FOR ALL | public | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| 3 | `project_admin_policy` | PERMISSIVE | FOR ALL | project_admin | true | true |

---

## 2. Policy Composition Analysis (PostgreSQL Evaluation)

PostgreSQL RLS logic:
- **PERMISSIVE policies** are OR'd — if ANY passes, the row is accessible.
- **RESTRICTIVE policies** are AND'd — ALL must pass.
- If zero PERMISSIVE policies exist for a command → **default-deny** (no rows accessible).

### 2.1 How each table evaluates:

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `attendance` | ❌ BLOCKED (no permissive policy) | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED |
| `leaves` | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED |
| `attendance_breaks` | tenant_isolation **OR** self_read **OR** hr | tenant_isolation **OR** hr | tenant_isolation **OR** hr | tenant_isolation **OR** hr |
| `attendance_selfies` | selfies_tenant_isolation **OR** self_read **OR** hr, **AND** restrictive | selfies_tenant_isolation **OR** hr, **AND** restrictive | selfies_tenant_isolation **OR** hr, **AND** restrictive | selfies_tenant_isolation **OR** hr, **AND** restrictive |
| `attendance_corrections` | ⚠️ If RLS off: wide open. If RLS on: blocked. | ⚠️ (see scratch: REVOKE optional) | ⚠️ (see scratch: REVOKE optional) | ⚠️ (see scratch: REVOKE optional) |
| `overtime_records` | ⚠️ Same as corrections | ⚠️ Same | ⚠️ Same | ⚠️ Same |
| `payslips` | tenant_isolation **AND** restrictive, **OR** project_admin | tenant_isolation **AND** restrictive, **OR** project_admin | tenant_isolation **AND** restrictive, **OR** project_admin | tenant_isolation **AND** restrictive, **OR** project_admin |
| `salary_structures` | tenant_isolation **AND** restrictive, **OR** project_admin | tenant_isolation **AND** restrictive, **OR** project_admin | tenant_isolation **AND** restrictive, **OR** project_admin | tenant_isolation **AND** restrictive, **OR** project_admin |

### 2.2 Critical observation on `attendance` and `leaves`

The only policy defined is RESTRICTIVE. A restrictive policy alone **never grants access** — it only filters rows that would otherwise be permitted. With zero permissive policies, **all direct queries fail**.

**Yet the frontend does direct `SELECT`, `INSERT`, `UPDATE` on `attendance`** (see `src/employee/PunchInOut.tsx:253,254,740,763,826` and `src/hr/Attendance.tsx:448,540,676`).

This contradiction means one of two things:
1. **RLS was never enabled** on these tables → the restrictive policy is a no-op → **data is wide open**
2. RLS was enabled elsewhere (outside this repo) → all direct queries fail → **app is broken**

**Scenario 1 is far more likely given the app is in production.**

---

## 3. Vulnerability Analysis

### FINDING F1: Missing RLS on `attendance` (CRITICAL)
- No `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for `attendance` in any repo SQL file
- Frontend does direct INSERT for punch-in (`PunchInOut.tsx:740`)
- Frontend does direct SELECT for reading attendance records
- Frontend does direct UPDATE for late marks and verification columns
- **If RLS is not enabled:** Any authenticated user can query ALL attendance records across ALL tenants
- **Impact:** Attendance records for every employee in every company are exposed

### FINDING F2: Missing RLS on `leaves` (CRITICAL)
- No `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for `leaves`
- Frontend does direct SELECT (`LeaveManagement.tsx:88,166`, `Calendar.tsx:57`, `Dashboard.tsx:58`, `EmployeeDetail.tsx:370`)
- **If RLS is not enabled:** Any authenticated user can see ALL leave records
- **Impact:** Sick leave patterns, personal dates, reason for leave exposed

### FINDING F3: Missing RLS on `attendance_corrections` (CRITICAL)
- No `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- No policies at all
- `REVOKE INSERT, UPDATE, DELETE` in scratch file (`phase3_restrict_direct_hr_writes.sql`) is OPTIONAL — may not be applied
- Frontend does direct SELECT and INSERT/UPSERT (`PunchInOut.tsx:273,961,989`)
- **Impact:** Any authenticated user can read/modify correction requests

### FINDING F4: Missing RLS on `overtime_records` (CRITICAL)
- No `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- No policies at all
- Same optional REVOKE caveat
- Frontend does direct SELECT (`Attendance.tsx:599`, `RunPayroll.tsx:152,444`)
- **Impact:** Overtime earnings data exposed to all authenticated users

### FINDING F5: Cross-employee salary exposure (HIGH)
- `salary_structures` has RLS enabled but only isolates by `tenant_id`
- `tenant_isolation` uses `can_access_tenant(tenant_id)` — any user in the tenant passes
- **No employee-level restriction exists**
- Frontend reads ALL salary structures for the tenant (`SalaryStructures.tsx:93`, `RunPayroll.tsx:148`)
- SalaryForm.tsx does direct `UPSERT` on `salary_structures` (`SalaryForm.tsx:164`)
- **Impact:** Employee A can read Employee B's salary (CTC, allowances, deductions)

### FINDING F6: Cross-employee payslip exposure (HIGH)
- `payslips` has identical pattern — tenant-level isolation only
- **No employee-level restriction exists**
- Frontend reads ALL payslips for the tenant (`Payslips.tsx:473,604`)
- RunPayroll.tsx does direct `UPSERT` on `payslips` (`RunPayroll.tsx:494`)
- **Impact:** Employee A can read Employee B's payslip (net pay, deductions, earnings)

### FINDING F7: Cross-employee write on `attendance_breaks` (HIGH)
- `tenant_isolation` is FOR ALL — any authenticated user in tenant can UPDATE/DELETE any break record
- Self-read (`breaks_self_read`) is SELECT-only — does not protect writes
- **Impact:** Employee A can close or modify Employee B's active breaks, including tampering with duration/over-limit tracking

### FINDING F8: Cross-employee write on `attendance_selfies` (HIGH)
- `selfies_tenant_isolation` is FOR ALL — any user in tenant can DELETE any selfie
- Self-read (`selfies_self_read`) is SELECT-only
- **Impact:** Employee A can delete Employee B's punch verification selfies, potentially enabling repudiation of attendance

---

## 4. Can a Normal Employee Read/Update/Delete Another Employee's Records?

### 4.1 Direct table access (REST API)

If RLS is **not** enabled on tables F1-F4, a normal employee can:

| Table | Read | Update | Delete |
|---|---|---|---|
| `attendance` | ✅ ANY employee in ANY tenant | ✅ ANY record | ✅ ANY record |
| `leaves` | ✅ ANY employee in ANY tenant | ✅ ANY record | ✅ ANY record |
| `attendance_corrections` | ✅ ANY employee in ANY tenant | ✅ ANY record | ✅ ANY record |
| `overtime_records` | ✅ ANY employee in ANY tenant | ✅ ANY record | ✅ ANY record |

Simply by sending:

```
GET /rest/v1/attendance
POST /rest/v1/attendance?select=*  with body { "employee_id": "victim-uuid", ... }
PATCH /rest/v1/attendance?id=eq.victim-id
DELETE /rest/v1/attendance?id=eq.victim-id
```

If RLS **is** enabled on these tables (but only the restrictive policy exists), direct access returns zero rows — which would break the application.

### 4.2 Tables with RLS tenant-level isolation only

For `salary_structures`, `payslips`, `attendance_breaks`, `attendance_selfies`:

| Table | Read | Update | Delete |
|---|---|---|---|
| `salary_structures` | ✅ Any employee in **same tenant** | ✅ Any (same tenant) | ✅ Any (same tenant) |
| `payslips` | ✅ Any employee in **same tenant** | ✅ Any (same tenant) | ✅ Any (same tenant) |
| `attendance_breaks` | ✅ Self OR tenant-wide | ✅ Any (same tenant) | ✅ Any (same tenant) |
| `attendance_selfies` | ✅ Self OR tenant-wide | ✅ Any (same tenant) | ✅ Any (same tenant) |

---

## 5. Concrete Exploit Examples

### Example 1: View another employee's salary
```http
GET /rest/v1/salary_structures?select=employee_id,ctc_annual,basic_monthly&tenant_id=eq.<tenant_id>
```
Since `tenant_isolation` only checks `can_access_tenant(tenant_id)`, any authenticated user can add any `employee_id` filter and get the result.

### Example 2: Modify another employee's attendance break
```http
PATCH /rest/v1/attendance_breaks?id=eq.<victim-break-id>
Content-Type: application/json

{ "duration_minutes": 999, "over_limit_minutes": 0 }
```
The `tenant_isolation` policy for ALL allows any authenticated user in the same tenant to UPDATE.

### Example 3: Read all attendance records (if RLS not enabled)
```http
GET /rest/v1/attendance?select=employee_id,date,punch_in,punch_out,status
```
No RLS protection → all rows returned.

### Example 4: Insert fake overtime records (if RLS not enabled)
```http
POST /rest/v1/overtime_records
Content-Type: application/json

{
  "tenant_id": "<tenant_id>",
  "employee_id": "<my-id>",
  "date": "2026-06-01",
  "overtime_hours": 40,
  "approved": true
}
```
No RLS → records inserted directly.

---

## 6. Proof Queries

Run these queries against the database to verify:

```sql
-- 6.1 Check which tables have RLS enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('attendance', 'leaves', 'attendance_breaks', 'attendance_selfies', 
                    'attendance_corrections', 'overtime_records', 'payslips', 'salary_structures');

-- 6.2 Dump all policies for the 8 tables
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('attendance', 'leaves', 'attendance_breaks', 'attendance_selfies', 
                    'attendance_corrections', 'overtime_records', 'payslips', 'salary_structures')
ORDER BY tablename, policyname;

-- 6.3 Test cross-employee access (run AS a normal employee user)
-- This should FAIL if employee-level isolation works
SET LOCAL "request.jwt.claim.sub" TO '<employee-A-user-id>';
SET LOCAL "request.jwt.claim.metadata" TO '{"tenant_id": "<tenant-uuid>", "role": "employee"}';

-- Try reading another employee's salary
SELECT * FROM public.salary_structures 
WHERE tenant_id = '<tenant-uuid>' 
  AND employee_id != (SELECT id FROM public.employees WHERE user_id = auth.uid())
LIMIT 5;

-- Try reading all attendance records
SELECT * FROM public.attendance LIMIT 5;

-- Try reading all leave records
SELECT * FROM public.leaves LIMIT 5;

-- Try updating another employee's break
UPDATE public.attendance_breaks 
SET duration_minutes = 999 
WHERE employee_id != (SELECT id FROM public.employees WHERE user_id = auth.uid())
RETURNING id;
```

---

## 7. Root Cause Analysis

1. **`attendance` and `leaves`** were created in a base schema not present in this repository. The restrictive policy was added but `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` was never executed (or no permissive policy was created alongside it).

2. **`attendance_corrections` and `overtime_records`** were created in migrations but never had RLS enabled at all.

3. **`salary_structures` and `payslips`** have RLS correctly enabled but the permissive policy only checks `tenant_id` — it treats all employees within a tenant as equally authorized. There is no **employee-level** isolation.

4. **`attendance_breaks` and `attendance_selfies`** have separate self-read (SELECT) policies but the FOR ALL `tenant_isolation` policy provides write access to every authenticated user in the tenant.

---

## 8. Risk Rating Summary

| Finding | Table(s) | Risk | Rationale |
|---|---|---|---|
| F1 | `attendance` | **CRITICAL** | Possibly no RLS. Every attendance record (punch times, location, status) exposed to all authenticated users. |
| F2 | `leaves` | **CRITICAL** | Possibly no RLS. Leave reasons, dates, status visible to all. |
| F3 | `attendance_corrections` | **CRITICAL** | No RLS. Correction details (including requested times, reasons) fully exposed. |
| F4 | `overtime_records` | **CRITICAL** | No RLS. Overtime hours, rates, amounts visible to all. |
| F5 | `salary_structures` | **HIGH** | RLS enabled but tenant-level only. All employees can see each other's salary details. |
| F6 | `payslips` | **HIGH** | RLS enabled but tenant-level only. All employees can see each other's payslips. |
| F7 | `attendance_breaks` | **HIGH** | Cross-employee write via `tenant_isolation`. Employees can modify others' break records. |
| F8 | `attendance_selfies` | **HIGH** | Cross-employee write via `selfies_tenant_isolation`. Employees can delete others' verification selfies. |

**Overall Risk Level: CRITICAL** — At least 4 tables may have no RLS protection, and the remaining tables lack employee-level access control.

---

## 9. Recommended Fix Strategy

The following describes what changes would be needed. **No code has been modified.**

### 9.1 Enable RLS on unprotected tables
```
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_records ENABLE ROW LEVEL SECURITY;
```

### 9.2 Add permissive policies to tables with only restrictive policies
For `attendance` and `leaves`, add a `tenant_isolation` permissive policy:
```sql
CREATE POLICY tenant_isolation ON public.attendance
  FOR ALL TO authenticated
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());
```

### 9.3 Add employee-level isolation to sensitive tables
For `salary_structures`, `payslips`, `attendance_breaks`, `attendance_selfies`, replace or supplement tenant-scoped policies with employee-scoped self-access policies:

- Add `self_read` (SELECT) policies for employees
- Add `self_all` (INSERT/UPDATE) policies for employees on tables where they need write access
- Keep `hr_all` policies for HR role
- Keep `tenant_isolation` policies for HR/admin reads only (not employee writes)

### 9.4 Add employee-level write restriction to `attendance_breaks` and `attendance_selfies`
The current `tenant_isolation` FOR ALL policy allows any employee to UPDATE/DELETE any record. This should be restricted to:
- HR (via `is_hr()`)
- The owning employee (via `employee_id = (SELECT id FROM employees WHERE user_id = auth.uid())`)

### 9.5 Migrate remaining direct writes to SECURITY DEFINER RPCs
The punch-in INSERT (`PunchInOut.tsx:740`) is a direct table write. Consider migrating to an RPC similar to `punch_out_attendance`. The scratch file (`phase3_restrict_direct_hr_writes.sql`) documents this as intentional but deferred.

### 9.6 Apply the optional REVOKE statements
Apply `scratch/phase3_restrict_direct_hr_writes.sql` after migrating remaining write paths to RPCs.

### 9.7 Expose only necessary columns in RLS policies
Consider column-level security for `salary_structures` — basic salary data vs. PF/ESI/TDS fields may have different access requirements.

---

## 10. Appendix: Function Definitions Used in Policies

### `can_access_tenant(tenant_uuid uuid)`
```sql
SELECT is_superadmin() OR (
  tenant_uuid = get_auth_tenant_id() AND tenant_is_active(tenant_uuid)
);
```
Allows superadmin (unrestricted) OR any authenticated user whose JWT tenant_id matches AND the tenant is active.

### `get_auth_tenant_id()`
```sql
SELECT (metadata->>'tenant_id')::uuid FROM auth.users WHERE id = auth.uid();
```
Reads tenant_id from JWT metadata.

### `is_hr()`
```sql
SELECT EXISTS (
  SELECT 1 FROM auth.users u
  WHERE u.id = auth.uid()
    AND u.metadata->>'role' = 'hr'
    AND NULLIF(u.metadata->>'tenant_id', '')::uuid = get_auth_tenant_id()
);
```
Checks the JWT metadata for `role = 'hr'` matching the current tenant.

### `is_superadmin()`
```sql
SELECT EXISTS (
  SELECT 1 FROM platform_admins pa
  WHERE pa.user_id = auth.uid() AND pa.is_active = true
    AND pa.role IN ('owner', 'support_admin', 'billing_admin')
);
```

---

## Disclaimer

This audit is based solely on SQL policy definitions and application code present in this repository as of 2026-06-15. Some tables may have been created with RLS enabled and policies applied outside the tracked migration files. The actual database state should be confirmed by running the proof queries in Section 6 against the live database.
