# Onboarding Lifecycle & Upgrade Documentation

This document describes the implementation architecture, database schema, security rules, and frontend workflows for the **Manager Drafts / HR Finalizes** onboarding flow.

---

## 1. Onboarding Lifecycle Overview

To support safe multi-tenant onboarding, the lifecycle utilizes an `inactive` status combined with a `null` or `uuid` value in the `user_id` field to represent different stages of an employee's profile.

```mermaid
stateDiagram-v2
    [*] --> Inactive_No_User : Manager Drafts (MyTeam Form)
    note right of Inactive_No_User
        DB State:
        status = 'inactive'
        user_id IS NULL
        App Label: 'Pending HR'
    end note
    
    Inactive_No_User --> Deleted : Manager Cancels (MyTeam Card)
    Inactive_No_User --> Deleted : HR Rejects/Deletes (Banner Action)
    
    Inactive_No_User --> Pending_Auth : HR Initiates Activation
    note right of Pending_Auth
        Auth account created (temporary password)
        6-digit OTP code sent to employee email
    end note
    
    Pending_Auth --> Active : HR Verifies OTP & Sets Password
    note right of Active
        DB State:
        status = 'active'
        user_id = auth_user_id
    end note
    
    Deleted --> [*]
    Active --> [*]
```

### State Mapping Table

| Logical Status | Database `status` | Database `user_id` | UI Badge Label | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Draft** | `inactive` | `NULL` | `Pending HR` | Profile drafted by manager. Cannot log in. Ghosted on org chart. |
| **Active** | `active` | `UUID` | `Active` | Activated by HR, credentials verified, fully active. |
| **Deactivated** | `inactive` | `UUID` | `Inactive` | Previously active employee who has been deactivated. |

---

## 2. Detailed Technical Workflows

### Employee Activation & OTP Sequence

When HR activates a drafted employee, they go through a 3-step verification wizard to prevent tenant desync or hijacking:

```mermaid
sequenceDiagram
    autonumber
    actor HR as HR Admin
    participant FE as Frontend Portal
    participant EF as Edge Function (create-employee-user)
    participant Auth as InsForge Auth Service
    participant DB as PostgreSQL Database

    HR->>FE: Fills Job Info & Clicks "Activate Employee"
    FE->>EF: Invokes function with email, employee_id, tenant_id, tempPassword
    Note over EF: Verifies caller role is HR<br/>& tenant matches
    EF->>DB: Direct SDK query to check email conflict (excludes current employee_id)
    alt Email Conflicts
        DB-->>EF: Return existing record count > 0
        EF-->>FE: Return 409 Conflict Error
        FE-->>HR: Show error message
    else No Conflicts
        DB-->>EF: Return 0 records
        EF->>Auth: Recreate/Create Auth User
        Auth-->>EF: User created & OTP code generated
        EF->>DB: Initialize onboarding state in employee_onboarding
        EF-->>FE: Return success + createdUserId
        FE->>HR: Display OTP Verification Modal
    end

    HR->>FE: Enters 6-digit OTP code
    FE->>EF: Invokes verify-employee-code
    EF-->>FE: OTP Verified successfully
    FE->>HR: Prompts to set custom Password

    HR->>FE: Submits custom Password
    FE->>EF: Invokes set-employee-password
    EF-->>FE: Password updated in Auth
    FE->>DB: Direct Table Update (status = 'active', user_id = createdUserId, job_info)
    DB-->>FE: Update success
    FE->>HR: Displays Success Modal with login credentials
```

---

## 3. Database Architecture & RLS

### PostgreSQL RLS Policies

#### 1. Manager Draft Deletion Policy
Allows managers to cancel and delete draft reports they created, limited strictly to their own tenant and reports.
```sql
CREATE POLICY managers_can_delete_own_draft_reports 
ON public.employees
FOR DELETE
USING (
  status = 'inactive' 
  AND user_id IS NULL 
  AND manager_id = (
    SELECT id FROM public.employees 
    WHERE user_id = auth.uid() 
    LIMIT 1
  ) 
  AND tenant_id = (
    SELECT tenant_id FROM public.employees 
    WHERE user_id = auth.uid() 
    LIMIT 1
  )
);
```

#### 2. HR Admin Deletion Policy
Enforced by the `employees_hr_all` policy which grants HR role full command control on the `employees` table for records within their tenant.

---

## 4. Code Implementation Map

### Edge Functions
* **[`create-employee-user`](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/functions/create-employee-user.ts):** Checks for duplicate email registration by querying the database directly (excluding the active `employee_id`), deletes orphaned accounts belonging to the same tenant, and triggers user creation.

### Frontend Components
* **[`MyTeam.tsx`](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/src/employee/MyTeam.tsx):** 
  - Renders drafts under "My Team" with a "Pending HR" badge.
  - Exposes the "Cancel Request" trash control for managers to delete reports before activation.
* **[`EmployeeDetail.tsx`](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/src/hr/EmployeeDetail.tsx):**
  - Renders "Delete Draft" next to "Activate Employee" in the activation banner.
  - Implements the OTP + Password Activation Wizard modal overlay.
  - Directly updates the database from the client upon successful activation, bypassing gateway schema caching on RPC calls.
  - Standardized Identity & Bank tab fields to standard inputs with secure `disabled={!isEditing}` state and native browser masking `type={showSensitive || isEditing ? "text" : "password"}`.
