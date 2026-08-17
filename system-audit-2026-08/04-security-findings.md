# 04 — Security findings (severity-ranked)

Each finding: evidence (live-verified), impact, and fix. Verdicts: **CONFIRMED** = proven from live grants/policy bodies; **PLAUSIBLE** = strong inference from code + config.

---

## 🔴 S1 — Arbitrary SQL execution reachable by `anon` (CRITICAL) — CONFIRMED
**What:** `public.exec_sql(text)` and `public.query_json(text)` are `SECURITY DEFINER` and `EXECUTE` is granted to `anon` and `authenticated`.
**Evidence:**
- ACL: `exec_sql` → `authenticated=X, anon=X`; `query_json` → `authenticated=X, anon=X`.
- Body of `exec_sql` runs `EXECUTE query` for any non-SELECT (arbitrary INSERT/UPDATE/DELETE/DROP/ALTER); `query_json` runs `EXECUTE 'SELECT ... FROM (' || query_text || ')'` (arbitrary read).
- Both bypass RLS because they are `SECURITY DEFINER` owned by a superuser role.
**Impact:** Anyone with the **public anon key** (shipped in the JS bundle, `VITE_INSFORGE_ANON_KEY`) can call these RPCs over HTTP and run any SQL: dump every tenant's data, read `auth.users` (password hashes), escalate roles, or drop tables. **Full database compromise, unauthenticated.**
**Fix (immediate):**
```sql
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.query_json(text) FROM anon, authenticated, public;
DROP FUNCTION IF EXISTS public.exec_sql(text);
DROP FUNCTION IF EXISTS public.query_json(text);
```
Verified safe to drop — **zero references** in `src/` or `functions/`.

---

## 🔴 S2 — Unauthenticated password reset of any user (CRITICAL) — CONFIRMED
**What:** `public.update_user_password(uuid, text)` is `SECURITY DEFINER`, contains **no authorization check**, and is granted to `anon` + `authenticated`.
**Evidence:** Body: `UPDATE auth.users SET password = crypt(p_password, gen_salt('bf')) WHERE id = p_user_id;` — no `auth.uid()` check, no role check. ACL: `authenticated=X, anon=X`.
**Impact:** Provide any `user_id` (user-ids leak through many reads, and `get_auth_user_details_by_email` maps email→id) and set that account's password → **account takeover of any employee, HR, or superadmin**, unauthenticated.
**Fix (immediate):**
```sql
REVOKE ALL ON FUNCTION public.update_user_password(uuid, text) FROM anon, authenticated, public;
DROP FUNCTION IF EXISTS public.update_user_password(uuid, text);
```
Unused by app (password changes go through the guarded `set_employee_password_by_hr` + edge function). Also lock down `get_auth_user_details_by_email(text)` (email→user-id enumeration) the same way.

---

## 🔴 S3 — 10 tables with RLS disabled but anon DML grants (HIGH) — CONFIRMED
**What:** These tables have `relrowsecurity = false` yet grant `SELECT/INSERT/UPDATE/DELETE` to `anon` + `authenticated`: `exit_clearances` (5 rows), `exit_clearance_templates` (55), `tenant_settings` (38), `org_units`, `job_titles`, `employment_types`, `locations`, `attendance_audit_logs`, `test_log`, `test_mcp_sync`.
**Evidence:** live `pg_class.relrowsecurity=false` + `role_table_grants` showing anon DML; `tenant_settings` has one policy that is **inert** because RLS is off.
**Impact:** Any principal with the anon key can read and modify these rows **across all tenants**. Most damaging: `tenant_settings` (drives leave-notice rules and other per-tenant behavior — tamperable), `exit_clearances`/`exit_clearance_templates` (offboarding integrity + PII), `org_units` (org structure).
**Fix:**
```sql
ALTER TABLE public.exit_clearances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exit_clearance_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_units              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_titles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employment_types       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit_logs  ENABLE ROW LEVEL SECURITY;
-- then add tenant_isolation policies mirroring the other tables:
--   USING/CHECK (tenant_id = get_auth_tenant_id())  + HR-write policy as needed
DROP TABLE IF EXISTS public.test_log, public.test_mcp_sync;   -- dev leftovers
```
Add a standing CI check: *no table may have RLS off while granting DML to anon/authenticated.*

---

