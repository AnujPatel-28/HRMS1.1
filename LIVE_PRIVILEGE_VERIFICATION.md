# LIVE PRIVILEGE VERIFICATION

**Date:** 2026-06-15
**Source:** `information_schema.role_table_grants` + `pg_policies` queried via InsForge CLI against production (`rq3qmu8y.ap-southeast`)

---

## 1. SQL GRANT Permissions

All six tables were granted full DML to both `authenticated` and `anon` at the SQL level. The `service_role` role has **no explicit grants** in `information_schema.role_table_grants` — it accesses data through the admin API key which bypasses RLS as `postgres`.

| Table | `authenticated` | `anon` | `service_role` |
|---|---|---|---|
| `attendance_breaks` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT, UPDATE, DELETE | *(no explicit grants)* |
| `attendance_corrections` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT, UPDATE, DELETE | *(no explicit grants)* |
| `attendance_selfies` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT, UPDATE, DELETE | *(no explicit grants)* |
| `overtime_records` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT, UPDATE, DELETE | *(no explicit grants)* |
| `payslips` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT, UPDATE, DELETE | *(no explicit grants)* |
| `salary_structures` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT, UPDATE, DELETE | *(no explicit grants)* |

> `anon` having all DML grants is standard for InsForge — RLS is the enforcement layer. The `anon` role maps to requests without authentication. All RLS policies below target `authenticated` (or `public` for restrictive policies), so `anon` is blocked by RLS default-deny on every table.

---

## 2. RLS Status

| Table | RLS Enabled | Policy Count |
|---|---|---|
| `attendance_breaks` | Yes | 3 |
| `attendance_corrections` | Yes | 3 |
| `attendance_selfies` | Yes | 4 |
| `overtime_records` | Yes | 1 |
| `payslips` | Yes | 3 |
| `salary_structures` | Yes | 2 |

---

## 3. RLS Policies (Detail)

### attendance_breaks

| Policy | Roles | Cmd | Permissive | Effect |
|---|---|---|---|---|
| `breaks_hr_all` | authenticated | ALL | PERMISSIVE | Full access when `is_hr()` returns true |
| `breaks_self_read` | authenticated | SELECT | PERMISSIVE | Can SELECT own breaks linked via `employees.user_id = auth.uid()` |
| `tenant_isolation` | authenticated | ALL | PERMISSIVE | `tenant_id = get_auth_tenant_id()` (qual + with_check) |

### attendance_corrections

| Policy | Roles | Cmd | Permissive | Effect |
|---|---|---|---|---|
| `attendance_corrections_hr_all` | authenticated | ALL | PERMISSIVE | Full access when `is_hr()` returns true |
| `attendance_corrections_self` | authenticated | ALL | PERMISSIVE | Can SELECT/INSERT/UPDATE/DELETE own corrections (self-scoped via employees join) |
| `tenant_isolation` | authenticated | ALL | PERMISSIVE | `tenant_id = get_auth_tenant_id()` |

### attendance_selfies

| Policy | Roles | Cmd | Permissive | Effect |
|---|---|---|---|---|
| `selfies_hr_all` | authenticated | ALL | PERMISSIVE | Full access when `is_hr()` returns true |
| `selfies_self_read` | authenticated | SELECT | PERMISSIVE | Can SELECT own selfies |
| `selfies_tenant_isolation` | authenticated | ALL | PERMISSIVE | `tenant_id = get_auth_tenant_id()` |
| `selfies_tenant_active_restrictive` | public | ALL | **RESTRICTIVE** | `can_access_tenant()` gate |

### overtime_records

| Policy | Roles | Cmd | Permissive | Effect |
|---|---|---|---|---|
| `tenant_isolation` | authenticated | ALL | PERMISSIVE | `tenant_id = get_auth_tenant_id()` (qual + with_check) |

### payslips

