# 02 — Module registry & per-tenant entitlement

**Phase 0b.** Blocked by Phase 0a (policy baseline) — see `README.md` §1 for why the order is forced.

> ## ✅ SHIPPED 2026-08-17
>
> | Migration | Contents |
> |---|---|
> | `20260817200000_module-registry` | `modules` (12 rows), `tenant_modules`, `tenant_has_module()`, `module_for_doc_type()`, RLS on both tables |
> | `20260817210000_enforce-module-entitlement` | One RESTRICTIVE policy per owned table — **34 tables across 11 modules** |
>
> **No behaviour change on apply.** All 12 tenants were backfilled with all 12 modules enabled
> (144 rows), so `tenant_has_module()` returns true everywhere. The migration only makes the switch
> *effective*.
>
> **Enforcement verified end to end** on the QA tenant, using a table that actually had data — a table
> that is empty either way would prove nothing:
>
> ```
> tasks rows, module ENABLED  : 1
> tasks rows, module DISABLED : 0   <- read gated
> tasks rows, RE-ENABLED      : 1   <- data never touched
>
> INSERT leave_types with module disabled -> 403
>   "new row violates row-level security policy"
> ```
>
> Other modules were unaffected while `leave` was off (`employees` 5 rows, `tasks` 1 row), confirming
> the gate is per-module rather than global. Regression suite unchanged: 7/7 dashboard queries,
> employee-qa 1 / manager-qa 5 / hr-qa 6 rows, zero cross-tenant.
>
> Live policy count went 210 → 247. Drift guard green.
>
> **Not yet built:** the frontend half — `TenantContext` loading `tenant_modules`, `hasModule(key)`,
> nav filtering, route guards, and the superadmin toggle UI. The API boundary is enforced; the UI
> still shows every module. A disabled module currently renders as empty screens rather than a hidden
> nav entry.

**Decision:** entitlement is **RLS-enforced**, not UI-gated. A module disabled for a tenant returns zero
rows to a direct API call, not just a hidden nav item.

---

## 1. What a module is

A **module** is a named slice of HRMS functionality that a tenant can be sold, and that can be switched
off without breaking anything else. It owns a set of tables, a set of routes, and a nav entry.

Modules are **HRMS-only**. No ATS concepts (see `README.md` §2). Keys are plain — `leave`, not
`hrms.leave` — because there is exactly one product in this schema.

### The registry

| key | name | core? | owns tables |
|---|---|---|---|
| `directory` | Employee Directory | ✅ core | `employees`, `org_units`, `job_titles`, `locations`, `employment_types` |
| `attendance` | Attendance & Time | | `attendance`, `attendance_breaks`, `attendance_selfies`, `attendance_corrections`, `attendance_location_exceptions`, `overtime_records`, `shifts`, `employee_shifts` |
| `leave` | Leave | | `leaves`, `leave_types`, `leave_balances`, `leave_ledger_entries`*, `holidays` |
| `payroll` | Payroll | | `salary_structures`, `payroll_runs`, `payslips`, `it_declarations`, `it_declaration_windows` |
| `tasks` | Tasks & Projects | | `tasks`, `task_submissions`, `projects` |
| `expenses` | Expenses | | `expenses` |
| `insurance` | Insurance | | `insurance_policies` |
| `policy_center` | Policy Center | | `hr_policies`, `employee_policy_acknowledgements` |
| `chat` | Chat | | `chat_channels`, `chat_channel_members`, `chat_messages` |
| `connect` | Connect Feed | | `posts`, `post_reactions` |
| `onboarding` | Onboarding | | `employee_onboarding`, `employee_onboarding_self` |
| `offboarding` | Offboarding | | `exit_requests`, `exit_clearances`, `exit_clearance_templates` |

\* introduced in Phase 1 (§03).

**Core modules cannot be disabled.** `directory` is core because every other module joins to
`employees`; disabling it would make the product inoperable rather than reduced. `notifications` and
`tenants`/auth infrastructure are not modules at all — they are platform, always present.

---

## 2. Schema

```sql
-- Catalogue of what exists. Seeded by migration, not user-editable.
CREATE TABLE public.modules (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  is_core     boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 100
);

-- Which tenant has what. Absence of a row means DISABLED.
CREATE TABLE public.tenant_modules (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES public.modules(key),
  enabled    boolean NOT NULL DEFAULT true,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  enabled_by uuid,                       -- platform admin who flipped it
  PRIMARY KEY (tenant_id, module_key)
);

CREATE INDEX tenant_modules_lookup
  ON public.tenant_modules (tenant_id, module_key) WHERE enabled;
```

**Absence means disabled**, which is the deny-by-default posture of P6. That makes the backfill
mandatory: the introducing migration inserts every module as `enabled = true` for all 12 existing
tenants, so the change is a no-op on day one. New tenants get a seeded set at creation.

Disabling a module **never deletes data**. It becomes unreadable through the API and invisible in the
UI; re-enabling restores it exactly. This matters for trials, downgrades, and non-payment.

---

## 3. Enforcement

