# 04 - Organisation Module: Security & RLS (Row Level Security)

Security in the Organisation Module operates at the database level. Instead of relying on application-layer checks to prevent data leaks, the system relies strictly on PostgreSQL Row Level Security (RLS) policies.

---

## 1. Tenant Isolation (The RESTRICTIVE Fence)
Because this is a multi-tenant system on a shared schema, the highest risk is one tenant reading another's data.

The system enforces tenant isolation using **RESTRICTIVE** policies on every core table. Even if a PERMISSIVE policy grants broad access (like "HR can see all employees"), the RESTRICTIVE fence will silently filter the query down to `tenant_id = get_auth_tenant_id()`. 

**Golden Rule:** An employee can *never* query or interact with data belonging to a different tenant, because the database refuses to load it into their session.

---

## 2. Resolving Identity & Roles
The system previously had three conflicting sources of truth for an employee's role. It has been reduced to **two distinct sources**, doing different jobs:

### A. Session Identity (JWT Metadata)
- **Answers:** *"Is the current active session an HR admin, and which tenant do they belong to?"*
- **Stored in:** `auth.users.metadata` (managed by InsForge Auth).
- **Used for:** Quick frontend checks and basic RLS routing (e.g., `is_hr()`).

### B. Elevated Grants (`employee_roles` table)
- **Answers:** *"Which specific employees hold elevated operational grants?"*
- **Stored in:** The `employee_roles` database table.
- **Used for:** Roles that a standard JWT cannot carry efficiently, specifically:
  - `owner` (exactly one active owner per tenant, seeded during provisioning).
  - Scoped `manager` or `payroll_admin` grants.
- **Why?** A regular employee cannot query `employee_roles` for anyone but themselves. When the system needs to fan-out notifications to "all HR admins," it uses secure database RPCs like `tenant_hr_employee_ids()` or `employee_is_hr()` which bypass RLS to securely resolve the list.

> [!WARNING]
> There is **no** `hr_admin` backfill in `employee_roles`. HR identity is solely derived from the Auth JWT. Copying the HR role into `employee_roles` would recreate the exact drift and duplication this architecture was designed to eliminate.

---

## 3. Policy Scoping (`include_descendants`)
When HR applies a policy or creates a document, they can scope it to a specific `org_unit_id` (e.g., "Engineering").

However, an exact match would mean employees in sub-units (e.g., "Backend Team") wouldn't see it.
- **The Solution:** Tables like `hr_policies` have an `include_descendants` boolean toggle (defaulting to `true`).
- **How it works:** Under the hood, RLS policies use a fast `LIKE` prefix scan against the `org_units.path` column. If a policy targets `/div-1/` and includes descendants, anyone in `/div-1/dept-3/team-9/` automatically gains access.

---

## 4. Public Views & `security_invoker`
Certain views (like `employee_directory_public`) must be accessible.
- They are defended by `security_invoker = true`.
- This means even if `anon` is granted `SELECT` or `UPDATE` on the view, the database evaluates the query using the privileges of the underlying tables (`employees`). If the caller has no active session or fails the RESTRICTIVE tenant fence, they see zero rows.
