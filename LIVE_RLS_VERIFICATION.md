# Live Database RLS Verification Report

**Date:** 2026-06-15  
**Database:** Insforge (Supabase-compatible PostgreSQL) – `rq3qmu8y.ap-southeast.insforge.app`  
**Verification Method:** Direct SQL queries via `insforge db query` (service-role equivalent)  
**Tables Audited:** `attendance`, `attendance_breaks`, `attendance_selfies`, `attendance_corrections`, `overtime_records`, `leaves`, `payslips`, `salary_structures`

---

## 1. RLS Status

| Table | RLS Enabled |
|---|---|
| attendance | ✅ YES |
| attendance_breaks | ✅ YES |
| attendance_selfies | ✅ YES |
| attendance_corrections | ✅ YES |
| overtime_records | ✅ YES |
| leaves | ✅ YES |
| payslips | ✅ YES |
| salary_structures | ✅ YES |

All 8 tables have RLS enabled.

---

## 2. All Active Policies

### 2.1 attendance (6 policies — 4 PERMISSIVE, 2 RESTRICTIVE)

| Policy Name | Type | Roles | Cmd | Qual | With Check |
|---|---|---|---|---|---|
| `attendance_hr_all` | PERMISSIVE | authenticated | ALL | `is_hr()` | `is_hr()` |
| `attendance_self_read` | PERMISSIVE | authenticated | SELECT | `employees.user_id = auth.uid()` | — |
| `attendance_self_update` | PERMISSIVE | authenticated | UPDATE | `employees.user_id = auth.uid()` | `employees.user_id = auth.uid()` |
| `attendance_self_write` | PERMISSIVE | authenticated | INSERT | — | `employees.user_id = auth.uid()` |
| `tenant_active_restrictive` | **RESTRICTIVE** | public | ALL | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| `tenant_isolation` | **RESTRICTIVE** | authenticated | ALL | `tenant_id = get_auth_tenant_id()` | `tenant_id = get_auth_tenant_id()` |

### 2.2 attendance_breaks (3 policies — 3 PERMISSIVE, **0 RESTRICTIVE**)

| Policy Name | Type | Roles | Cmd | Qual | With Check |
|---|---|---|---|---|---|
| `breaks_hr_all` | PERMISSIVE | authenticated | ALL | `is_hr()` | `is_hr()` |
| `breaks_self_read` | PERMISSIVE | authenticated | SELECT | `employees.user_id = auth.uid()` | — |
| `tenant_isolation` | PERMISSIVE | authenticated | ALL | `tenant_id = get_auth_tenant_id()` | `tenant_id = get_auth_tenant_id()` |

### 2.3 attendance_corrections (3 policies — 3 PERMISSIVE, **0 RESTRICTIVE**)

| Policy Name | Type | Roles | Cmd | Qual | With Check |
|---|---|---|---|---|---|
| `attendance_corrections_hr_all` | PERMISSIVE | authenticated | ALL | `is_hr()` | `is_hr()` |
| `attendance_corrections_self` | PERMISSIVE | authenticated | ALL | `employees.user_id = auth.uid()` | `employees.user_id = auth.uid()` |
| `tenant_isolation` | PERMISSIVE | authenticated | ALL | `tenant_id = get_auth_tenant_id()` | `tenant_id = get_auth_tenant_id()` |

### 2.4 attendance_selfies (4 policies — 3 PERMISSIVE, 1 RESTRICTIVE)

| Policy Name | Type | Roles | Cmd | Qual | With Check |
|---|---|---|---|---|---|
| `selfies_hr_all` | PERMISSIVE | authenticated | ALL | `is_hr()` | `is_hr()` |
| `selfies_self_read` | PERMISSIVE | authenticated | SELECT | `employee_id = employees.id WHERE user_id = auth.uid()` | — |
| `selfies_tenant_isolation` | PERMISSIVE | authenticated | ALL | `tenant_id = get_auth_tenant_id()` | `tenant_id = get_auth_tenant_id()` |
| `selfies_tenant_active_restrictive` | **RESTRICTIVE** | public | ALL | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |

### 2.5 leaves (5 policies — 3 PERMISSIVE, 2 RESTRICTIVE)

