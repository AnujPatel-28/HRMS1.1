# Organisation Module — Developer Documentation

**The foundation module.** Every other module joins to this one — attendance needs shifts per location, leave needs grades for policy defaults, the approval engine needs unit heads, payroll needs effective-dated grades.

| Doc | Read it when |
|---|---|
| [01 - Overview & Concepts](01-overview-and-concepts.md) | **Always first.** The "two trees" idea and independent dimensions. |
| [02 - Database Schema & ER](02-database-schema-and-er.md) | You need to know which table holds what. |
| [03 - Setup & Workflow](03-setup-and-workflow.md) | You are configuring a tenant. **§2 tells you which guardrails are real and which are only UI.** |
| [04 - Security & RLS](04-security-and-rls.md) | You are touching any write path. |
| [05 - Frontend & API Integration](05-frontend-and-api-integration.md) | You are building UI or querying the trees. |
| [06 - Common Queries Cheatsheet](06-common-queries-cheatsheet.md) | You need a working snippet right now. |
| [07 - Edge Functions & Onboarding](07-edge-functions-and-onboarding.md) | You are creating employees or touching login accounts. |

---

## The 60-second version

An employee is described by **independent dimensions** that must not be conflated:

```text
Belongs to:  Backend Team        ← ORG TREE       (org_units.parent_id)
Reports to:  Priya               ← REPORTING TREE (employee_reporting_relationships)
Job title:   Backend Engineer    ← what they do
Grade:       L3                  ← where defaults hang
Location:    Ahmedabad Office    ← where they sit
```

**Two separate trees**, because matrix organisations are real: you can sit in one team while reporting to someone outside it. A single tree cannot express that.

Three things to remember on day one:

1. **Never write `employees.org_unit_id` directly.** A database trigger rejects it. Insert into `employee_unit_assignments` and the trigger syncs the pointer, preserving history.
2. **Always filter `effective_to IS NULL`** when reading assignments or reporting lines, or you get the full history.
3. **RLS denial does not throw.** PostgREST returns `200 OK` with zero rows. Use `rowsOrThrow` or your UI will report success on a rejected write.

---

## ⚠️ Guardrails: real vs assumed

The single most dangerous assumption in this module. See `03` §2 for the full table.

| Guaranteed by the database | Only a UI confirmation |
|---|---|
| Direct `org_unit_id` overwrite → rejected | Archiving a unit/grade/title still in use → **warns, then proceeds** |
| Unit re-parenting → path resynced automatically | |
| Unit type `structural_role` change after use → rejected | |
| | Reporting cycles → checked **only inside the RPC**, not by a trigger |

If you write a new script or screen that bypasses the RPC or the UI, **those last two protect nothing.**

---

## Where things live

```text
migrations/                          schema, triggers and server functions
functions/create-employee-user.ts    creates the auth account
functions/verify-employee-code.ts    onboarding code check
functions/set-employee-password.ts   HR password reset
functions/finalize-onboarding.ts     marks onboarding complete
src/hr/OrgStructureManagement.tsx    the main HR admin panel (6 tabs)
src/hr/EmployeeCreate.tsx            employee creation + onboarding flow
src/hr/EmployeeDetail.tsx            per-employee edits, transfers
src/types/index.ts                   OrgUnit, EmployeeGrade, JobTitle, …
src/hooks/useAuth.ts                 useAuth() → { role, tenantId, … }
```

## Related

- `devloper_doc/attendanceModule/` — the attendance module, which builds directly on shifts, locations and employees defined here.