| Policy | Roles | Cmd | Permissive | Effect |
|---|---|---|---|---|
| `employee_own_payslips` | authenticated | SELECT | PERMISSIVE | HR sees all; employees see only own payslips |
| `tenant_isolation` | authenticated | ALL | PERMISSIVE | `can_access_tenant()` gate |
| `tenant_active_restrictive` | public | ALL | **RESTRICTIVE** | `can_access_tenant()` gate |

### salary_structures

| Policy | Roles | Cmd | Permissive | Effect |
|---|---|---|---|---|
| `tenant_isolation` | authenticated | ALL | PERMISSIVE | `can_access_tenant()` gate |
| `tenant_active_restrictive` | public | ALL | **RESTRICTIVE** | `can_access_tenant()` gate |

---

## 4. Can an Employee SELECT / INSERT / UPDATE / DELETE?

An **"employee"** is an `authenticated` user whose JWT `metadata->>'role'` is NOT `'hr'`.

### attendance_breaks

| Operation | Can employee? | Why |
|---|---|---|
| SELECT | **Yes** (own only) | `breaks_self_read` matches with permissive policy + `tenant_isolation` |
| INSERT | **Yes** (tenant-scoped) | `tenant_isolation` with_check passes for correct tenant |
| UPDATE | **Yes** (tenant-scoped) | `tenant_isolation` qual + with_check — can modify ANY break in tenant |
| DELETE | **Yes** (tenant-scoped) | `tenant_isolation` qual — can delete ANY break in tenant |

> ⚠️ **Gap:** No self-write policy exists. `breaks_self_read` is SELECT-only. An employee CAN modify or delete another employee's breaks within the same tenant via `tenant_isolation`.

### attendance_corrections

| Operation | Can employee? | Why |
|---|---|---|
| SELECT | **Yes** (own only) | `attendance_corrections_self` qual scoped to own employee record |
| INSERT | **Yes** (own only) | `attendance_corrections_self` with_check scoped to own employee record |
| UPDATE | **Yes** (own only) | `attendance_corrections_self` qual + with_check scoped to own record |
| DELETE | **Yes** (own only) | `attendance_corrections_self` qual scoped to own record |

> ✅ Properly self-scoped. The `attendance_corrections_self` policy covers ALL commands with both `using` and `with_check` scoped to `employee_id` via `employees.user_id = auth.uid()`.

### attendance_selfies

| Operation | Can employee? | Why |
|---|---|---|
| SELECT | **Yes** (own only) | `selfies_self_read` scoped to own employee_id |
| INSERT | **Yes** (tenant-scoped) | `selfies_tenant_isolation` with_check — can create selfies for any employee in tenant |
| UPDATE | **Yes** (tenant-scoped) | `selfies_tenant_isolation` qual + with_check — can modify any selfie in tenant |
| DELETE | **Yes** (tenant-scoped) | `selfies_tenant_isolation` qual — can delete any selfie in tenant |

> ⚠️ **Gap:** Same pattern as `attendance_breaks`. No self-write policy. `selfies_self_read` is SELECT-only. An employee can modify or delete another employee's selfies within the same tenant.

### overtime_records

| Operation | Can employee? | Why |
|---|---|---|
| SELECT | **Yes** (tenant-scoped) | Only `tenant_isolation` — no self/HR filter on reads |
| INSERT | **Yes** (tenant-scoped) | `tenant_isolation` with_check — no employee ownership check |
| UPDATE | **Yes** (tenant-scoped) | `tenant_isolation` qual + with_check — any record in tenant |
| DELETE | **Yes** (tenant-scoped) | `tenant_isolation` qual — any record in tenant |

> ⚠️ **Critical gap:** No `is_hr()` policy, no self-scoping policy. Any authenticated user within the tenant has full CRUD on ALL overtime records. `attendance_corrections_self` exists for corrections but NOT for overtime.

### payslips