```sql
CREATE OR REPLACE FUNCTION public.tenant_has_module(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = (SELECT public.get_auth_tenant_id())
      AND tm.module_key = p_key
      AND tm.enabled
  ) OR EXISTS (
    SELECT 1 FROM public.modules m WHERE m.key = p_key AND m.is_core
  )
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_has_module(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_has_module(text) TO authenticated;
```

`SECURITY DEFINER` per **P2** — it reads `tenant_modules`, and a policy on `tenant_modules` that called
it would otherwise recurse. Core modules short-circuit to `true` so a missing row can never lock a
tenant out of the directory.

### Applying it to a module's tables

Add the predicate as a **RESTRICTIVE** policy, one per owned table:

```sql
CREATE POLICY leave_module_enabled ON public.leaves
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('leave')))
WITH CHECK ((SELECT public.tenant_has_module('leave')));
```

Two deliberate choices:

- **RESTRICTIVE, not PERMISSIVE.** Per P6, permissive policies OR together — a permissive entitlement
  check would *widen* access, not gate it. RESTRICTIVE ANDs onto everything, which is the semantics we
  want. This mirrors how `tenant_active_restrictive` already works.
- **Wrapped in `(SELECT ...)`.** This makes Postgres evaluate it once per query as an InitPlan rather
  than once per row. The existing `tenant_active_restrictive` already uses this form; match it.

**Why this ordering matters:** adding one RESTRICTIVE policy per owned table across ~30 tables is a
mechanical, reviewable diff — *if* the existing policies are in migrations. Against the current 50%
drift it would mean reverse-engineering each table's policy set from `pg_policies` first. That is
Phase 0a, and it is why it comes first.

---

## 4. Workflow

### Superadmin enables/disables a module

```
Platform admin → /admin/tenants/:id → Modules tab
  → toggle "Payroll" off
  → UPDATE tenant_modules SET enabled = false, enabled_by = <admin>
  → write platform_audit_logs row
```

Effect, immediately and without deploy:

1. **API** — every `payroll` table returns 0 rows / rejects writes for that tenant's users, because the
   RESTRICTIVE policy now evaluates false. This holds for direct `fetch()` calls, not just the app.
2. **UI** — nav entry disappears, routes redirect. Cosmetic layer only; the API is the real boundary.
3. **Data** — untouched. Re-enabling restores everything.

Only platform superadmins may write `tenant_modules`. Tenant HR can **read** their own row (to render
nav) but never write it — otherwise a tenant grants itself modules it has not bought.

```sql
ALTER TABLE public.tenant_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_modules_self_read ON public.tenant_modules
FOR SELECT TO authenticated
USING (tenant_id = (SELECT public.get_auth_tenant_id()));

CREATE POLICY tenant_modules_platform_all ON public.tenant_modules
FOR ALL TO authenticated
USING      ((SELECT public.get_my_platform_role()) IS NOT NULL)
WITH CHECK ((SELECT public.get_my_platform_role()) IS NOT NULL);
```

`modules` itself is world-readable to `authenticated` (it is a catalogue, not tenant data) and writable
by nobody at runtime — it changes by migration only.

### Frontend

`TenantContext` loads `tenant_modules` once at session start alongside the tenant record and exposes
`hasModule(key)`. Nav config and route guards read it. One extra query per session, not per navigation.

A disabled module must fail **quietly** — redirect to dashboard, never an error toast. A tenant that did
not buy Payroll should not see "Failed to load payroll data"; that is exactly the confusing failure mode
the 2026-08-14 outage produced.

---

## 5. Scalability

Per **P7**, none of this is justified by current load — 12 tenants and 16 employees. It is designed so
the shape does not need revisiting:

| Concern | Design response |
|---|---|
| Predicate cost per query | `(SELECT ...)` wrapper → one InitPlan evaluation per query, not per row |
| Lookup cost | Partial index on `(tenant_id, module_key) WHERE enabled`; the table is at most `tenants × modules` — 144 rows today, ~12k at 1,000 tenants. It stays in cache. |
| Adding a module later | Insert one `modules` row + one RESTRICTIVE policy per owned table. No change to existing modules. |
| Per-plan bundles | Deliberately **not** built. `tenants.plan` exists but is informational. Bundles are a billing concern; add a `plan_modules` mapping when billing is real, not before. |
| Per-user feature flags | Out of scope. Entitlement is per **tenant**. Per-user capability is what `employee_roles` already does. |

---

## 6. What this does not do

- **No billing integration.** Enabling a module is a manual superadmin action. `tenants.plan` and
  `max_employees` remain informational and unenforced. There is no payments provider configured.
- **No usage metering or seat enforcement.**
- **No self-service.** Tenants cannot request or trial modules; a human flips the switch.
- **No per-module data export on disable.** Data is retained indefinitely. If a retention policy is ever
  required, it is a separate decision.
- **Does not gate edge functions.** The 17 deployed functions are not covered by RLS. Any function
  touching a gated module's tables must call `tenant_has_module()` itself. This is a real gap and the
  most likely place for the entitlement to be bypassed — it needs an explicit pass when the module
  registry lands.
