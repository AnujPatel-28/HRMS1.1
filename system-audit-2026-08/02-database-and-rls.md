# 02 — Database & RLS (live-verified)

Source: live queries against production project `HRMS` (`rq3qmu8y`) on 2026-08-12. **57 public tables.**

## 1. RLS coverage map

Legend: RLS = row security enabled, POL = policy count, TID = has `tenant_id` column.

### ✅ Tables with RLS ON + tenant isolation (the majority — good)
`attendance`, `attendance_breaks`, `attendance_corrections`, `attendance_location_exceptions`, `attendance_selfies`, `audit_logs`, `calendar_events`, `chat_channel_members`, `chat_channels`, `chat_messages`, `employee_documents`, `employee_onboarding`, `employee_onboarding_self`, `employee_reporting_relationships`, `employee_shifts`, `employees`, `exit_requests`, `expenses`, `holidays`, `hr_policies`, `insurance_policies`, `it_declaration_windows`, `it_declarations`, `leave_balances`, `leave_types`, `leaves`, `notifications`, `office_locations`, `overtime_records`, `payroll_runs`, `payslips`, `projects`, `salary_structures`, `shifts`, `task_submissions`, `tasks`, `tenants`, plus platform tables.

The standard, well-formed pattern seen repeatedly:
```
tenant_isolation (RESTRICTIVE, authenticated):  USING/CHECK  tenant_id = get_auth_tenant_id()
tenant_active_restrictive (RESTRICTIVE, public): USING/CHECK  can_access_tenant(tenant_id)
<table>_hr_all (PERMISSIVE, authenticated):       is_hr()
<table>_self_* (PERMISSIVE, authenticated):       EXISTS(employees e WHERE e.id=<row>.employee_id AND e.user_id=auth.uid())
```
The **RESTRICTIVE tenant policies are the key strength**: even if a permissive policy is too broad, the restrictive `tenant_id = get_auth_tenant_id()` cannot be bypassed from the client. `get_auth_tenant_id()` is `SECURITY DEFINER` with `search_path=''` and derives tenant from the session — **not** from client input. This is the correct multi-tenant foundation.

### 🔴 Tables with RLS **OFF** — see Finding S3
| Table | RLS | Policies | Rows | anon grants |
|---|---|---|---|---|
| `attendance_audit_logs` | ❌ off | 0 | 0 | ALL DML |
| `employment_types` | ❌ off | 0 | 0 | DELETE/INSERT/SELECT/UPDATE |
| `exit_clearance_templates` | ❌ off | 0 | 55 | DELETE/INSERT/SELECT/UPDATE |
| `exit_clearances` | ❌ off | 0 | 5 | DELETE/INSERT/SELECT/UPDATE |
| `job_titles` | ❌ off | 0 | 0 | DELETE/INSERT/SELECT/UPDATE |
| `locations` | ❌ off | 0 | 0 | DELETE/INSERT/SELECT/UPDATE |
| `org_units` | ❌ off | 0 | 0 | DELETE/INSERT/SELECT/UPDATE |
| `tenant_settings` | ❌ off | **1 (inert)** | 38 | ALL DML |
| `test_log` | ❌ off | 0 | 1 | ALL DML |
| `test_mcp_sync` | ❌ off | 0 | 0 | ALL DML |

Because RLS is off, the one policy on `tenant_settings` does **nothing** and every row of all 10 tables is readable/writable cross-tenant by any principal with the anon key. `exit_clearances` (real clearance records) and `tenant_settings` (per-tenant config, incl. `leave_min_notice_days` etc. consumed by the leave engine) are the concerning ones — a user in tenant A can read/modify tenant B's settings and clearance rows.

## 2. Privileged / SECURITY DEFINER functions — grant analysis

63 of ~69 app functions are `SECURITY DEFINER`. Most are correctly narrow (leave/attendance/shift RPCs that re-check `auth.uid()` and tenant). The problems are three functions that should never have been reachable by untrusted roles:

| Function | secdef | Internal authz check | EXECUTE granted to | Verdict |
|---|---|---|---|---|
| `exec_sql(text)` | ✅ | ❌ none | `anon`, `authenticated` | 🔴 arbitrary SQL — S1 |
| `query_json(text)` | ✅ | ❌ none | `anon`, `authenticated` | 🔴 arbitrary SQL read — S1 |
| `update_user_password(uuid,text)` | ✅ | ❌ none | `anon`, `authenticated` | 🔴 account takeover — S2 |
| `get_auth_user_details_by_email(text)` | ✅ | ❌ none | `anon`, `authenticated` | 🟠 user-id enumeration by email |
| `set_employee_password_by_hr(...)` | ✅ | ✅ checks `actor_role='hr'` + tenant match | `anon`,`authenticated` | 🟢 body is guarded — OK |

`exec_sql` verbatim (proves no authz, arbitrary DDL/DML):
```sql
CREATE FUNCTION public.exec_sql(query text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  lower_query := lower(trim(query));
  IF lower_query LIKE 'select%' OR lower_query LIKE 'with%' THEN
    EXECUTE 'SELECT jsonb_agg(t) FROM (' || query || ') t' INTO result; ...
  ELSE
    EXECUTE query;   -- <-- arbitrary INSERT/UPDATE/DELETE/DROP/ALTER
  ...
```
`update_user_password` verbatim (no caller check at all):
```sql
CREATE FUNCTION public.update_user_password(p_user_id uuid, p_password text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users SET password = crypt(p_password, gen_salt('bf')) WHERE id = p_user_id;
  RETURN true;
END; $$;
```

**Confirmed unused by the app** — no reference to `exec_sql`, `query_json`, or `update_user_password` anywhere in `src/` or `functions/`. They can be dropped with zero functional impact.

### `search_path` hardening (S6)
26 `SECURITY DEFINER` functions have **no** `SET search_path` (e.g. `punch_out_attendance`, `start/end_employee_break`, `approve_task_request`, `create_draft_employee`, `close_stale_attendance`, `delete_chat_channel`, several notify triggers). Best practice is `SET search_path = ''` (or `pg_catalog, public`) with fully-qualified names to prevent search-path hijacking. Lower priority than S1–S3 but should be fixed en masse.

## 3. Good transactional design (worth calling out)

The leave/attendance write RPCs are genuinely well-built:

- `approve_leave_request` — `SELECT ... FOR UPDATE` on the leave row **and** the balance row, re-checks `status='pending'` (idempotent against double-approval), validates `balance >= requested`, computes working days from shift + holidays, writes attendance rows, all in one transaction. This correctly prevents the classic **concurrent-approval balance race**.
- `employee_apply_leave_request` — validates tenant access, active employee, active leave type, notice period (per-tenant + per-type), min employment tenure, working-day count, max-consecutive limit, **and overlap against existing leaves** (verified present). Strong.
- `punch_out_attendance` — atomic and gated on `session_status='open'` (prevents double punch-out) — but see S5: it trusts client `p_work_hours` and lacks an ownership check.

## 4. Indexing

Index coverage on hot columns is good: `attendance(tenant_id, employee_id, date)`, `overtime_records`, `attendance_breaks`, `leave_balances(employee_id, tenant_id)`, `payslips(employee_id, tenant_id)`, `employees(tenant_id, user_id)`, etc. Minor gaps: `leaves` and `notifications` are indexed on `employee_id` only, not `tenant_id` — negligible at current data volume, worth adding a composite as the tenant count grows.

## 5. Data-hygiene issues in production
- `test_log`, `test_mcp_sync` are dev tables shipped to prod (and RLS-off with anon grants — S3/S7).
- Duplicated function overloads exist (`approve_task_request`, `hr_activate_draft_employee`, `punch_out_attendance`, `submit_task_request` each have 2 signatures) — verify the app calls the intended one and drop stale overloads to avoid ambiguity.
