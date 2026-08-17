# TalentMesh HRMS — Independent System Audit

**Date:** 2026-08-12
**Auditor role:** Senior system-design / security architect
**Method:** Derived **only** from source code and the **live production database** (project `HRMS`, appkey `rq3qmu8y`). The existing `.md` documentation in the repo was **not** used as a source of truth — findings below are verified against live `pg_policies`, `pg_proc`, grants, storage buckets, and the actual React/SQL code.

> ⚠️ This is an internal security assessment. Keep it in the repo only. Do **not** publish it or paste live API keys/JWT secrets anywhere.

---

## 1. What this system is

A **multi-tenant SaaS HRMS** for TalentMesh Solutions. Single React SPA, one shared Postgres database, tenant isolation enforced (mostly) by Row-Level Security. Live data today: **12 tenants, 16 employees, 20 auth profiles, 5 platform/admin users**.

**Stack:** React 19 + Vite 8 + TypeScript, React Router 6, Tailwind. Backend is **InsForge** (a Supabase-like BaaS: Postgres + PostgREST-style auto REST + RPC, GoTrue-style auth, object storage, Deno edge functions). Deployed on Vercel. Maps via Leaflet (geo-fenced attendance), payslip PDFs via html2pdf, CSV via papaparse.

**Modules present and working:** Auth/multi-tenant, Employee lifecycle (draft → onboarding → active → offboarding/clearance), Attendance (punch in/out, breaks, selfies, geo-fencing, corrections, shifts, overtime), Leave (types, balances, approval workflow), Tasks & Projects (PMS), Payroll (salary structures, run payroll, payslips, IT declarations), Expenses, Insurance, Policy Center, Chat (realtime channels), Org structure / reporting lines, Holidays/Calendar, Notifications, Super-admin console.

This is a **genuinely substantial, feature-complete HRMS** — not a toy. The domain modelling (57 tables), the transactional leave/attendance RPCs, and the RLS-per-table discipline show real engineering maturity.

---

## 2. Reliability verdict

**Functionally: strong. Security-hardening: not yet production-safe.** The architecture is sound and most of the data layer is well-built, but there are a **small number of catastrophic, live security holes** that must be closed before this can be called a reliable/trustworthy HRMS. They are all **fixable in hours, not weeks** — they are leftovers and misconfigurations, not design flaws.

| Dimension | Rating | Note |
|---|---|---|
| Data model & schema design | 🟢 Good | 57 tables, sensible normalization, tenant_id everywhere, good indexes |
| Tenant isolation (design) | 🟢 Good | JWT-derived `get_auth_tenant_id()` + RLS; **not** trusting client-supplied tenant_id |
| Tenant isolation (execution) | 🔴 Gaps | 10 tables have RLS **disabled** while granting full DML to `anon` |
| Transactional integrity (leave/attendance) | 🟢 Good | `FOR UPDATE` locks, status re-checks, balance guards |
| Server-side auth on privileged ops | 🔴 Critical | `exec_sql`, `query_json`, `update_user_password` callable by `anon` |
| Storage privacy | 🟠 Concern | `employee-documents` + `expense-receipts` buckets are **public** |
| Automated testing | 🔴 Missing | No test framework; only ad-hoc scratch scripts |
| Secrets hygiene | 🟢 OK | `.env` gitignored & untracked; functions read keys from env |

---

## 3. The findings that matter most (full detail in `04-security-findings.md`)

| # | Severity | Finding | One-line impact |
|---|---|---|---|
| S1 | 🔴 **Critical** | `public.exec_sql(text)` & `public.query_json(text)` are `SECURITY DEFINER` and `EXECUTE` is granted to **`anon`** | Anyone holding the public anon key (it ships in the JS bundle) can run **arbitrary SQL** — full read/write of every tenant, dump `auth.users`, drop tables. Total compromise. |
| S2 | 🔴 **Critical** | `public.update_user_password(uuid, text)` is `SECURITY DEFINER`, has **no authorization check**, granted to `anon` | Reset **any** user's password by user-id → full account takeover of any HR/employee/superadmin. |
| S3 | 🔴 **High** | 10 tables have **RLS disabled** but grant `SELECT/INSERT/UPDATE/DELETE` to `anon`+`authenticated` (`exit_clearances`, `exit_clearance_templates`, `org_units`, `job_titles`, `employment_types`, `locations`, `attendance_audit_logs`, `tenant_settings`, `test_log`, `test_mcp_sync`) | Cross-tenant read/write of clearance records, org structure, and tenant settings by any logged-in user; `tenant_settings` even has a policy that is **inert** because RLS is off. |
| S4 | 🟠 **Medium** | Public storage buckets `employee-documents`, `expense-receipts`, `hr-policies`, `chat-attachments` | PII (ID proofs, contracts, receipts) reachable by unauthenticated URL. |
| S5 | 🟠 **Medium** | `punch_out_attendance` (SECURITY DEFINER) takes client-supplied `p_work_hours` and has **no ownership check** inside the function | Employee can set arbitrary work hours / close another user's open session in-tenant → overtime/payroll fraud. |
| S6 | 🟡 **Low/Hardening** | 26 `SECURITY DEFINER` functions have **no fixed `search_path`** | Search-path hijack hardening gap. |
| S7 | 🟡 **Low** | Leftover `test_log`, `test_mcp_sync`, `exec_sql`, `query_json` exist in **production** | Dev artifacts shipped to prod; unused by the app. |

**S1 and S2 alone mean the current production database should be treated as compromised-until-proven-otherwise.** They are unused by the application (verified: no `exec_sql`/`query_json`/`update_user_password` call anywhere in `src/` or `functions/`), so they can be dropped immediately with zero app impact.

---

## 4. Config note — you are auditing against a paused branch

The app's `.env` (`VITE_INSFORGE_URL`) points at the **branch** project `rq3qmu8y-jx7` (`updateSuggestion`), which is currently **paused (502, inactivity)**. The **active production** backend is the parent `rq3qmu8y` (`HRMS`). This audit was run against the live parent. Confirm which backend production actually serves before shipping fixes, and apply fixes to **both** (branch inherits the same schema).

---

## 5. Do you need more tech stack?

Short answer: **mostly no — you need enforcement and tests, not new vendors.** Details in `06-recommendations.md`. The honest priorities are:
1. Close S1–S3 (SQL/grants only — no new tech).
2. Add a **test framework** (Vitest) + a **DB policy test suite** — the single biggest reliability gap.
3. Move payroll/attendance-hours math to **server-side validation** (RPC) so numbers can't be tampered client-side.
4. Add **CI** that runs lint + tests + a "no RLS-disabled table with anon grants" guard on every push.
5. Optional but worth it: error monitoring (Sentry), and rate-limiting on auth (a `rate_limits` table already exists — wire it up).

Read next: `01-architecture.md` → `02-database-and-rls.md` → `03-modules.md` → `04-security-findings.md` → `05-edge-cases.md` → `06-recommendations.md`.