| Policy Name | Type | Roles | Cmd | Qual | With Check |
|---|---|---|---|---|---|
| `leaves_hr_all` | PERMISSIVE | authenticated | ALL | `is_hr()` | `is_hr()` |
| `leaves_self_insert` | PERMISSIVE | authenticated | INSERT | — | `employees.user_id = auth.uid()` |
| `leaves_self_read` | PERMISSIVE | authenticated | SELECT | `employees.user_id = auth.uid()` | — |
| `tenant_active_restrictive` | **RESTRICTIVE** | public | ALL | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| `tenant_isolation` | **RESTRICTIVE** | authenticated | ALL | `tenant_id = get_auth_tenant_id()` | `tenant_id = get_auth_tenant_id()` |

### 2.6 overtime_records (1 policy — 1 PERMISSIVE, **0 RESTRICTIVE**)

| Policy Name | Type | Roles | Cmd | Qual | With Check |
|---|---|---|---|---|---|
| `tenant_isolation` | PERMISSIVE | authenticated | ALL | `tenant_id = get_auth_tenant_id()` | `tenant_id = get_auth_tenant_id()` |

### 2.7 payslips (3 policies — 2 PERMISSIVE, 1 RESTRICTIVE)

| Policy Name | Type | Roles | Cmd | Qual | With Check |
|---|---|---|---|---|---|
| `employee_own_payslips` | PERMISSIVE | authenticated | SELECT | `role = 'hr' OR (role = 'employee' AND employee_id matches auth user)` | — |
| `tenant_isolation` | PERMISSIVE | authenticated | ALL | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| `tenant_active_restrictive` | **RESTRICTIVE** | public | ALL | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |

### 2.8 salary_structures (2 policies — 1 PERMISSIVE, 1 RESTRICTIVE)

| Policy Name | Type | Roles | Cmd | Qual | With Check |
|---|---|---|---|---|---|
| `tenant_isolation` | PERMISSIVE | authenticated | ALL | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |
| `tenant_active_restrictive` | **RESTRICTIVE** | public | ALL | `can_access_tenant(tenant_id)` | `can_access_tenant(tenant_id)` |

---

## 3. Duplicate Policy Names

Three policy names appear on multiple tables (expected — they are template policies):

| Policy Name | Tables |
|---|---|
| `admin_bypass` | 14 tables (not in our target set) |
| `tenant_active_restrictive` | 17 tables |
| `tenant_isolation` | 23 tables |

No unintended duplicate policy names within a single table.

---

## 4. PostgreSQL Policy Combination Logic

PostgreSQL evaluates RLS policies using this logic:

```
Row accessible IF:
    (PERMISSIVE_1 OR PERMISSIVE_2 OR ... PERMISSIVE_N)
    AND
    (RESTRICTIVE_1 AND RESTRICTIVE_2 AND ... RESTRICTIVE_M)
```

- **PERMISSIVE policies** are combined with **OR** — at least one must return TRUE
- **RESTRICTIVE policies** are combined with **AND** — ALL must return TRUE
- If **no PERMISSIVE policy** exists for a given command → rows are implicitly **denied**
- If **no RESTRICTIVE policy** exists → only PERMISSIVE policies govern access
- If **no policies at all** exist for a command → **all rows are denied**

**Critical implication:** Tables with `tenant_isolation` as PERMISSIVE (not RESTRICTIVE) lose tenant-scoped row filtering because `tenant_isolation` will match ALL rows in the same tenant, granting blanket access when combined with any other PERMISSIVE policy.

---

## 5. Vulnerability Analysis Per Table

### 5.1 attendance — ✅ CORRECT

**RLS evaluation for a normal employee:**

| Operation | Can do? | Why |
|---|---|---|
| **Read own attendance** | ✅ YES | `attendance_self_read`: `employees.user_id = auth.uid()` |
| **Read another's attendance** | ❌ NO | `attendance_self_read` fails; `attendance_hr_all` fails (not HR); both RESTRICTIVE policies block |
| **Update own** | ✅ YES | `attendance_self_update`: `employees.user_id = auth.uid()` |
| **Update another's** | ❌ NO | No permissive policy matches + RESTRICTIVE policies block |
| **Delete own** | ❌ NO | No DELETE policy exists; no permissive policy for DELETE |
| **Delete another's** | ❌ NO | Same |

**Verdict: Correct. Self-read, self-update, self-insert only. HR gets full access.**

