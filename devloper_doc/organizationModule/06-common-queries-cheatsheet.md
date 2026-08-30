# 06 - Organisation Module: Common Queries Cheatsheet

Because the Organisation Module uses a "Two Trees" architecture (the Structural Tree and the Reporting Tree) combined with effective-dated history, writing queries requires specific patterns.

This cheatsheet provides the exact InsForge SDK (TypeScript) snippets for the most common operations developers need.

---

## 1. The Reporting Tree (Line Management)

The Reporting Tree is managed in the `employee_reporting_relationships` table. It tracks who manages whom, independent of which department they sit in.

### A. Get the Manager of an Employee
You must ensure you are only fetching the *currently active* manager by checking `effective_to IS NULL`.

```typescript
const { data, error } = await db
  .from('employee_reporting_relationships')
  .select(`
    manager:manager_id (
      id,
      full_name,
      email
    )
  `)
  .eq('employee_id', targetEmployeeId)
  .is('effective_to', null)
  .single();

const manager = data?.manager;
```

### B. Get All Direct Reports of a Manager
To find everyone currently reporting to a specific manager.

```typescript
const { data: directReports, error } = await db
  .from('employee_reporting_relationships')
  .select(`
    employee:employee_id (
      id,
      full_name,
      job_title_id
    )
  `)
  .eq('manager_id', targetManagerId)
  .is('effective_to', null);
```

---

## 2. The Structural Tree (Departments & Teams)

The Structural Tree is built using `org_units`. It uses a **Materialized Path** column (`path`) so you can query deep hierarchies without recursive SQL CTEs.

### A. Get the Active Unit for an Employee
An employee's unit history is tracked in `employee_unit_assignments`. The current active unit is the one without an end date.

```typescript
const { data, error } = await db
  .from('employee_unit_assignments')
  .select(`
    org_unit:org_unit_id (
      id,
      name,
      code,
      path
    )
  `)
  .eq('employee_id', targetEmployeeId)
  .is('effective_to', null)
  .single();

const currentUnit = data?.org_unit;
```

### B. Get All Employees in ONE Specific Unit (No Sub-units)
If you want exactly the people assigned to the "Backend Team", and not people in child teams.

```typescript
const { data: employees, error } = await db
  .from('employees')
  .select('id, full_name, status')
  .eq('org_unit_id', targetUnitId)
  .eq('status', 'active');
```

### C. Get All Employees in a Unit AND All Its Sub-units (Deep Scan)
If you want everyone in the "Engineering Division", including all teams underneath it.
*Note: This takes two steps in the client SDK. First, find the path of the parent unit, then query employees whose active unit matches that path.*

```typescript
// 1. Get the path of the parent unit
const { data: parentUnit } = await db
  .from('org_units')
  .select('path')
  .eq('id', divisionId)
  .single();

// 2. Find all active units that start with this path (including the parent itself)
const { data: subUnits } = await db
  .from('org_units')
  .select('id')
  .like('path', `${parentUnit.path}%`);
  
const unitIds = subUnits.map(u => u.id);

// 3. Get the employees
const { data: employees } = await db
  .from('employees')
  .select('id, full_name, job_title_id')
  .in('org_unit_id', unitIds)
  .eq('status', 'active');
```

---

## 3. Resolving HR Privileges

Do not query the structural tree to find out if someone is "HR". HR privileges are granted via JWT or the `employee_roles` table.

### A. Check if Current Session is HR (Frontend)
The fastest way to check if the logged-in user is HR is to inspect their JWT metadata.

```typescript
import { useAuth } from '../hooks/useAuth';

// Inside a React component:
const { role, tenantId } = useAuth();
const isHr = role === 'hr';
```

> **Do not reach into the JWT yourself.** `AuthContext` already derives the role
> (`user.metadata?.role ?? user.profile?.role`) and normalises it, so `role` is the single place
> to read it. Supabase-style shapes like `session.user.user_metadata` do **not** exist here —
> this is the InsForge SDK.

### B. Get a List of All HR Admins (For Notifications)
If you need to send an in-app notification to all HR admins, use the secure backend RPC function. It bypasses RLS to safely return the list of IDs.

```typescript
const { data: hrAdminIds, error } = await db
  .rpc('tenant_hr_employee_ids');
  
// hrAdminIds is an array of UUID strings
```
