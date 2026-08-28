# 03 - Organisation Module: Setup & Workflow

This document outlines the strict sequence in which an HR Administrator must configure the organisation. Because the Organisation Module acts as the foundation for the entire HRMS, the setup order matters. Each step depends on the entities created in the previous step.

---

## 1. The Configuration Workflow

The HR Administrator configures the system primarily through the UI (managed in components like `OrgStructureManagement.tsx`). The workflow follows a strict 7-step sequence:

1. **Work Locations** (`locations`)
   - **What happens:** HR defines the offices/branches and their timezones.
   - **Why first?** Employees need to be assigned to a location when hired.

2. **Unit Types** (`org_unit_types`)
   - **What happens:** HR can rename the structural levels (e.g., calling them "Practices" or "Chapters").
   - **Pre-seeded:** This step is technically optional as the system pre-seeds `Division`, `Department`, and `Team`. 
   - **Constraint:** HR can rename them, but cannot change their underlying `structural_role` once units are assigned.

3. **Org Units** (`org_units`)
   - **What happens:** HR builds the actual organisational tree (e.g., Engineering Division -> Backend Department). They also assign the **Unit Heads**.
   - **Dependencies:** Relies on `org_unit_types`.

4. **Grades** (`employee_grades`)
   - **What happens:** HR sets up the bands (e.g., L3, Senior, Manager) and configures defaults like notice periods and probation months.

5. **Job Titles** (`job_titles`)
   - **What happens:** HR creates designations (e.g., "Senior Backend Engineer").
   - **Dependencies:** Each title can optionally specify a `default_grade_id` from step 4 to speed up employee creation.

6. **Employment Types** (`employment_types`)
   - **What happens:** Defining contract forms (e.g., Full-time, Contract, Intern).

7. **Employees** (`employees`)
   - **What happens:** The final step. When an employee is created, they are assigned to a **Location** (1), an **Org Unit** (3), a **Grade** (4), and a **Job Title** (5).
   - **Reporting Manager:** A manager is also assigned here, writing to `employee_reporting_relationships`.

---

## 2. Guardrails & Data Integrity

The module has strict guardrails enforced directly in the database (verified via migrations and database constraints) to ensure the hierarchy doesn't break:

| User Action | System Enforcement |
|---|---|
| **Deactivate a unit with employees** | **Blocked.** HR must reassign employees first before deleting or deactivating a unit. |
| **Deactivate a unit with children** | **Blocked.** This prevents entire sub-trees of the organisation from being accidentally orphaned. |
| **Change a unit's parent** | **Allowed.** Employees move with the unit, and the materialized `path` is dynamically recomputed for the entire subtree. |
| **Reporting cycle (A reports to B, B reports to A)** | **Rejected.** A database trigger explicitly prevents circular reporting lines. |
| **Directly overwrite an employee's Unit** | **Rejected.** Database constraints force the application to write to `employee_unit_assignments` instead, automatically keeping effective-dated history. |

---

## 3. Resolving the "HR" Identity

When workflows (like task notifications or leave approvals) need to route to "HR", they do not look at an employee's structural department. 

Instead, HR privileges are strictly resolved using:
- **`tenant_hr_employee_ids()` / `employee_is_hr()`**: These database functions securely fetch whoever holds the HR role.
- For session context, the system relies on the **Auth JWT** (`metadata.role = 'hr'`). 
- Elevated platform grants (like `owner` or `payroll_admin`) are resolved through the **`employee_roles`** table.
