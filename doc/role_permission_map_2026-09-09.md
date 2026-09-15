# TalentMesh — role, workflow and permission map

**Date:** 2026-09-09. **Every statement below is read from the live parent backend `rq3qmu8y` or
current `src/`**, not from earlier documents. Where the live system differs from the docs, the live
system is what is written here.

Two things are described, kept strictly separate:

- **§1–§5 — what exists TODAY.** Descriptive. This is your starting point.
- **§6 — what it should become.** The target, and which parts are already half-built.

---

## 1. The two levels of identity

```
  PLATFORM  (TalentMesh — you)
      └── platform_admins            role: owner | support_admin | billing_admin
                                     resolved by is_superadmin() / get_my_platform_role()
                                     LIVE: 1 active admin, role = owner

  TENANT    (your customer, e.g. ABC Technologies)
      └── auth.users.metadata        { role: 'hr' | 'employee', tenant_id: <uuid> }
              └── employees          the HR record (tenant_id, user_id, manager_id, org_unit_id …)
                      └── employee_roles   scoped grants — see §4
                                           LIVE: 3 rows, all role='owner', scope='tenant'
```

The two levels never mix. A platform admin is **not** a member of any tenant, holds no `employees`
row, and — this is the important part, and it is better than the docs claim — has **no database
grant on tenant content**. See §5.2.

---

## 2. The creation chain — platform admin → tenant → HR admin → employee

Verified end to end. Each arrow is a real, guarded step.

### Step 1 — a platform admin exists

A row in `platform_admins` (`user_id`, `role`, `is_active`). Two resolvers read it:

| Function | Returns | Rule |
|---|---|---|
| `is_superadmin()` | boolean | `is_active = true` AND `role IN ('owner','support_admin','billing_admin')` |
| `get_my_platform_role()` | the role text | `is_active = true`, first match |

There is no self-service path into this table — it is seeded directly. Correct.

### Step 2 — the platform admin creates the tenant

`AddCompany.tsx` inserts into `tenants`, guarded in the **database** by
`tenants_superadmin_insert`. Not a UI check.

⚠️ An `INSERT` trigger then fires `seed_tenant_modules()`, which inserts **every** row from
`modules` with `enabled = true`. **Live: all 13 modules are on for every new tenant** — including
`payroll`, which is unfinished. This is the single biggest contradiction of the composable-module
model. See `product_direction_review_2026-09-09.md` §2A.1 / §6.1.

### Step 3 — the platform admin provisions the first HR admin

Calls the `create-hr-admin-user` edge function (deployed only — **no local source in `functions/`**;
fetch with `functions code` before editing). It does, in order:

1. `get_my_platform_role()` — if null, **403**. So only a platform admin may provision.
2. Reads the tenant, requires exactly one row, and **rejects `suspended` / `cancelled`**.
3. Creates the auth user with `metadata: { role: 'hr', tenant_id }`.
4. Calls `set_hr_user_metadata` to write that metadata authoritatively.

⚠️ `temp_password` is passed **in from the caller** — you generate and see the customer's admin
password. This is the invite-flow problem (review §4).

⚠️ Steps 3 and 4 are separate operations with no transaction. A failure between them leaves a
half-provisioned account.

### Step 4 — the HR admin logs in

Their JWT carries `metadata.role = 'hr'` and `metadata.tenant_id`. Everything downstream reads those
two values:

- `get_auth_tenant_id()` → `metadata->>'tenant_id'`. **This is the tenancy authority.**
- `is_hr()` → true via its metadata branch.

### Step 5 — the HR admin creates employees

`create-employee-user` → `verify-employee-code` → `set-employee-password` → `finalize-onboarding`.
The first requires `callerRole === 'hr'` **and** `callerTenant === tenantId`, else 403.

Employees get `metadata: { role: 'employee', tenant_id }` plus an `employees` row.

---

## 3. The roles that actually exist today

| Role | Where it lives | How it is proved | Live count |
|---|---|---|---|
| **Platform admin** | `platform_admins.role` | `is_superadmin()` | 1 (owner) |
| **HR** | `auth.users.metadata.role = 'hr'` | `is_hr()` branch 1 | the tenant's admins |
| **HR (delegated)** | `employee_roles.role = 'hr_admin'` | `is_hr()` branch 2 | **0 rows** |
| **Employee** | `metadata.role = 'employee'` | absence of the above | 23 |
| **Manager** | ❗ **not a role** — derived from data | `is_manager_of()` | derived |
| **owner / payroll_admin** | `employee_roles` | only `can_view_employee()` reads them | 3 owner, 0 payroll |