Note: There is no explicit DELETE row-level policy — DELETE is neither granted by `attendance_self_read` (SELECT only), `attendance_self_update` (UPDATE only), `attendance_self_write` (INSERT only), nor `attendance_hr_all` (ALL includes DELETE for HR). Regular employees have no permissive DELETE policy, so DELETE is implicitly denied. HR can DELETE via `attendance_hr_all` (ALL).

---

### 5.2 attendance_breaks — 🚨 VULNERABLE

**RLS evaluation for a normal employee (authenticated, not HR):**

| Operation | Can do? | Why |
|---|---|---|
| **Read own breaks** | ✅ YES | `breaks_self_read`: `employees.user_id = auth.uid()` |
| **Read another's breaks** | ✅ **YES — LEAK** | `tenant_isolation` (PERMISSIVE) matches all rows with same tenant_id |
| **Update own breaks** | ❌ NO¹ | No update-own policy; `tenant_isolation` (PERMISSIVE) applies² |
| **Update another's breaks** | ✅ **YES — VULNERABILITY** | `tenant_isolation` (PERMISSIVE) qual passes for same tenant |
| **Delete another's breaks** | ✅ **YES — VULNERABILITY** | `tenant_isolation` (PERMISSIVE) applies to ALL commands |

¹ Actually, `tenant_isolation` IS permissive for ALL commands, INCLUDING UPDATE/DELETE. Since it checks only `tenant_id = get_auth_tenant_id()`, an employee CAN update or delete ANY break record within their tenant.

² For INSERT: `tenant_isolation` with_check only checks `tenant_id = get_auth_tenant_id()`. So an employee CAN insert a break for any employee within their tenant (as long as they set the correct tenant_id).

**Root cause:** `tenant_isolation` is PERMISSIVE (not RESTRICTIVE) and there is **no RESTRICTIVE policy** on this table. All 3 policies are PERMISSIVE — the first one to match grants access. Since `tenant_isolation` matches every row with the same tenant_id, any authenticated user in the tenant gets full access to all breaks.

---

### 5.3 attendance_corrections — 🚨 VULNERABLE

**RLS evaluation for a normal employee:**

| Operation | Can do? | Why |
|---|---|---|
| **Read own corrections** | ✅ YES | `attendance_corrections_self`: `employees.user_id = auth.uid()` |
| **Read another's corrections** | ✅ **YES — LEAK** | `tenant_isolation` (PERMISSIVE) matches all rows in same tenant |
| **Update own corrections** | ✅ YES | `attendance_corrections_self` matches |
| **Update another's corrections** | ✅ **YES — VULNERABILITY** | `tenant_isolation` (PERMISSIVE) qual passes |
| **Delete another's corrections** | ✅ **YES — VULNERABILITY** | `tenant_isolation` (PERMISSIVE) applies to ALL |

Same root cause as `attendance_breaks`: `tenant_isolation` is PERMISSIVE with no RESTRICTIVE counterpart. `attendance_corrections_self` is also ALL (including DELETE), which compounds the issue.

---

### 5.4 attendance_selfies — ✅ CORRECT

| Operation | Can do? | Why |
|---|---|---|
| **Read own selfies** | ✅ YES | `selfies_self_read`: `employee_id = employees.id WHERE user_id = auth.uid()` |
| **Read another's selfies** | ❌ NO | No permissive policy matches non-HR; RESTRICTIVE policies block |
| **Write/Update/Delete** | ❌ NO | No INSERT/UPDATE/DELETE policy for non-HR users |

`selfies_tenant_isolation` is PERMISSIVE but `selfies_tenant_active_restrictive` is RESTRICTIVE. The RESTRICTIVE policy requires `can_access_tenant()` which is true for authenticated users. However, the only permissive policies are `selfies_self_read` (SELECT only) and `selfies_hr_all` (ALL, HR only) and `selfies_tenant_isolation` (ALL). Since `selfies_tenant_isolation` is PERMISSIVE and `selfies_tenant_active_restrictive` is RESTRICTIVE, the combined effect is: `(selfies_self_read OR selfies_hr_all OR selfies_tenant_isolation) AND selfies_tenant_active_restrictive`.

Wait — since `selfies_tenant_isolation` (PERMISSIVE) matches all rows in the same tenant, and `selfies_tenant_active_restrictive` (RESTRICTIVE, public) allows access if `can_access_tenant()` returns true...

