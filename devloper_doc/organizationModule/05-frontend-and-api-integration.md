# 05 - Organisation Module: Frontend & API Integration

This document outlines how the React frontend interacts with the database to manage the Organisation Module. Because the system utilizes advanced PostgreSQL features (like Materialized Paths and Effective Dates), there are highly specific query patterns the frontend must follow.

---

## 1. Core React Components

The configuration of the entire module happens primarily through one central interface:
- **`src/hr/OrgStructureManagement.tsx`**: The main HR Admin panel. It controls 6 tabs (Org Units, Unit Types, Job Titles, Grades, Locations, Employment Types).
- **`src/hr/EmployeeDetail.tsx`**: Where individual employee data is managed, including handling their effective-dated unit transfers.

**TypeScript Types:**
All strict types (e.g., `OrgUnit`, `EmployeeGrade`, `JobTitle`) are centrally exported from `src/types.ts`.

---

## 2. The RLS "Silent Failure" Trap (Critical Gotcha)

When writing data using the InsForge SDK, developers **must** use the `rowsOrThrow` pattern.

If Row Level Security (RLS) denies an `INSERT` or `UPDATE` (e.g., trying to edit a unit in a different tenant), PostgREST does **not** throw an HTTP 403 or 500 error. It simply returns a 200 OK with `0` rows affected. 

If you do not check the row count, your UI will display a success message even though the database rejected the write.

**How to handle it:**
```typescript
// 1. You MUST chain `.select()` to the end of your mutation
const result = await db.from("org_units")
  .update(payload)
  .eq("id", id)
  .select();

// 2. You MUST check that rows were actually returned
const savedRows = rowsOrThrow(result, "Write was rejected by RLS.");
```

*(You can find the `rowsOrThrow` utility function at the top of `OrgStructureManagement.tsx`)*.

---

## 3. Querying the "Two Trees" (SDK Usage)

### A. Materialized Paths (Querying Sub-trees)
Because `org_units` uses a materialized `path` column (e.g., `/div-1/dept-3/team-9/`), you do not need recursive logic or multiple API calls to fetch an entire division.

To get all units under a specific division, use the `.like()` operator:
```typescript
const divisionId = 'div-1';
const { data: subUnits } = await db
  .from('org_units')
  .select('*')
  .like('path', `%${divisionId}%`); // Matches the ID anywhere in the path
```

### B. Effective-Dated Queries
The `employee_unit_assignments` and `employee_reporting_relationships` tables keep historical records. 

If you query them without a filter, you will get an employee's entire transfer history. To fetch only the **currently active** assignment, you must filter where `effective_to` is null:
```typescript
const { data: currentAssignment } = await db
  .from('employee_unit_assignments')
  .select('*')
  .eq('employee_id', empId)
  .is('effective_to', null)  // CRITICAL: Filters out historical rows
  .single();
```

---

## 4. Writing Data (Strict DB Guardrails)

The database physically prevents direct overwrites to an employee's active unit pointer if a unit assignment exists.

**WRONG (Will throw a Postgres Error):**
```typescript
// Fails: "Direct change of employees.org_unit_id is not allowed..."
await db.from('employees').update({ org_unit_id: newUnitId }).eq('id', empId);
```

**RIGHT:**
To transfer an employee, you must insert a new record into `employee_unit_assignments`. A database trigger will automatically cap the `effective_to` of the old record and sync the pointer on the `employees` table.
```typescript
await db.from('employee_unit_assignments').insert([{
  tenant_id: tenantId,
  employee_id: empId,
  org_unit_id: newUnitId,
  effective_from: new Date().toISOString().split('T')[0], // YYYY-MM-DD
  reason: 'Transferred to Backend Team'
}]);
```

---

## 5. Rendering the Hierarchy (Tree Logic)
When fetching `org_units` from the database, they arrive as a flat array. The frontend uses a custom algorithm to convert this into an indented tree.

If you are building a new component that needs to render the org tree, use the established `sortHierarchically` function (found in `OrgStructureManagement.tsx`):

1. **`sortHierarchically(units)`**: Groups the flat array by `parent_id` and recursively flattens it so that children always appear immediately after their parent.
2. **`getOrgUnitDepth(unit, allUnits)`**: Walks up the `parent_id` chain to calculate how many levels deep the unit is, allowing you to easily apply dynamic padding (e.g., `paddingLeft: ${depth * 1.5}rem`).