**The frontend only knows three:** `src/types/index.ts:1` — `"hr" | "employee" | "superadmin"`.

### 3.1 Manager is derived, not assigned — and the DB is right while the UI is wrong

`is_manager_of(p_employee_id)` resolves **three** sources, plus two safety rules:

```
target.manager_id = me.id
  OR target.secondary_manager_id = me.id
  OR an active, effective-dated row in employee_reporting_relationships
     (effective_from <= today <= effective_to)
AND me.tenant_id = target.tenant_id     -- defence in depth
AND me.id <> target.id                  -- a self-reference never grants scope
```

That is a genuinely good contract and it already answers the "which source controls team scope?"
question raised in the validation doc — **the database decided, and it decided correctly.**

⚠️ **The frontend disagrees.** `AuthContext.tsx:151` computes `isManager` by counting
`employees.manager_id = me.id` **only**. So a secondary manager, or an effective-dated manager, can
read their reports in SQL but **never sees the Team view**. Same failure shape as `is_hr()`: the
authority exists in the DB and each client re-implements it, worse.

---

## 4. Scoped grants — the RBAC layer that exists but is asleep

`employee_roles` — one row = "this employee holds this role over this scope".

| Column | Allowed values |
|---|---|
| `role` | `hr_admin`, `payroll_admin`, `manager`, `employee`, `owner` |
| `scope_type` | `self`, `direct_reports`, `org_unit`, `tenant` |
| `scope_id` | required when `scope_type = 'org_unit'` (FK → `org_units`) |
| `is_active` | grants are revoked by flag, not deletion |

A CHECK constraint enforces that a scoped grant actually carries its scope.

**Who reads it — only two functions:**

- `is_hr()` — any active `hr_admin` row (ignores scope).
- `can_view_employee(p_employee_id)` — the real resolver:

```
self
  OR is_hr()
  OR is_manager_of(target)
  OR an active grant where role IN ('manager','hr_admin','payroll_admin')
     AND ( scope_type = 'tenant'
           OR (scope_type = 'org_unit' AND target.org_unit_id = scope_id) )
```

**Who writes it — nothing.** ✅ Verified: zero code in `src/` or `functions/` inserts into
`employee_roles`. The only two references are comments. The 3 live rows were seeded by migration.

> **This is the most important fact in this document.** The scoping machinery — model, constraints,
> resolver — is **built and correct**. What is missing is a UI to grant roles and enforcement in the
> other 79 policies. You are not missing the hard part.

---

## 5. How a permission is actually decided

### 5.1 The layers, in the order Postgres applies them

Using `employees` as the worked example (7 policies, live):

```
1. RESTRICTIVE  tenant_active_restrictive  ALL
       can_access_tenant(row.tenant_id)
       = is_superadmin()  OR  (row.tenant_id = get_auth_tenant_id() AND tenant_is_active(...))
   ── This is the tenant fence. It also silently enforces "suspended tenant = no access".
   ── A RESTRICTIVE policy can only ever REMOVE access. It grants nothing on its own.

2. PERMISSIVE — at least one must pass:
       employees_hr_all                     ALL     is_hr()
       employees_self_select                SELECT  user_id = auth.uid()
       employees_self_update                UPDATE  user_id = auth.uid()
       managers_can_view_own_draft_reports  SELECT  manager_id = get_my_employee_id()
       managers_can_create_draft_reports    INSERT
       managers_can_delete_own_draft_reports DELETE (inactive, unlinked, own report)
```

**Both must hold.** Note that `employees_hr_all` carries **no tenant test of its own** — the fence
comes entirely from the restrictive policy. That is why the restrictive layer must never be dropped
or made permissive. (See memory `rls-permissive-is-a-grant`.)

System-wide: **80 policies across 68 tables call `is_hr()`**, and **22 SECURITY DEFINER functions**
do. That is the blast radius of any change to what "HR" means.

### 5.2 What a platform admin can actually reach — narrower than the docs say