## 🟠 S4 — Sensitive files in public storage buckets (MEDIUM) — CONFIRMED
**What:** Public buckets: `employee-documents`, `expense-receipts`, `hr-policies`, `chat-attachments`, plus expected-public `avatars`/`company-logos`/`company-assets`/`employee-profile-photos`. Private (correct): `attendance-selfies`, `insurance-documents`, `payslips`, `application-snapshots`, `resumes`, `recruiter_documents`.
**Impact:** In a BaaS, "public" bucket = objects served by URL with no auth. `employee-documents` (ID proofs, contracts) and `expense-receipts` are PII/financial and should not be world-readable. Public objects are also often CDN-cached — deleting the DB row doesn't necessarily purge the file.
**Fix:** Make `employee-documents`, `expense-receipts`, and likely `chat-attachments` **private**; serve via signed URLs. Re-evaluate whether `hr-policies` should be tenant-scoped rather than public. Audit existing object keys for tenant leakage.

---

## 🟠 S5 — `punch_out_attendance` trusts client hours, no owner check (MEDIUM) — PLAUSIBLE
**What:** `punch_out_attendance(p_attendance_id, p_tenant_id, p_work_hours, ...)` is `SECURITY DEFINER` and updates the row by `id + tenant_id + session_status='open'` only. `p_work_hours` is client-supplied and there is no check that `auth.uid()` owns the attendance row.
**Impact:** An employee can (a) set arbitrary `work_hours` on their own open session (overtime/payroll inflation) and (b) close **any** open session in their tenant given its attendance-id. Because it's `SECURITY DEFINER`, RLS does not save you.
**Fix:** Inside the function, verify ownership and recompute hours server-side:
```sql
-- require the caller to own the row
AND EXISTS (SELECT 1 FROM employees e
            WHERE e.id = attendance.employee_id AND e.user_id = auth.uid())
-- and derive work_hours from punch_in..now() rather than trusting p_work_hours
```

---

## 🟡 S6 — 26 SECURITY DEFINER functions without a fixed search_path (LOW/HARDENING) — CONFIRMED
**What:** e.g. `punch_out_attendance`, `start_employee_break`, `end_employee_break`, `approve_task_request`, `create_draft_employee`, `close_stale_attendance`, `delete_chat_channel`, `increment_announcement_*`, notify triggers.
**Impact:** Search-path hijack risk if an attacker can create objects in an earlier schema on the path.
**Fix:** `ALTER FUNCTION ... SET search_path = ''` (or `pg_catalog, public`) and schema-qualify all references. Apply as a batch migration.

---

## 🔴 S8 — Cross-tenant employee creation/activation via unguarded RPCs (HIGH) — CONFIRMED ✅ FIXED 2026-08-12
**What:** `create_draft_employee` was `SECURITY DEFINER` with **no authorization check** and PUBLIC/anon EXECUTE → any user (any tenant, even anon) could inject employees into any company. `hr_activate_draft_employee` had a **9-arg overload with no tenant check** (only `role='hr'`) → an HR of company A could activate/modify an employee in company B.
**Evidence:** live function bodies + ACLs on production (parent `rq3qmu8y`). Neither RPC is called by current app code (it uses `create_employee_transaction`), so the fix was non-breaking.
**Fix applied (production):** added internal authz (caller must be authenticated HR of the target tenant), pinned `search_path=public`, revoked `anon`/`public` EXECUTE on all overloads. Migration: `system-audit-2026-08/fixes/20260812_entrypoint_hardening.sql` (applied via `db migrations up`; `db query` blocks `CREATE FUNCTION`). Verified: both functions now `has_authz=true`, `anon_can_exec=false`. **Still to apply to the branch backend.**

## 🟡 S7 — Dev/test artifacts in production (LOW) — CONFIRMED
`test_log`, `test_mcp_sync` tables and the `exec_sql`/`query_json` helpers are development scaffolding present in prod. Remove them (covered by S1/S3 fixes). Also de-duplicate the redundant function overloads noted in `02` §5.

---

## Things that are done RIGHT (so they don't get "fixed" away)
- ✅ Tenant isolation derives from JWT via `get_auth_tenant_id()` / `can_access_tenant()` (`SECURITY DEFINER`, `search_path=''`) — **not** from client-supplied tenant_id. Restrictive tenant policies backstop every permissive one on the RLS-on tables.
- ✅ Leave & attendance-correction workflows are transactional with row locks and status re-checks.
- ✅ Payslip writes are HR-only; reads are owner/HR-scoped.
- ✅ Chat RLS correctly enforces sender identity + channel membership.
- ✅ `set_employee_password_by_hr` validates actor role + tenant before touching `auth.users`.
- ✅ `.env` is gitignored and untracked; edge functions read keys from environment, no hardcoded secrets.
