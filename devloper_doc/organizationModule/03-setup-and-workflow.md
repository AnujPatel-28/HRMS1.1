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

Some guardrails are enforced by the **database** and cannot be bypassed. Others are only a **UI confirmation** and *can* be bypassed by any direct API call. The difference matters enormously when you write a new code path, so it is spelled out here.

| User Action | Enforced by | What actually happens |
|---|---|---|
| **Directly overwrite `employees.org_unit_id`** | **Database trigger** (`employees_org_unit_assignment_guard`) | **Rejected.** You are forced to write to `employee_unit_assignments`, which keeps effective-dated history. |
| **Change a unit's parent** | **Database trigger** (`org_units_path_guard`, `org_units_resync_paths`) | **Allowed.** The materialized `path` is recomputed for the whole subtree automatically. |
| **Change a unit type's `structural_role` after use** | **Database trigger** (`guard_org_unit_type_structural_role`) | **Rejected.** |
| **Reporting cycle (A reports to B, B reports to A)** | **RPC only** — `update_employee_reporting_relationship()` | Rejected **if you go through the RPC**. ⚠️ There is **no trigger** on `employee_reporting_relationships`, so a direct table write is *not* checked. Always use the RPC. |
| **Archive a unit / grade / title that is still in use** | **Frontend only** (`window.confirm`) | ⚠️ **Not blocked.** The UI warns *"referenced by N active employee(s)… existing records will remain unchanged"* and archives anyway if HR agrees. There is **no database guard at all** — a direct API call archives silently. |

> **Do not read the last two rows as "the database protects me".** It does not. If you build a new screen or script that touches reporting lines or archives org entities, you must re-implement those checks yourself — or better, route through the RPC.

### Why archiving is a warning and not a block
Archiving is deliberately *soft*: it hides an entity from future selection lists while leaving existing employee records untouched. Blocking it would strand tenants who reorganise faster than they can reassign people. The risk is not the soft behaviour — it is assuming a hard guarantee that was never implemented.

---

## 3. Resolving the "HR" Identity

When workflows (like task notifications or leave approvals) need to route to "HR", they do not look at an employee's structural department. 

Instead, HR privileges are strictly resolved using:
- **`tenant_hr_employee_ids()` / `employee_is_hr()`**: These database functions securely fetch whoever holds the HR role.
- For session context, the system relies on the **Auth JWT** (`metadata.role = 'hr'`). 
- Elevated platform grants (like `owner` or `payroll_admin`) are resolved through the **`employee_roles`** table.
