# 01 — Architecture

## 1. High-level shape

```
                    ┌──────────────────────────────────────────────┐
   Browser (SPA)    │  React 19 + Vite 8 + TS + React Router 6      │
                    │  Tailwind, Leaflet, html2pdf, papaparse       │
                    │                                              │
                    │  src/insforge/client.ts  ── single client ── │
                    └───────────────┬──────────────────────────────┘
                                    │  HTTPS (anon key in bundle) + user JWT
                                    ▼
        ┌──────────────────────────────────────────────────────────┐
        │                     InsForge (BaaS)                       │
        │                                                          │
        │  Auth (GoTrue-like)   PostgREST-style REST + RPC          │
        │  Object Storage       Deno Edge Functions                 │
        │                                                          │
        │  ┌────────────────────────────────────────────────────┐  │
        │  │  PostgreSQL — 57 public tables, RLS + SECURITY      │  │
        │  │  DEFINER RPCs, triggers, pg_cron-style jobs         │  │
        │  └────────────────────────────────────────────────────┘  │
        └──────────────────────────────────────────────────────────┘
```

- **One SPA, three role-scoped route trees** (`src/App.tsx`): `/admin/*` (superadmin), `/hr/*` + `/payroll/*` (HR), `/employee/*` + `/payroll/employee/*` (employee). Route guards `RequireRole`, `RequireSuperAdmin`, `RequireAuthTenant` are **client-side only** — real enforcement is (and must be) in RLS/RPC.
- **Single Postgres, shared-schema multi-tenancy.** Every business table carries `tenant_id`; isolation is enforced by RLS policies keyed on `get_auth_tenant_id()`.

## 2. Client → backend access layer (`src/insforge/client.ts`)

Three wrappers sit on top of the raw InsForge SDK:

1. `getCurrentTenantId()` / `getQueryFilter()` — resolves tenant from a **Vite env var** (`VITE_DEFAULT_TENANT_ID`) or `setCurrentTenantId()`. This is a **UX/convenience filter only** — it is browser-controlled and must never be the security boundary. ✅ It isn't: RLS derives tenant from the JWT independently.
2. `withTenantMetadata(body)` — stamps `tenant_id` into insert bodies. Again convenience; the DB re-derives/enforces tenant server-side.
3. `db.rpc` override — auto-retries once on expired-JWT (`invalid token`/`jwt`/401) after `auth.getCurrentUser()`. Reasonable resilience touch.

**Assessment:** The client-side tenant plumbing is fine *because* the server does not trust it. The one thing to keep verifying on every new table: the matching RLS policy must derive `tenant_id` from `get_auth_tenant_id()`, not from the row's supplied value alone.

## 3. Identity & tenant resolution (`src/contexts/AuthContext.tsx`)

- Role resolved in priority order: platform role via `get_my_platform_role()` RPC → JWT `metadata.role` → `profile.role` → fallback lookup in `employees` table.
- Tenant resolved from `metadata.tenant_id` / `profile.tenant_id`, fallback to `employees.tenant_id`.
- Login-time and session-time **guards** block `draft` / `pending_hr_review` / `pending_onboarding` employees, and sign out users whose tenant is `suspended`/`cancelled`. This is good defense-in-depth — **but it is client-side**; the DB-side equivalent is `can_access_tenant()` + `tenant_is_active()` used inside RLS, which is the real gate.

## 4. Server-side logic model

Two complementary patterns:

- **Direct table CRUD through RLS** — used for reads and simple self-service writes (attendance self-insert, leave self-read, expenses self-insert, notifications, chat). Each guarded by permissive self/HR policies + restrictive tenant-isolation policies.
- **`SECURITY DEFINER` RPCs for privileged / multi-row / transactional work** — leave approval, attendance corrections, shift changes, employee creation/activation, exit clearance, payroll-adjacent ops. This is the **correct** pattern: it centralizes invariants and locking in the DB. 63 of ~69 app functions are `SECURITY DEFINER`.

The design intent is right. The failures (see `04`) are in **which principals were granted EXECUTE**, a handful of **RLS toggles left off**, and a few **functions missing internal auth checks** — not in the architecture itself.

## 5. Background automation

Trigger/cron-style functions exist and are wired: `fn_accrue_monthly_leaves`, `fn_check_insurance_expiries`, `close_stale_attendance`, `fn_auto_close_active_break`, `fn_auto_redmark_tasks`, `expire_location_exceptions`, `fn_cleanup_expired_onboarding`, plus notify triggers for chat/notifications. Edge functions cover async side-effects (birthday posts, late-mark calc, onboarding finalize, task lifecycle notifications, password set). Healthy separation of concerns.

## 6. Deployment

- Vercel SPA (`vercel.json` rewrites all routes to `index.html`).
- Frontend secrets are `VITE_`-prefixed and **public by design** (anon key ships in the bundle). This is expected for a BaaS SPA — which is exactly why the `anon` role must never hold dangerous grants (S1/S2/S3).