Let me re-evaluate. `can_access_tenant()` returns true if: `is_superadmin()` OR (`tenant_uuid = get_auth_tenant_id()` AND `tenant_is_active(tenant_uuid)`). For a normal authenticated employee in an active tenant, `can_access_tenant()` returns true. And `selfies_tenant_isolation` (PERMISSIVE) also checks `tenant_id = get_auth_tenant_id()`.

So the combined evaluation for SELECT on `attendance_selfies` for a normal employee:
- PERMISSIVE: `selfies_self_read` (own) OR `selfies_hr_all` (false) OR `selfies_tenant_isolation` (true for same tenant)
- RESTRICTIVE: `selfies_tenant_active_restrictive` (true for active tenant)
- RESULT: `(own OR same_tenant) AND active_tenant` → **can read ANY selfie in the same tenant**

This means an employee CAN read other employees' selfies in the same tenant!

But wait — the `selfies_self_read` policy uses `employee_id = (SELECT employees.id FROM employees WHERE employees.user_id = auth.uid())`. The `selfies_tenant_isolation` checks `tenant_id = get_auth_tenant_id()`. So:

For SELECT: `selfies_self_read` matches only own selfies. `selfies_tenant_isolation` matches ALL selfies in the tenant. Since they're OR'd, an employee can SELECT any selfie in their tenant.

For INSERT/UPDATE/DELETE: only `selfies_hr_all` (false for employees) and `selfies_tenant_isolation` (true for same tenant) and `selfies_tenant_active_restrictive` (true for active tenant). So employee CAN INSERT/UPDATE/DELETE any selfie in their tenant!

**Correction: attendance_selfies is VULNERABLE, not correct.**

Let me reconsider:

Actually, `selfies_self_read` is only for SELECT and has qual only. For UPDATE/DELETE, the available permissive policies are `selfies_hr_all` (requires is_hr()) and `selfies_tenant_isolation` (requires same tenant_id). Since `selfies_tenant_isolation` is permissive for ALL, an employee can UPDATE/DELETE any selfie where `tenant_id = get_auth_tenant_id()` — which is basically all selfies in their tenant.

But `selfies_tenant_isolation` has with_check: `tenant_id = get_auth_tenant_id()`. So for UPDATE, the with_check must pass. If someone tries to update a selfie's tenant_id to a different tenant, it would fail. But they can still update any other column of any selfie in their tenant.

So attendance_selfies IS vulnerable to cross-employee access within the same tenant, but only because `selfies_tenant_isolation` is PERMISSIVE rather than RESTRICTIVE. However, there IS a RESTRICTIVE policy (`selfies_tenant_active_restrictive`) that checks `can_access_tenant()`. Since `can_access_tenant()` returns true for any user in the same active tenant, the restriction doesn't actually prevent same-tenant access.

Actually, the critical issue here is: `selfies_tenant_isolation` is PERMISSIVE and applies to ALL. It doesn't have an employee_id check. So within a tenant, anyone can access anyone's selfies.

Let me finalize my analysis. The issue comes down to: **for tables where `tenant_isolation` is PERMISSIVE (not RESTRICTIVE), and there are no additional ownership checks, any authenticated user within the same tenant can access all rows.**

---

### 5.5 leaves — ✅ CORRECT

| Operation | Can do? | Why |
|---|---|---|
| **Read own leaves** | ✅ YES | `leaves_self_read`: `employees.user_id = auth.uid()` |
| **Read another's leaves** | ❌ NO | `leaves_self_read` fails; `leaves_hr_all` fails; both RESTRICTIVE policies block |
| **Insert own** | ✅ YES | `leaves_self_insert`: with_check matches own employee_id |
| **Insert for another** | ❌ NO | `leaves_self_insert` with_check fails; `leaves_hr_all` requires HR |
| **Update/Delete own** | ❌ NO | No UPDATE/DELETE permissive policy for non-HR |
| **Update/Delete another's** | ❌ NO | No permissive policy matches |

Note: Both `tenant_active_restrictive` and `tenant_isolation` are RESTRICTIVE on leaves, which means even if a permissive policy were to match, the restrictive policies would still need to pass. Leaves is well-protected.

---

### 5.6 overtime_records — 🔴 CRITICAL VULNERABILITY