`can_access_tenant()` returns true for a platform admin on **every** tenant. But that only satisfies
the RESTRICTIVE gate — they still need a PERMISSIVE grant, and ✅ **live, there are only 9 policies
in the entire database that grant on platform role:**

| Table | Access |
|---|---|
| `tenants` | SELECT / INSERT / UPDATE / DELETE |
| `tenant_modules` | ALL |
| `platform_admins` | ALL (owner only) |
| `platform_audit_logs` | SELECT |
| `audit_logs` | SELECT (all tenants) |

**There is no policy granting a platform admin access to `employees`, `payroll_runs`, `payslips`,
`salary_structures`, `attendance`, `leaves`, or `chat_messages`.** So although the UI lets a platform
admin open any tenant's portal (`TenantContext:159` exempts them from the wrong-tenant guard), the
database returns **nothing** for that tenant's operational data. The portal opens; the data does not.

That is a better posture than the target-state FRD assumed, and worth protecting deliberately rather
than by accident. Two caveats:

- ⚠️ `audit_logs` **is** readable across all tenants, and audit payloads can contain personal data.
- ⚠️ The **admin key** (`project_admin`) bypasses RLS entirely. Anyone holding it reads everything.
  That, not RLS, is the real platform-side access path — which is why key custody and rotation
  matter more here than any policy.

---

## 6. Target state — and how much of it is already there

| Concept | Recommended | Status today |
|---|---|---|
| Platform Admin | Provision/suspend tenants, plans, entitlements, audit. **No operational HR data.** | ✅ **Essentially achieved** (§5.2). Rename from `superadmin` in customer-facing text; add read-audit for tenant entry |
| Company Owner | Account ownership, billing, appoint admins | 🟡 `employee_roles.role = 'owner'` exists as a **designation with no permission plumbing** — 3 rows, nothing reads it |
| Company Admin | Users, security settings, integrations | ❌ Does not exist. Merged into HR |
| HR Admin | Employee lifecycle, policies, leave, attendance exceptions | ✅ Exists, as a **single coarse boolean** (`is_hr()`) |
| HR Executive | Limited HR operations | ❌ Not expressible — `is_hr()` is all-or-nothing |
| Payroll Admin / Approver | Prepare vs release, separated | 🟡 `payroll_admin` is an allowed role value and `can_view_employee()` honours it; **no payroll policy uses it** |
| Manager | Direct reports, approvals, no salary | ✅ **DB resolver is correct and complete** (§3.1). ❌ Frontend detection is wrong |
| Employee | Self only | ✅ Works |
| Scope (self / reports / unit / tenant) | Per grant | ✅ **Modelled, constrained, and resolved** — just unwritten |

### 6.1 The three fixes that close most of the gap

1. **`get_my_access()`** — one server-side resolver composing `is_hr()`, `get_auth_tenant_id()`,
   `get_my_platform_role()`, `is_manager_of`-style grants and `employee_roles`. Every client reads
   it instead of re-deriving. Fixes the `is_hr` split **and** the `isManager` bug in one place.
   **For rendering only — never as proof of authority.**
2. **A UI that writes `employee_roles`.** The moment HR can grant "manager over org_unit X", the
   scope machinery in `can_view_employee()` starts working with **no migration**.
3. **`has_perm()` inside payroll only** — where prepare-vs-approve is a real control. Leave the
   other 79 policies alone.

### 6.2 The order the enforcement must be read in

Any authorization decision should resolve, in this order — and every layer already exists except the
last two:

```
authenticated identity        ✅ auth.uid()
  → tenant membership         ✅ metadata.tenant_id  (⚠️ no membership row for non-employees)
  → tenant is active          ✅ tenant_is_active(), inside can_access_tenant()
  → module entitlement        ✅ tenant_modules  (⚠️ seeded all-on; ⚠️ frontend fails open)
  → role                      ✅ is_hr() / platform role  (⚠️ coarse)
  → scope over the target     ✅ can_view_employee()  (⚠️ no writer)
  → field-level sensitivity   ❌ does not exist
  → workflow state            ❌ does not exist
```

---

## 7. What I did not verify

I read policies, function definitions, deployed edge sources and frontend call sites. I did **not**
log in as each role and click through, so this describes what the rules *say*, not what a live
session *experiences*. The 29 QA cases remain unrun. `create-hr-admin-user` was read in its deployed
form only — there is no local copy to diff it against.
