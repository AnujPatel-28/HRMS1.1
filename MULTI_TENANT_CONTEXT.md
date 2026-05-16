# TalentMesh Multi-Tenant SaaS Context

This document summarizes the multi-tenant changes made to the TalentMesh HRMS app so the context can be reused in future chats or implementation steps.

## Backend / Database Changes

### New Tables

Created two new InsForge database tables:

1. `tenants`
   - Stores company-level SaaS tenant records and configuration.
   - Important columns:
     - `id`
     - `company_name`
     - `subdomain`
     - `plan`
     - `status`
     - `timezone`
     - `punch_in_start`
     - `punch_in_cutoff`
     - `work_hours_per_day`
     - `lunch_break_minutes`
     - `punch_out_gate_enabled`
     - `max_employees`
     - `logo_url`
     - `created_at`
     - `updated_at`

2. `tenant_settings`
   - Stores extra per-company key-value settings.
   - Important columns:
     - `id`
     - `tenant_id`
     - `key`
     - `value`
     - `updated_at`
   - Unique constraint on `(tenant_id, key)`.

### First Tenant

Inserted the first tenant:

```text
Company: TalentMesh Solutions
Subdomain: talentmesh
Plan: growth
Status: active
Tenant ID: c3816de9-2222-49d0-842b-8e99613c635a
```

This ID is used in `.env` as:

```env
VITE_DEFAULT_TENANT_ID=c3816de9-2222-49d0-842b-8e99613c635a
```

### Tenant Columns Added

Added `tenant_id uuid references tenants(id)` to these existing tables:

1. `employees`
2. `attendance`
3. `leaves`
4. `holidays`
5. `hr_policies`
6. `tasks`
7. `task_submissions`
8. `calendar_events`
9. `chat_messages`
10. `notifications`

The column was added with default:

```sql
DEFAULT 'c3816de9-2222-49d0-842b-8e99613c635a' NOT NULL
```

This tagged all existing TalentMesh data to the first tenant.

### RLS

Enabled Row Level Security on tenantized tables.

Policy intent:

- Users can only read/write rows where `row.tenant_id` matches their tenant.
- Users can only select their own tenant row from `tenants`.

Existing InsForge Auth users were updated with metadata:

```json
{
  "tenant_id": "c3816de9-2222-49d0-842b-8e99613c635a"
}
```

Important finding:

- Auth user metadata contains `tenant_id`.
- But issued JWTs currently do **not** include `tenant_id`.
- **Previous Issue**: Because RLS policies checked the JWT claim directly, and the JWTs did not include `tenant_id`, frontend database reads returned empty arrays after login.
  - *Proposed Fixes*: Either configure InsForge Auth to include `tenant_id` in JWTs, or adjust RLS policies to resolve the tenant from stored auth metadata.
- **After (Fix Implemented)**: We implemented the second option based on industry-level production standards. RLS policies now use a `public.get_auth_tenant_id()` helper function. This function securely looks up the `tenant_id` directly from the `auth.users` metadata using `(SELECT auth.uid())` for optimal performance.

## Frontend Multi-Tenant Changes

### Tenant Context

Created:

```text
src/contexts/TenantContext.tsx
```

It:

- Reads `window.location.hostname`.
- Uses subdomain for production tenants.
- Uses `VITE_DEFAULT_TENANT_ID` on localhost.
- Fetches the current tenant from `tenants`.
- Exposes:
  - `tenant`
  - `tenantId`
  - `isLoading`
  - `refreshTenant`

If no tenant is found, it shows:

```text
Company not found. Please check your URL.
```

### App Provider Order

Updated `src/App.tsx` provider order:

```tsx
<TenantProvider>
  <AuthProvider>
    <ToastProvider>
      ...
    </ToastProvider>
  </AuthProvider>
</TenantProvider>
```

### InsForge Client Helpers

Updated:

```text
src/insforge/client.ts
```

Added:

- `setCurrentTenantId`
- `getCurrentTenantId`
- `getQueryFilter()`

`getQueryFilter()` returns:

```ts
{ tenant_id: currentTenantId }
```

Also wrapped `insforge.functions.invoke` so function bodies automatically include:

```json
{
  "tenant_id": "...",
  "metadata": {
    "tenant_id": "..."
  }
}
```

### Tenant Filters Added To Queries

Added tenant filters and tenant insert fields across database queries.