| Operation | Can employee? | Why |
|---|---|---|
| SELECT | **Yes** (own only) | `employee_own_payslips` — employees see own, HR sees all |
| INSERT | **Yes** (tenant-scoped) | `tenant_isolation` with_check — no HR-gate/self-gate on INSERT |
| UPDATE | **Yes** (tenant-scoped) | `tenant_isolation` qual + with_check — no role restriction |
| DELETE | **Yes** (tenant-scoped) | `tenant_isolation` qual — no role restriction |

> ⚠️ **Gap:** `employee_own_payslips` only gates SELECT. An employee can INSERT/UPDATE/DELETE any payslip within the tenant.

### salary_structures

| Operation | Can employee? | Why |
|---|---|---|
| SELECT | **Yes** (tenant-scoped) | Only `tenant_isolation` — no HR role check |
| INSERT | **Yes** (tenant-scoped) | `tenant_isolation` with_check — no role restriction |
| UPDATE | **Yes** (tenant-scoped) | `tenant_isolation` qual + with_check — no role restriction |
| DELETE | **Yes** (tenant-scoped) | `tenant_isolation` qual — no role restriction |

> ⚠️ **Gap:** No HR-gate at all. Every authenticated user in the tenant has full CRUD on salary structures.

---

## 5. Is the REVOKE Migration Active in Production?

The file `scratch/phase3_restrict_direct_hr_writes.sql` contains:

```sql
REVOKE INSERT, UPDATE, DELETE ON public.overtime_records FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_corrections FROM authenticated;
-- (also leave_requests, employee_shifts, attendance_location_exceptions)
```

**Status in production:** ❌ **NOT ACTIVE**

`information_schema.role_table_grants` confirms that both `overtime_records` and `attendance_corrections` still have `INSERT`, `UPDATE`, `DELETE` granted to `authenticated`. The REVOKE statements have **not been run** on the production database.

This also means the HR-RPC migration that was supposed to replace direct writes has not yet been enforced.

---

## 6. Summary Table

| Table | Employee SELECT | Employee INSERT | Employee UPDATE | Employee DELETE | Has HR-only policy? | Has self-scope policy? |
|---|---|---|---|---|---|---|
| `attendance_breaks` | ✅ Own only | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ (`breaks_hr_all`) | SELECT only |
| `attendance_corrections` | ✅ Own only | ✅ Own only | ✅ Own only | ✅ Own only | ✅ | ✅ ALL commands |
| `attendance_selfies` | ✅ Own only | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ (`selfies_hr_all`) | SELECT only |
| `overtime_records` | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ❌ None | ❌ None |
| `payslips` | ✅ Own (or HR sees all) | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ❌ None (only JWT role check on SELECT) | SELECT only |
| `salary_structures` | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ✅ Tenant-scoped ⚠️ | ❌ None | ❌ None |

### Legend
- **Own only** = RLS scopes the operation to the employee's own records (via `employees.user_id = auth.uid()`)
- **Tenant-scoped** = The operation is restricted only by tenant isolation, not by employee ownership or HR role
- **✅** = Properly scoped
- **⚠️** = Security gap — wider access than intended

---

## 7. Key Findings

1. **`overtime_records` is the most exposed table** — only has a single `tenant_isolation` policy. No HR gate, no self-scope. Any employee can CRUD any overtime record.

2. **`salary_structures` has no HR gate** — only tenant isolation. Same exposure as overtime_records.

3. **`payslips` allows write by any employee** — the `employee_own_payslips` policy only restricts SELECT. INSERT/UPDATE/DELETE fall through to bare `tenant_isolation`.

4. **`attendance_breaks` and `attendance_selfies` share the same gap** — `*_self_read` policies are SELECT-only. Employees can write (INSERT/UPDATE/DELETE) each other's records within the tenant.

5. **`attendance_corrections` is the only table with proper self-scoping** — the `attendance_corrections_self` policy covers ALL commands with employee ownership check in both `using` and `with_check`.

6. **The phase-3 REVOKE migration has NOT been applied** — `overtime_records` and `attendance_corrections` still have full SQL grants to `authenticated`. The planned hardening that forces all HR writes through SECURITY DEFINER RPCs is not yet in effect.