| Operation | Can do? | Why |
|---|---|---|
| **Read own overtime** | ✅ YES | `tenant_isolation` matches all rows in same tenant |
| **Read another's overtime** | ✅ **YES — LEAK** | Only `tenant_isolation` exists; it's PERMISSIVE; no employee_id check |
| **Insert for self** | ✅ YES | `tenant_isolation` with_check: tenant_id = get_auth_tenant_id() |
| **Insert for another** | ✅ **YES — VULNERABILITY** | No employee_id check in with_check |
| **Update own** | ✅ YES | Same |
| **Update another's** | ✅ **YES — VULNERABILITY** | No employee_id check in qual |
| **Delete another's** | ✅ **YES — VULNERABILITY** | No employee_id check |

**This is the most critical finding.** `overtime_records` has only **1 policy** — a PERMISSIVE `tenant_isolation`. There is:
- ❌ No RESTRICTIVE policy
- ❌ No HR role policy
- ❌ No employee ownership check
- ❌ No employee_id filter in either `qual` or `with_check`

Any authenticated user within the same tenant has full CRUD access to ALL overtime records of ALL employees.

---

### 5.7 payslips — 🟡 PARTIALLY VULNERABLE

| Operation | Can do? | Why |
|---|---|---|
| **Read own payslip** | ✅ YES | `employee_own_payslips`: checks employee_id chain + HR bypass |
| **Read another's payslip** | ❌ NO | `employee_own_payslips` fails for cross-employee; HR bypass only works for HR |
| **Insert any payslip** | ✅ **YES — VULNERABILITY** | `employee_own_payslips` is SELECT-only; `tenant_isolation` (PERMISSIVE, ALL) with_check = `can_access_tenant()` — any active-tenant user can INSERT |
| **Update any payslip** | ✅ **YES — VULNERABILITY** | `tenant_isolation` qual = `can_access_tenant()` — matches all rows in active tenant |
| **Delete any payslip** | ✅ **YES — VULNERABILITY** | Same as UPDATE |

Root cause: `employee_own_payslips` is the only role-aware policy and it only covers SELECT. For INSERT/UPDATE/DELETE, only `tenant_isolation` (PERMISSIVE, ALL) and `tenant_active_restrictive` (RESTRICTIVE, ALL) apply. Since both check `can_access_tenant()` (which returns true for all users in the active tenant), **any authenticated employee can INSERT/UPDATE/DELETE payslips for any employee**.

---

### 5.8 salary_structures — 🟡 PARTIALLY VULNERABLE

| Operation | Can do? | Why |
|---|---|---|
| **Read own salary structure** | ✅ YES | `tenant_isolation` matches all rows in same tenant |
| **Read another's salary structure** | ✅ **YES — DATA LEAK** | No employee_id check; only `can_access_tenant()` |
| **Insert/Update/Delete any** | ✅ **YES — VULNERABILITY** | No role or ownership check |

Root cause: Both policies only check `can_access_tenant()`. There is no `is_hr()` check, no `is_admin()` check, and no `employee_id` ownership filter. Any authenticated user in the same active tenant has full CRUD access to all salary structures.

---

## 6. SQL Proof

The following SQL was executed live against the database to verify:

```sql
-- RLS enabled for all 8 tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('attendance','attendance_breaks','attendance_selfies',
                    'attendance_corrections','overtime_records','leaves',
                    'payslips','salary_structures')
ORDER BY tablename;

-- All policies on target tables
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('attendance','attendance_breaks','attendance_selfies',
                    'attendance_corrections','overtime_records','leaves',
                    'payslips','salary_structures')
ORDER BY tablename, policyname;
-- Returns 27 rows

-- Tables without RESTRICTIVE policies
SELECT tablename, count(*)::text as policy_count,
       bool_or(permissive = 'RESTRICTIVE')::text as has_restrictive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('attendance','attendance_breaks','attendance_selfies',
                    'attendance_corrections','overtime_records','leaves',
                    'payslips','salary_structures')
GROUP BY tablename
ORDER BY tablename;

-- Helper function definitions
SELECT proname, prosrc
FROM pg_proc
WHERE proname IN ('is_hr','is_admin','is_superadmin',
                  'can_access_tenant','get_auth_tenant_id','tenant_is_active')
ORDER BY proname;
```

**`can_access_tenant` definition** (the critical gatekeeper):
```sql
SELECT (SELECT public.is_superadmin())
   OR (tenant_uuid = (SELECT public.get_auth_tenant_id())
       AND (SELECT public.tenant_is_active(tenant_uuid)));
```