Pattern:

```ts
db.from("employees").select("*").eq("tenant_id", tenantId)
```

Insert pattern:

```ts
db.from("employees").insert([{ ..., tenant_id: tenantId }])
```

Realtime/chat handling:

- `chat_messages` queries include `tenant_id`.
- Chat insert includes `tenant_id`.
- Realtime handlers ignore payloads from other tenants.

Important:

- `chat_channels`, `chat_channel_members`, and `employees_public` were not tenant-filtered because those tables/views did not have `tenant_id`.

### Types Updated

Updated `src/types/index.ts` to include `tenant_id` on tenantized entities:

- `Employee`
- `Attendance`
- `Leave`
- `Holiday`
- `HRPolicy`
- `Task`
- `TaskSubmission`
- `CalendarEvent`
- `ChatMessage`
- `Notification`

## HR Settings Page

Created:

```text
src/hr/Settings.tsx
```

Added route:

```text
/hr/settings
```

Added sidebar item:

```text
Settings
```

Sections:

1. Company Profile
   - Company name
   - Company logo upload to InsForge Storage bucket `company-assets`
   - Timezone

2. Attendance Rules
   - Punch-in start time
   - Half-day cutoff time
   - Work hours per day
   - Lunch break minutes
   - Punch-out gate enabled

3. Leave Policy
   - Saved to `tenant_settings`
   - Keys:
     - `leave_casual_per_year`
     - `leave_sick_per_year`
     - `leave_earned_per_year`
     - `leave_carry_forward`
     - `leave_min_notice_days`

4. Notifications
   - Saved to `tenant_settings`
   - Keys:
     - `email_on_punch_in`
     - `email_on_punch_out`
     - `email_on_leave_request`
     - `email_on_task_submit`
     - `hr_notification_email`

All saves are tenant-scoped.

## Punch In / Out Tenant Rules

Updated only:

```text
src/employee/PunchInOut.tsx
```

It now reads settings from `TenantContext`:

- `tenant.punch_in_start`
- `tenant.punch_in_cutoff`
- `tenant.work_hours_per_day`
- `tenant.lunch_break_minutes`
- `tenant.punch_out_gate_enabled`

Behavior:

- Punch-in disabled before `tenant.punch_in_start`.
- Half-day status uses `tenant.punch_in_cutoff`.
- Punch-out gate uses `tenant.punch_out_gate_enabled`.
- Work hours subtract `tenant.lunch_break_minutes / 60`.
- Work hours are clamped with `Math.max(0, workHours)`.
- UI shows:

```text
Office hours: {tenant.punch_in_start} onwards · Half day after {tenant.punch_in_cutoff}
```

## Product Selector / Payroll Placeholder

Created:

```text
src/shared/ProductSelector.tsx
```

Added route:

```text
/select
```

Login flow changed:

```text
Login → Product Selector → HR Management or Employee Portal
```

If a previous product was selected, it redirects automatically using:

```text
localStorage key: talentmesh_last_product_${userId}
values: hr | payroll | employee
```

HR users see:

- HR Management card
- Payroll System card with `Coming Soon` badge and disabled button

Employee users see:

- My Portal card only

Added subtle switch links in:

- `src/hr/HRLayout.tsx`
- `src/employee/EmployeeLayout.tsx`

Text:

```text
⟵ Switch product
```

## Files Added

```text
src/contexts/TenantContext.tsx
src/hr/Settings.tsx
src/shared/ProductSelector.tsx
MULTI_TENANT_CONTEXT.md
```

## Important Files Modified

```text
.env.example
src/App.tsx
src/main.tsx
src/insforge/client.ts
src/types/index.ts
src/shared/Login.tsx
src/hr/HRLayout.tsx
src/employee/EmployeeLayout.tsx
src/employee/PunchInOut.tsx
```

Tenant query filters were also added across HR, employee, shared, and hook files that query tenantized tables.

## Verification Completed

Build command passed:

```bash
npm run build
```

The dev server was reachable at:

```text
http://localhost:5173
```

Credential test finding:

- HR and employee credentials can authenticate.
- **Before**: RLS database reads returned empty rows because JWTs did not include the `tenant_id`.
- **After**: Fixing RLS tenant lookup has been completed. RLS database reads now correctly return tenant-scoped rows using the `public.get_auth_tenant_id()` function, enabling full logged-in runtime testing.