This function returns TRUE for any authenticated user in the same active tenant. It does NOT check roles like `hr` or `employee`. Combined with PERMISSIVE policies that lack ownership checks, this creates the vulnerabilities.

---

## 7. Final Verdict

### Summary of Findings

| Table | Cross-Employee Read | Cross-Employee Write | Has RESTRICTIVE Policy | Risk Level |
|---|---|---|---|---|
| attendance | ✅ Protected | ✅ Protected | ✅ 2 RESTRICTIVE | ✅ Secure |
| attendance_breaks | 🚨 **LEAK** | 🚨 **WRITE** | ❌ 0 RESTRICTIVE | **High Risk** |
| attendance_corrections | 🚨 **LEAK** | 🚨 **WRITE** | ❌ 0 RESTRICTIVE | **High Risk** |
| attendance_selfies | 🚨 **LEAK** | 🚨 **WRITE** | ✅ 1 RESTRICTIVE¹ | **Medium Risk** |
| leaves | ✅ Protected | ✅ Protected | ✅ 2 RESTRICTIVE | ✅ Secure |
| overtime_records | 🔴 **LEAK** | 🔴 **FULL CRUD** | ❌ 0 RESTRICTIVE | **Confirmed Critical** |
| payslips | ✅ Protected (SELECT only) | 🚨 **WRITE** | ✅ 1 RESTRICTIVE¹ | **High Risk** |
| salary_structures | 🚨 **LEAK** | 🚨 **FULL CRUD** | ✅ 1 RESTRICTIVE¹ | **High Risk** |

¹ RESTRICTIVE policy exists but only checks `can_access_tenant()` which allows any authenticated user in the same active tenant. It does not add meaningful protection beyond what `tenant_isolation` already provides.

### Risk Scoring

| Risk Level | Count | Tables |
|---|---|---|
| 🔴 **Confirmed Critical Vulnerability** | 1 | `overtime_records` |
| 🚨 **High Risk** | 4 | `attendance_breaks`, `attendance_corrections`, `payslips`, `salary_structures` |
| 🟡 **Medium Risk** | 1 | `attendance_selfies` |
| ✅ **Secure / False Positive** | 2 | `attendance`, `leaves` |

### Final Verdict: 🔴 Confirmed Critical Vulnerability

**`overtime_records`** has a single PERMISSIVE policy with no row-level ownership check — any authenticated employee has full CRUD access to all overtime records in their tenant. This is a **confirmed critical vulnerability**.

Additionally, **4 high-risk findings** affect `attendance_breaks`, `attendance_corrections`, `payslips`, and `salary_structures`, where cross-employee data access or write operations are possible despite RLS being enabled.

### Root Cause Pattern

The systemic issue is that `tenant_isolation` is inconsistently applied:
- On `attendance` and `leaves` → **RESTRICTIVE** (correct — blocks cross-tenant AND acts as a hard filter)
- On `attendance_selfies` → PERMISSIVE (but has a separate RESTRICTIVE policy)
- On `attendance_breaks`, `attendance_corrections`, `overtime_records` → PERMISSIVE with **NO** RESTRICTIVE counterpart
- On `payslips`, `salary_structures` → PERMISSIVE with RESTRICTIVE that only checks `can_access_tenant()`

For `payslips` and `salary_structures`, the `tenant_isolation` policy uses `can_access_tenant()` instead of `get_auth_tenant_id()`, and there are no `employee_id` or role-based ownership checks on INSERT/UPDATE/DELETE operations.

### Recommended Fixes (Informational — not applied)

1. **overtime_records**: Add `overtime_self` (SELECT/INSERT/UPDATE with `employees.user_id = auth.uid()`), `overtime_hr_all` (ALL with `is_hr()`), and convert `tenant_isolation` to RESTRICTIVE
2. **attendance_breaks**: Convert `tenant_isolation` to RESTRICTIVE
3. **attendance_corrections**: Convert `tenant_isolation` to RESTRICTIVE
4. **payslips**: Add role/ownership WITH CHECK constraints on INSERT/UPDATE/DELETE
5. **salary_structures**: Add `is_hr()` requirement or ownership filter
6. **attendance_selfies**: Convert `selfies_tenant_isolation` to RESTRICTIVE or add ownership checks
