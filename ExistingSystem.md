ADD Employee:-

 the "Add Employee" logic in your HRMS application, specifically looking at `EmployeeCreate.tsx`, the associated Edge Functions, and the database SQL policies. 

Here is a comprehensive breakdown of how it works, the good practices it follows, the RLS policies securing it, and the edge cases where it might fail.

### 1. How the Logic Works
The employee creation process is broken down into a 5-step wizard that handles both authentication setup and HR profile creation:
1. **Data Collection (Steps 1-4):** Collects personal details, employment info, KYC/banking details, and emergency contacts.
2. **Auth User Creation:** Uses the `create-employee-user` edge function to create an authentication account for the employee in InsForge. This sends a 6-digit OTP to the employee's email.
3. **Email Verification:** HR enters the OTP to verify the email via the `verify-employee-code` edge function.
4. **Password Setup:** HR sets an initial login password for the employee via the `set-employee-password` edge function.
5. **Database Insertion (Step 5):** Once the auth user is set up and verified, the app inserts the full employee profile into the `employees` table using the HR user's database session.
6. **Auto-Initialization:** The system automatically seeds the `leave_balances` table for all active leave types so the employee can start using the portal immediately.
7. **Document Upload:** Finally, it uploads the profile photo, Aadhaar, and PAN documents to the `employee-documents` storage bucket.

---

### 2. Good Practices Followed
- **Session Storage Drafts:** The form state is continuously saved to `sessionStorage` (`hrms_employee_draft_${tenantId}`). If the HR user accidentally refreshes the page or navigates away, they don't lose their progress.
- **Secure Edge Functions:** It delegates sensitive operations (like creating auth users and setting passwords) to Edge Functions instead of exposing Admin API keys in the frontend.
- **Cross-Tenant Email Validation:** The `create-employee-user` function calls an RPC (`check_employee_exists_by_email`) to ensure the email isn't already used by an employee in *any* other tenant. This prevents data leakage and cross-tenant conflicts.
- **Orphaned Auth User Cleanup:** If an HR user abandons the onboarding process halfway, an "orphaned" auth user is left behind. The `create-employee-user` function smartly checks if an auth user exists without a corresponding employee profile. If the auth user is older than 1 hour, it safely deletes and recreates it.
- **Graceful Degradation for Non-Critical Steps:** If auto-initializing leave balances fails, it catches the error and logs a warning instead of failing the entire employee creation process.

---

### 3. Row Level Security (RLS) & SQL Policies
The entire flow is strictly governed by your multi-tenant architecture:
- **`tenant_isolation` Policy:** The `employees` table has a strict policy enforcing that the `tenant_id` of the row must match `public.get_auth_tenant_id()` (the tenant ID stored in the HR user's JWT `app_metadata`).
- **`tenant_active_restrictive` Policy:** An overarching `RESTRICTIVE` policy (`public.can_access_tenant(tenant_id)`) ensures that data can only be inserted or viewed if the tenant's account is currently active (not suspended or deleted).
- **Secure Password RPC:** The `set-employee-password` edge function doesn't use admin keys to change the password. Instead, it calls an RPC (`set_employee_password_by_hr`) using the *HR user's* token. The database function verifies that both the HR user and the target employee belong to the exact same `tenant_uuid` before allowing the password change.

---

### 4. Edge Cases Where it Fails (Potential Bugs)
While robust, there are a few scenarios where the logic can fail or result in inconsistent states:

1. **No Distributed Transaction (Rollback Failure):**
   If the database `INSERT` into the `employees` table fails (e.g., due to a database constraint violation or network error), the Auth User has *already* been created in InsForge Auth. There is no rollback mechanism to delete the Auth User if the database insert fails. 
2. **Immediate Retries on Failed Auth Creation:**
   If the HR creates the auth user but fails to verify the OTP and tries to restart the process immediately with the same email, they will hit the `< 1 hour` orphaned user restriction: *"This email recently started the onboarding process but hasn't finished. Please wait 1 hour..."*. This locks the HR out for an hour unless they manually delete the user in the dashboard.
3. **Document Upload Retry Loop:**
   If document uploads fail (e.g., due to file size or network), the app throws an error: *"Failed to upload some documents... Click 'Confirm & Create' to retry"*. While the code uses `insertedEmployeeId` to prevent duplicating the database row on retry, it doesn't gracefully handle the UI state—the user might think the employee wasn't created at all.
4. **Timezone Bug in Leave Initialization:**
   In line 369 of `EmployeeCreate.tsx`, the code uses `getTenantYear("UTC")` because the actual tenant timezone isn't available in the component context. If an HR user creates an employee on New Year's Eve, a timezone mismatch between UTC and the tenant's local time could result in the leave balances being initialized for the wrong year. 

Let me know if you would like me to fix any of these edge cases (such as the document upload retry flow or the timezone issue)!


Attendance Management:- 

a comprehensive audit of the Attendance Management logic on the HR side (`src/hr/Attendance.tsx`), the underlying SQL policies (`insforge-task-policy-hardening.sql` and `insforge-superadmin-setup.sql`), and Edge Functions (`calculate-late-marks.ts`). 

I have documented the complete findings in the artifact: attendance_audit_report
Here is a brief summary of the findings:

**1. What its logic does:**
- HR manages daily attendance, views an employee calendar, aggregations in a summary view, handles corrections, and approves overtime.
- The UI handles "partial updates" for corrections so if an employee only requested a change for their punch-out time, the punch-in time remains the original timestamp from the DB. 
- Overtime is automatically generated via backend RPC and simply approved by HR.

**2. Are there any edge cases where it fails?**
- **Concurrency in Manual Edits**: If two HR admins edit the exact same attendance record manually at the same time, the application uses a standard `UPDATE` without optimistic concurrency control, meaning the last save will overwrite the first.
- **Orphaned Open Sessions**: If an employee forgets to punch out, their `session_status` remains `open`. When HR manually edits their attendance to fix the missing times, the frontend code doesn't explicitly mark the session as `closed`.
- **Lunch Deduction Assumptions**: The RPC automatically deducts lunch time for any shift longer than 5 hours. If an employee worked 5+ hours but skipped lunch, their work hours may be under-reported.

**3. What practices it follows:**
- **Strict Audit Logging:** `CRITICAL` audit logs are created for correction approvals, capturing the before and after states. `WARNING` and `INFO` are used for edits and overtimes.
- **Payroll Locks:** Actions are strictly verified against the `payroll_lock_date` so HR can't edit attendance for finalized payroll periods.

**4. Row Level Security & SQL Policies:**
- Relies heavily on a `tenant_active_restrictive` policy that wraps all access logic with `USING (can_access_tenant(tenant_id))` ensuring perfect multi-tenant isolation.
- The `punch_out_attendance` RPC acts as a `SECURITY DEFINER` function and uses `FOR UPDATE` to securely lock the active session row in the database, fully preventing any double-click or network delay race conditions.

**5. Edge Functions:**
- **`punch_out_attendance` RPC**: Calculates the exact work duration in SQL, enforces a "Task Gate" (blocking punch-out if there are unresolved tasks), creates overtime records, and closes the session.
- **`calculate-late-marks.ts`**: An external Deno function that securely calculates excess late marks for an employee based on the tenant's threshold setting, preventing the client from manipulating deductions. 

# HR Attendance Management Audit Report

This report analyzes the Attendance Management module from the HR perspective, covering its core logic, potential edge cases, best practices, and the integration of Row Level Security (RLS) and Edge Functions.

## 1. Core Logic Overview
The HR Attendance module (`src/hr/Attendance.tsx`) provides a comprehensive suite for managing employee attendance with five distinct views:

*   **Daily View**: HR can view all employees for a specific date, filter by assigned shifts, and manually override punch-in, punch-out, and status. It utilizes `calculateShiftDuration` and `normalizeShiftTimes` to compute exact work hours and gracefully handles night shifts.
*   **Employee Calendar**: Displays a monthly calendar with color-coded dots (Present, Absent, Leave, Half Day, Weekend) for individual employees.
*   **Summary View**: Aggregates monthly statistics (days present, absent, on leave, avg work hours). It invokes the `calculate-late-marks` Edge Function to fetch the total late count, threshold limits, and deduction hours per employee.
*   **Corrections**: Employees can submit attendance correction requests. HR can approve or reject these. Approvals trigger a "partial update" that intelligently merges the requested times with existing database timestamps to prevent accidental data loss.
*   **Overtime**: Overtime is automatically logged by the `punch_out_attendance` RPC when an employee works beyond their expected shift. HR uses this view to review and approve/reject these entries.

## 2. Potential Edge Cases & Failure Points

*   **Payroll Lock Boundary Condition**: The module checks `dailyDate <= tenantSettings.payroll_lock_date` before allowing edits, overtime approvals, or correction approvals. Because this is a string comparison of dates (`YYYY-MM-DD`), if the HR user's local timezone vastly differs from the tenant's timezone, they might be incorrectly blocked or allowed to edit on the boundary day.
*   **Concurrency in Manual Edits**: If two HR administrators edit the exact same attendance row manually (`saveEdit`), the application uses a standard `UPDATE` without versioning. The last save will blindly overwrite the previous one, lacking Optimistic Concurrency Control (OCC).
*   **Orphaned "Open" Sessions**: If an employee forgets to punch out indefinitely, their `session_status` remains `open` and their `work_hours` remain null. If HR manually fixes the record via `saveEdit`, the front-end code does not explicitly update the `session_status` to `closed`. (However, the backend `punch_out_attendance` RPC does handle open sessions safely).
*   **Lunch Deduction Assumption**: The `punch_out_attendance` RPC automatically applies a lunch break deduction (`v_raw_hours >= 5 THEN p_lunch_minutes`). If an employee worked 5+ hours but skipped their lunch break, they are automatically penalized for the time, leading to slightly under-reported work hours.
*   **Extended Night Shifts**: The `normalizeShiftTimes` utility handles shifts spanning midnight by adding a day to the punch-out time if it's "less than" the punch-in time. If an employee forgets to punch out and does so >24 hours later, the logic may calculate the duration incorrectly.

## 3. Best Practices Followed

*   **Strict Audit Logging**: The application adheres strictly to auditing requirements. Approving a correction logs a `CRITICAL` event with full `before`/`after` snapshots of the attendance record. Manual edits and overtime approvals also trigger audit logs with `WARNING` and `INFO` severities respectively.
*   **Immutable Payroll Periods**: Hard enforcement of `payroll_lock_date` across all mutating actions (edits, corrections, overtimes) ensures historic attendance data cannot be altered once payroll is finalized.
*   **Intelligent Partial Updates**: When approving a correction, the system checks if the employee only requested to fix one side (e.g., just the punch-out). It falls back to the existing DB timestamp for the missing side, ensuring that `work_hours` can still be accurately calculated.
*   **Defensive Guardrails**: It explicitly rejects empty correction approvals (where both punch-in and punch-out are null) to prevent overwriting a valid attendance record with nullized work hours.

## 4. SQL Policies & Row Level Security (RLS)

*   **Strict Tenant Isolation**: The system heavily enforces multi-tenancy at the database level. In `insforge-superadmin-setup.sql` and `insforge-enterprise-03-restrictive.sql`, a core policy restricts access to attendance data:
    ```sql
    CREATE POLICY tenant_active_restrictive ON public.attendance AS RESTRICTIVE FOR ALL TO public 
    USING ((SELECT public.can_access_tenant(tenant_id))) 
    WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
    ```
    This ensures that regardless of other permissive policies, no user can ever access or modify attendance records outside of their active tenant context.
*   **RPC Session Locking**: The `punch_out_attendance` RPC uses the `FOR UPDATE` clause when selecting the open attendance session. This acquires a row-level lock, completely eliminating race conditions if an employee rapidly double-clicks the "Punch Out" button.

## 5. Edge Functions & RPCs

*   **RPC `punch_out_attendance` (`insforge-task-policy-hardening.sql`)**: 
    This is a highly sophisticated Postgres function (`SECURITY DEFINER`) that executes the punch-out logic securely on the backend:
    1.  **Session Locking**: Locks the active attendance row.
    2.  **Payroll Guard**: Re-verifies the payroll lock date at the database level.
    3.  **Task Gate Enforcement**: Queries unresolved tasks for the employee. If they have outstanding tasks assigned for the day, it raises an exception (`TASK_GATE_BLOCKED`) and aborts the punch-out.
    4.  **Calculations**: Safely calculates exact work hours, applies the lunch deduction, and records the geographical punch-out coordinates.
    5.  **Overtime generation**: Automatically spawns an unapproved `overtime_records` row if the work hours exceed the expected shift hours.
*   **Edge Function `calculate-late-marks.ts`**:
    Offloads complex late-mark deductions to a Deno edge function. It accepts the tenant, employee, and month, queries the database for all `is_late = true` records (excluding half-days and absences), and fetches the tenant's `late_mark_threshold` and `late_mark_deduction_hours` settings. It then calculates and returns the excess late marks and total hour deductions to be applied to the payroll.




how the Policy Center modules affect Attendance Management and updated the existing audit report. You can review the new "Policy Center Integration" section here: attendance_audit_report.

Here is a quick summary of the modules that affect attendance and their edge cases:

**1. Attendance Policy Module**
- **Logic:** Configures Late Marks (thresholds, grace minutes, deduction hours), Overtime rules (enablement, rate), Geofencing (radius, coordinates, mode), Regularization limits, and the crucial Payroll Lock Date.
- **Edge Cases:** 
  - **Timezone Mismatch**: The `payroll_lock_date` is a naive string (e.g., "2026-05-25"). If an HR admin's local timezone differs from the tenant's configured timezone, they might be incorrectly blocked or allowed to edit records right on the boundary day.
  - **Geofence vs. GPS Accuracy**: If `geofence_mode` is set to 'strict', an employee working in a building with poor GPS signal might be entirely blocked from punching out because their device cannot get an accurate fix inside the radius.

**2. Task Policy Module**
- **Logic:** Configures the **Task Gate** (`punch_out_gate_enabled`) and End-Of-Day Redmarks (`task_eod_redmark_time`).
- **Edge Cases:** 
  - **Task Gate Trap**: The most prominent edge case here is that an employee cannot punch out if they have any unresolved/unapproved tasks for the day. If a manager isn't available to approve a task late in the evening, the employee is unable to close their attendance session, resulting in an orphaned "open" session overnight that HR must manually resolve the next day.

**3. Company/Tenant Settings Module**
- **Logic:** Sets the default `punch_in_start`, `punch_in_cutoff`, `work_hours_per_day`, and `lunch_break_minutes`. This acts as the baseline for lateness calculations and work hour deductions for employees not assigned to a specific custom shift.

# HR Attendance Management Audit Report

This report analyzes the Attendance Management module from the HR perspective, covering its core logic, potential edge cases, best practices, and the integration of Row Level Security (RLS) and Edge Functions.

## 1. Core Logic Overview
The HR Attendance module (`src/hr/Attendance.tsx`) provides a comprehensive suite for managing employee attendance with five distinct views:

*   **Daily View**: HR can view all employees for a specific date, filter by assigned shifts, and manually override punch-in, punch-out, and status. It utilizes `calculateShiftDuration` and `normalizeShiftTimes` to compute exact work hours and gracefully handles night shifts.
*   **Employee Calendar**: Displays a monthly calendar with color-coded dots (Present, Absent, Leave, Half Day, Weekend) for individual employees.
*   **Summary View**: Aggregates monthly statistics (days present, absent, on leave, avg work hours). It invokes the `calculate-late-marks` Edge Function to fetch the total late count, threshold limits, and deduction hours per employee.
*   **Corrections**: Employees can submit attendance correction requests. HR can approve or reject these. Approvals trigger a "partial update" that intelligently merges the requested times with existing database timestamps to prevent accidental data loss.
*   **Overtime**: Overtime is automatically logged by the `punch_out_attendance` RPC when an employee works beyond their expected shift. HR uses this view to review and approve/reject these entries.

## 2. Potential Edge Cases & Failure Points

*   **Payroll Lock Boundary Condition**: The module checks `dailyDate <= tenantSettings.payroll_lock_date` before allowing edits, overtime approvals, or correction approvals. Because this is a string comparison of dates (`YYYY-MM-DD`), if the HR user's local timezone vastly differs from the tenant's timezone, they might be incorrectly blocked or allowed to edit on the boundary day.
*   **Concurrency in Manual Edits**: If two HR administrators edit the exact same attendance row manually (`saveEdit`), the application uses a standard `UPDATE` without versioning. The last save will blindly overwrite the previous one, lacking Optimistic Concurrency Control (OCC).
*   **Orphaned "Open" Sessions**: If an employee forgets to punch out indefinitely, their `session_status` remains `open` and their `work_hours` remain null. If HR manually fixes the record via `saveEdit`, the front-end code does not explicitly update the `session_status` to `closed`. (However, the backend `punch_out_attendance` RPC does handle open sessions safely).
*   **Lunch Deduction Assumption**: The `punch_out_attendance` RPC automatically applies a lunch break deduction (`v_raw_hours >= 5 THEN p_lunch_minutes`). If an employee worked 5+ hours but skipped their lunch break, they are automatically penalized for the time, leading to slightly under-reported work hours.
*   **Extended Night Shifts**: The `normalizeShiftTimes` utility handles shifts spanning midnight by adding a day to the punch-out time if it's "less than" the punch-in time. If an employee forgets to punch out and does so >24 hours later, the logic may calculate the duration incorrectly.

## 3. Best Practices Followed

*   **Strict Audit Logging**: The application adheres strictly to auditing requirements. Approving a correction logs a `CRITICAL` event with full `before`/`after` snapshots of the attendance record. Manual edits and overtime approvals also trigger audit logs with `WARNING` and `INFO` severities respectively.
*   **Immutable Payroll Periods**: Hard enforcement of `payroll_lock_date` across all mutating actions (edits, corrections, overtimes) ensures historic attendance data cannot be altered once payroll is finalized.
*   **Intelligent Partial Updates**: When approving a correction, the system checks if the employee only requested to fix one side (e.g., just the punch-out). It falls back to the existing DB timestamp for the missing side, ensuring that `work_hours` can still be accurately calculated.
*   **Defensive Guardrails**: It explicitly rejects empty correction approvals (where both punch-in and punch-out are null) to prevent overwriting a valid attendance record with nullized work hours.

## 4. SQL Policies & Row Level Security (RLS)

*   **Strict Tenant Isolation**: The system heavily enforces multi-tenancy at the database level. In `insforge-superadmin-setup.sql` and `insforge-enterprise-03-restrictive.sql`, a core policy restricts access to attendance data:
    ```sql
    CREATE POLICY tenant_active_restrictive ON public.attendance AS RESTRICTIVE FOR ALL TO public 
    USING ((SELECT public.can_access_tenant(tenant_id))) 
    WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
    ```
    This ensures that regardless of other permissive policies, no user can ever access or modify attendance records outside of their active tenant context.
*   **RPC Session Locking**: The `punch_out_attendance` RPC uses the `FOR UPDATE` clause when selecting the open attendance session. This acquires a row-level lock, completely eliminating race conditions if an employee rapidly double-clicks the "Punch Out" button.

## 5. Edge Functions & RPCs

*   **RPC `punch_out_attendance` (`insforge-task-policy-hardening.sql`)**: 
    This is a highly sophisticated Postgres function (`SECURITY DEFINER`) that executes the punch-out logic securely on the backend:
    1.  **Session Locking**: Locks the active attendance row.
    2.  **Payroll Guard**: Re-verifies the payroll lock date at the database level.
    3.  **Task Gate Enforcement**: Queries unresolved tasks for the employee. If they have outstanding tasks assigned for the day, it raises an exception (`TASK_GATE_BLOCKED`) and aborts the punch-out.
    4.  **Calculations**: Safely calculates exact work hours, applies the lunch deduction, and records the geographical punch-out coordinates.
    5.  **Overtime generation**: Automatically spawns an unapproved `overtime_records` row if the work hours exceed the expected shift hours.
*   **Edge Function `calculate-late-marks.ts`**:
    Offloads complex late-mark deductions to a Deno edge function. It accepts the tenant, employee, and month, queries the database for all `is_late = true` records (excluding half-days and absences), and fetches the tenant's `late_mark_threshold` and `late_mark_deduction_hours` settings. It then calculates and returns the excess late marks and total hour deductions to be applied to the payroll.

## 6. Policy Center Integration (`src/hr/PolicyCenter.tsx`)

The Policy Center drives the rules engine for Attendance Management through several modules (tabs):

### A. Attendance Policy Module
*   **Late Mark Logic**: Configures `late_mark_enabled`, `late_mark_threshold`, `late_mark_deduction_hours`, and `late_mark_grace_minutes`. This determines if a late mark is flagged when punching in, how many times an employee can be late before being penalized, and the exact deduction hours applied.
*   **Overtime Logic**: Configures `overtime_enabled` and `overtime_rate`. Controls whether overtime is recorded and what multiplier rate is used for payroll calculation.
*   **Geofence Logic**: Configures `geofence_enabled`, `geofence_radius_meters`, `office_lat`, `office_lng`, and `geofence_mode` (warn vs. strict). Validates if an employee is punching in/out from the designated office location.
*   **Regularization Logic**: Configures `regularization_enabled` and `regularization_window_days`. Restricts if and when employees can request attendance corrections (e.g., only within the last 7 days).
*   **Payroll Lock Date**: Globally freezes all attendance edits, overtime approvals, and corrections up to this specified date.

### B. Task Policy Module
*   **Task Gate Logic (`punch_out_gate_enabled`)**: Prevents employees from punching out if they have uncompleted or unapproved tasks assigned for the day. This links task completion strictly to attendance closure.
*   **Task EOD Redmark & Grace Period**: Configures `task_eod_redmark_time` and `task_grace_period_minutes`. If tasks are not completed by this cutoff, they are auto-redmarked as overdue, which interacts with the Task Gate if an employee attempts to punch out late in the evening.

### C. Company / Tenant Settings Module
*   **Shift Timing Defaults**: Configures `punch_in_start`, `punch_in_cutoff`, `work_hours_per_day`, and `lunch_break_minutes`. Sets the default boundaries for punch-ins and duration calculations for employees not assigned to a custom shift.

### Policy Center Edge Cases
*   **Timezone Mismatch on Payroll Lock**: The `payroll_lock_date` is a string (YYYY-MM-DD). If an HR admin's local timezone differs significantly from the tenant's timezone, they might be incorrectly blocked or allowed to edit records on the boundary day.
*   **Geofence Strict Mode vs. GPS Accuracy**: The system relies on the device's GPS. In `strict` mode, if an employee is in a building with poor GPS signal (low accuracy), they might be incorrectly blocked from punching out, trapping them in an open session.
*   **Task Gate Trap**: If `punch_out_gate_enabled` is true, an employee cannot punch out if they have unresolved tasks. If HR or a manager is unavailable to approve a task at the end of the day, the employee is unable to punch out, leading to an orphaned open session overnight.
*   **Late Mark vs. Shift Changes**: The `late_mark_grace_minutes` applies a static grace period. If an employee's shift assignment changes mid-month, historical late marks are not dynamically re-evaluated. The system securely relies on the `is_late=true` boolean evaluated at the exact time of the original punch-in.

Chats:-

I've conducted a comprehensive audit of the Chat module in your HRMS, examining the UI logic for both HR and Employees, the state management, and the underlying security posture. 

Here is a detailed breakdown of how it works, the edge cases you should be aware of, and the best practices it correctly employs.

### 1. Core Logic Overview

The chat system is driven by a unified `shared/Chat.tsx` component that dynamically adapts based on the user's role.

**HR Side Logic:**
- **Full Visibility:** Because of the `isHr` flag, HR admins bypass UI filters and can see all channels across the tenant, including private/custom channels.
- **Channel Management:** HR has the exclusive ability to create and delete channels. They can create Global, Department-specific, or Custom (private, invite-only) channels.
- **Announcement Control:** HR can post in channels marked as `is_announcement`, whereas employees cannot. 
- **Deletion:** HR can delete any channel (except `general`), which securely triggers an RPC call (`delete_chat_channel`) to handle the cleanup database-side.

**Employee Side Logic:**
- **Restricted Visibility:** The UI filters the channel list so employees only see Global channels, Department channels matching their specific department, and Custom channels where they are explicitly added to the `chat_channel_members` table.
- **Messaging:** Employees can send text messages and upload attachments (stored in the `chat-attachments` bucket).
- **Restrictions:** If a channel is an announcement channel, the input area is completely disabled for the employee, enforcing a read-only view. Employees can delete their *own* messages, but not others.

---

### 2. Edge Cases and Potential Failures

While the implementation is robust, I identified a few edge cases where the logic could fail or degrade the user experience:

1. **Storage Orphan Files on Insert Failure (Crucial):**
   When an employee sends an attachment, the file is uploaded to InsForge Storage *before* the message row is inserted into the database. If the DB insert fails, the app attempts to clean up the file using `storage.from("chat-attachments").remove(filePath)`. However, the InsForge/Supabase SDK `remove()` method strictly requires an **array of strings** (e.g., `remove([filePath])`). Passing a single string will throw an error, leaving the uploaded file orphaned in your storage bucket forever.
2. **Clock Skew and Optimistic UI:**
   The component uses Optimistic UI (displaying the message instantly before the server confirms). It generates a local timestamp (`new Date().toISOString()`) for sorting. If an employee's local device clock is significantly wrong, their sent messages will appear out of order until they refresh the page and rely on the server's authoritative `created_at` timestamp.
3. **No Retry Queue for Offline Messages:**
   If a user sends a message while offline, it correctly marks the delivery status as `failed`. However, there is no automatic background retry mechanism. The user cannot click "retry"—they have to manually copy the text and send it again.
4. **Partial Realtime Resync:**
   There is a clever `window.addEventListener("online")` event to resync the app when connection is restored. However, it only refetches the *top 3 most recently accessed channels*. If messages arrived in the 4th channel while offline, the user won't see them until they manually switch away and back to that channel.

---

### 3. Excellent Practices Followed

The codebase demonstrates highly sophisticated React and architectural patterns:

* **Pure Reducer for State Management:** Instead of messy `useState` logic, the chat uses a pure `useReducer` to manage a deterministic message cache. It handles `INIT_CHANNEL`, `PAGINATE`, `UPSERT`, and `DELETE` actions flawlessly. This makes deduplicating realtime events incredibly stable.
* **LRU (Least Recently Used) Cache:** The component tracks `accessedChannels`. If an employee clicks through more than 5 channels, the system automatically evicts the oldest channels from the memory cache (unless they have active drafts). This prevents memory leaks in large organizations with hundreds of channels.
* **Cursor-like Pagination:** When loading older messages, it uses a composite query: `or(created_at.lt.[oldest],and(created_at.eq.[oldest],id.lt.[oldest]))`. This is exactly how you avoid duplicating or skipping messages if a new message arrives at the exact millisecond the user clicks "Load More".
* **Optimistic UUIDs:** It generates temporary `client_message_id`s on the client so that when the realtime WebSocket event loops back, the reducer knows it's the *same* message and updates the delivery status from "sending" to "sent" without duplicating the bubble.

---

### 4. Security, Row Level Security (RLS), and Edge Functions

The database hardening around this module is exceptional:

* **RESTRICTIVE Policies for Tenant Isolation:** 
  I checked your SQL setup (`insforge-enterprise-03-restrictive.sql`), and you are using `AS RESTRICTIVE` policies on `chat_messages`, `chat_channels`, and `chat_channel_members`. 
  ```sql
  CREATE POLICY tenant_active_restrictive ON public.chat_messages 
  AS RESTRICTIVE FOR ALL TO public 
  USING ((SELECT public.can_access_tenant(tenant_id))) ...
  ```
  **Why this is good:** Normal permissive policies operate on an `OR` basis. A restrictive policy operates as an absolute `AND`. This means even if you accidentally write a bad permissive policy in the future, it is computationally impossible for an employee in Tenant A to read Chat Messages from Tenant B. This is the gold standard for multi-tenant SaaS security.
* **RPC for Complex Mutations (Edge Functionality):** 
  Instead of having the frontend delete the channel, then delete all members, then delete all messages, the frontend calls `db.rpc("delete_chat_channel")`. By offloading this to a PostgreSQL Remote Procedure Call (which acts similarly to an edge function), the deletion happens inside a secure, atomic database transaction. If any part fails, it rolls back entirely, preventing orphaned database rows.

**Summary:** 
Overall, the module is extremely well-engineered. The primary fix I recommend making when you have time is updating the storage cleanup method to use an array (`remove([filePath])`) to prevent orphaned storage blobs when database inserts fail.


How the Logic Works(Punch In & Punch Out):-
1. Punch In:
- Validates that the employee is scheduled for a shift and it's a working day.
- Fetches the user's public IP address (via `api.ipify.org`).
- Fetches the user's GPS coordinates and checks them against a defined office geofence (if enabled by HR).
- Compares the current local time to the shift start time to determine if the user is `is_late` or joining after the `half_day_cutoff`.
- Records all this data into the `attendance` table in the database.

1. Punch Out:
- Calculates the total `workHours` by measuring the time elapsed between `punch_in` and `punch_out`, minus a fixed `lunch_break_minutes`.
- Computes overtime if the `workHours` exceed the expected shift hours.
- Requires HR approval for any pending tasks before allowing the employee to punch out (if `punch_out_gate_enabled` is active).
- Fetches GPS coordinates again for the punch-out location.
- Updates the existing `attendance` record and creates an `overtime_record` if applicable.


Here is a comprehensive breakdown of the logic, the edge cases, and the engineering practices it follows.

### 1. What the Logic Does

**Punch In (Frontend Logic):**
1. **Time & Shift Evaluation:** Determines if the employee is allowed to punch in based on their shift start time. It includes specialized logic to handle **night shifts** (adjusting 24-hour boundaries).
2. **Location & Geofencing:** Calls the browser's Geolocation API. It requires a GPS accuracy of under 100 meters. If geofencing is enabled by HR, it calculates the distance to the office coordinates.
3. **Session Cleanup:** Calls a database RPC `close_stale_attendance` to auto-close any sessions from previous days that were left open.
4. **Direct DB Insert:** Captures the user's public IP (via `ipify.org`) and directly inserts a new "open" session into the `attendance` table using the Supabase client.
5. **Late Marking:** Evaluates if the current time exceeds the shift start time + HR grace period. If they are late, it fires a subsequent update to mark `is_late: true`.

**Punch Out (Backend Logic via RPC):**
1. **Location Tracking:** Collects location and accuracy from the frontend, identical to the punch-in step.
2. **PostgreSQL RPC Execution:** The frontend calls `punch_out_attendance` which executes entirely on the database side for security.
3. **Validations:** 
   - **Payroll Lock:** Verifies the attendance date doesn't fall before a locked payroll period.
   - **Task Gate:** Checks if `punch_out_gate_enabled` is true. If so, it scans the `tasks` table. If the employee has any pending/unapproved tasks for the day, it blocks the punch-out.
4. **Calculations:** Automatically subtracts lunch minutes (if the shift was > 5 hours) to compute exact `work_hours`.
5. **Overtime Generation:** If overtime is enabled, it checks if the hours worked exceed the expected shift hours and automatically inserts a pending record into `overtime_records`.

---

### 2. Edge Cases and Potential Failures

While the system is robust, there are a few edge cases where it could fail or exhibit unintended behavior:

*   **Race Condition on "Late" Status (Network Drop):** During Punch In, the frontend first *inserts* the attendance record, and then *updates* it with `is_late: true` if the employee is tardy. If the user's internet connection drops precisely between these two requests, the record is created, but the late mark is completely missed.
*   **Frontend Time Spoofing (Client-side Trust):** The logic that calculates whether a user is late (or if it's a "half day") relies heavily on the frontend's `new Date()`. A malicious employee could theoretically change their device's local clock to bypass the late-mark grace period or half-day cutoffs before pressing the button.
*   **Night Shift Date Logging:** If an employee on a night shift (e.g., 10 PM to 6 AM) punches in *after* midnight, the frontend `TODAY` variable will evaluate to the new calendar day. This might log the attendance against the wrong business day in the roster.
*   **Third-Party IP API Dependency:** The system relies on `api.ipify.org` to fetch the user's IP. If this service hangs, the punch-in action is delayed. (Though it does have a `catch` block to default to `"unknown"`, a slow network timeout will freeze the UI temporarily).

---

### 3. Good Practices Followed

The implementation demonstrates several excellent enterprise-grade engineering patterns:

*   **Idempotency & Concurrency Control:** The backend RPC uses `SELECT ... FOR UPDATE`. This row-level lock ensures that if a user double-clicks the punch-out button or triggers it on two devices simultaneously, a race condition won't corrupt the database or create duplicate overtime records.
*   **Structured Error Codes:** The backend throws standard PostgreSQL exceptions with custom `ERRCODE`s (e.g., `P0001` for corrupted sessions, `P0002` for payroll locks, `P0003` for task gates). The frontend maps these codes cleanly to user-friendly messages.
*   **Graceful Degradation for Location:** If a user denies GPS permissions, it doesn't hard-crash the app; it flags the database column `punch_in_location_status` as `"denied"` and proceeds. Furthermore, enforcing `< 100m` accuracy prevents users from spoofing location via low-accuracy cellular triangulation.
*   **Audit Logging:** Almost every significant event (successes, blocked punch-outs, corrupted sessions) writes an immutable record to an `audit_logs` table for compliance tracking.

---

### 4. Security: RLS, Policies, and Edge Functions

*   **RPC `SECURITY DEFINER`:** The `punch_out_attendance` PostgreSQL function is created with `LANGUAGE plpgsql SECURITY DEFINER`. This is a crucial security practice. It allows the function to execute with the privileges of the database owner. This means the employee can punch out (which involves reading tenant settings, scanning tasks, and writing to overtime records) *without* needing direct Row-Level Security (RLS) write-access to the `overtime_records` or `tenant_settings` tables themselves.
*   **Timezone Isolation:** Inside the SQL policy, it dynamically fetches the tenant's specific timezone (`v_now AT TIME ZONE v_tenant_tz`). This prevents "server time" bugs where midnight in UTC accidentally triggers a new day for an employee in India or the US.
*   **Edge Functions for Complex Aggregations:** The frontend calls a Supabase Edge Function (`calculate-late-marks`) to figure out how many times the user was late in a month. By moving this to a secure edge function rather than calculating it on the frontend, it ensures employees cannot manipulate the payload to hide their late marks from HR thresholds.




In the **Policy Center**, the logic for Punch In and Punch Out spans across three primary modules: **Company Profile**, **Attendance Policy**, and **Task Policy**. 

Here is a breakdown of which exact settings affect the logic, how they are applied, and potential edge cases:

### 1. Company / Tenant Profile Settings
These serve as the baseline definitions for time and hours.
*   **Timezone (`timezone`):**
    *   **Logic:** Dictates the mathematical boundary of "today". Both the frontend shift calculations and the backend RPC timezone translations rely entirely on this to ensure midnight crosses correctly according to the local region.
*   **Default Shift Times (`punch_in_start`, `punch_in_cutoff`):**
    *   **Logic:** Determines the exact minute an employee is expected to arrive (`punch_in_start`) and the minute after which they are marked as a `half_day` (`punch_in_cutoff`). *Note: If an employee is assigned a custom shift, the custom shift overrides these.*
*   **Lunch Break Minutes (`lunch_break_minutes`):**
    *   **Logic:** Upon Punch Out, if the employee has worked 5 or more hours, the RPC automatically deducts these minutes from their total calculated `work_hours`.
*   **Work Hours Per Day (`work_hours_per_day`):**
    *   **Logic:** Provides the baseline to calculate if the employee triggered overtime.

### 2. Attendance Policy Module
This module heavily modifies the actions taken during the database queries.
*   **Late Marks & Grace Period (`late_mark_enabled`, `late_mark_grace_minutes`):**
    *   **Logic:** On Punch In, the frontend checks if `current_time > punch_in_start + late_mark_grace_minutes`. If yes, it issues a secondary database `UPDATE` to set `is_late: true`. 
*   **Geofencing (`geofence_enabled`, `office_lat`, `office_lng`, `radius`):**
    *   **Logic:** During both Punch In and Punch Out, the device's GPS coordinates are compared against the configured office coordinates. If the employee exceeds the radius, the status is flagged as `outside_fence`.
*   **Payroll Lock Date (`payroll_lock_date`):**
    *   **Logic:** A critical security gate in the RPC. If an employee tries to Punch Out for a session that occurred on or before this locked date, the backend throws a `P0002` exception and blocks the punch-out. This prevents employees from altering their work hours for a payroll period that HR has already finalized.
*   **Overtime (`overtime_enabled`, `overtime_rate`):**
    *   **Logic:** On Punch Out, the backend calculates: `work_hours - expected_shift_hours`. If the remainder is > 0, it automatically inserts a pending entry into the `overtime_records` table with the configured `overtime_rate`.

### 3. Task Policy Module
*   **Punch-Out Gate (`punch_out_gate_enabled`):**
    *   **Logic:** This intertwines task management with attendance. When enabled, the `punch_out_attendance` RPC actively queries the `tasks` table. If the employee has any tasks due today in an unresolved state (`assigned`, `submitted`, `rejected`, `overdue`), it throws a `P0003` error and **completely locks the Punch Out button**. HR must approve the tasks before the employee can end their day.

---

### Edge Cases and Potential Vulnerabilities

1. **Geofence "Strict" Mode Illusion:**
   While there is a `geofence_mode` setting (warn vs. strict), the frontend logic for Punch In only sets `locationData.punch_in_location_status = "outside_fence"` and displays an informational toast. It **does not actually block** the punch-in if they are outside the radius. It acts strictly as a reporting mechanism right now.
2. **Timezone Shifts Mid-Day:**
   If HR updates the `timezone` setting in the Policy Center while employees are currently clocked in, it can drastically break the `close_stale_attendance` logic or push current shifts into different calendar days, corrupting the roster records.
3. **The Payroll Lock Trap:**
   If an employee forgets to punch out, their session remains "open". If HR sets the `payroll_lock_date` to encompass that day, the employee is now permanently stuck. They cannot punch out (because of the lock), but they have an open session. HR will have to manually fix their attendance record.
4. **Late Mark Network Drops:**
   Because the Late Mark feature is an `INSERT` followed by an `UPDATE`, if the user closes their browser exactly after the `INSERT` but before the `UPDATE` is sent, they will bypass the late mark penalty entirely. This logic should ideally be moved entirely into the backend or handled dynamically.



HR Shift Management:-
Based on a comprehensive audit of `src/hr/ShiftManagement.tsx` and the underlying InsForge database schema, here is a breakdown of what the Shift Management logic does, its edge cases, best practices, and the security policies it utilizes.

### 1. What the Logic Does
The module provides a full UI for HR to handle workforce timing rules:
*   **Shift Definitions**: HR can define custom shifts with start/end times, designated working days, early punch-in windows (e.g., opens 60 mins before), and grace periods for late marks.
*   **Default Shift Fallback**: Maintains one "Default" shift applied dynamically to any active employee without an explicit assignment, preventing gaps in attendance tracking.
*   **Employee Assignments**: Allows assigning employees to specific shifts using **effective dating** (`effective_from`, `effective_to`). This ensures that changes apply from a specific date onward, maintaining a historical record of what shift someone was on during a past payroll cycle.

### 2. Handled Edge Cases & Fail-safes
The logic is highly defensive and handles several critical edge cases beautifully:
*   **Night Shift Boundaries**: If HR sets an `end_time` that is earlier than the `start_time`, the UI automatically detects a "Night Shift" and displays an alert indicating that the system will automatically handle the midnight crossover.
*   **Historical Edits**: If a shift has been used in past assignments (`effective_from < today`), the UI warns HR that editing the times will retroactively alter historical lateness calculations.
*   **Duplicate Future Assignments (Changing their mind)**: If HR schedules a shift change for tomorrow, but then changes their mind and assigns a *different* shift before tomorrow arrives, the code specifically deletes the existing `effective_from = tomorrow` row before inserting the new one. This prevents throwing a PostgreSQL Unique Constraint error.
*   **Last Default Deletion Guard**: It explicitly blocks deactivating the only remaining default shift. This prevents a catastrophic edge case where employees without explicit assignments suddenly have zero attendance rules applied to them.

### 3. Excellent Practices Followed
*   **Soft Deletes for Immutability**: When deleting a shift, the code updates `is_active: false` rather than issuing a hard SQL `DELETE`. A hard delete would trigger a `CASCADE` delete on the `employee_shifts` table, wiping out historical assignments and completely breaking past payrolls. Soft deletes simply hide the shift from future dropdowns.
*   **Per-Employee Error Isolation in Bulk Actions**: When assigning shifts in bulk, the loop does not run in a single master `try/catch`. Each employee is processed in their own block. If one employee's assignment fails, it does *not* abort the entire batch. It accumulates the successes and failures, then gives HR a detailed summary of exactly who succeeded and who failed.
*   **Future-Dated Scheduling**: Assignments are hardcoded to apply `effective_from` **tomorrow**. This is a great practice as it prevents mid-day changes from scrambling the attendance calculations for an employee who has already punched in today.
*   **Comprehensive Audit Logging**: Utilizing the `useAuditLog()` hook, every sensitive action (creating overrides, soft-deleting a shift, individual assignments, and bulk assignments) logs an event with severity, metadata, and timestamps to `platform_audit_logs` for compliance.

### 4. Row-Level Security (RLS) & SQL Policies
The backend schema strongly reinforces the client-side logic:
*   **Strict Tenant Isolation**: Both the `shifts` and `employee_shifts` tables have an RLS policy named `tenant_isolation` enforcing `(tenant_id = get_auth_tenant_id())`. It is mathematically impossible for one tenant to query or modify shift data belonging to another tenant.
*   **GiST Exclusion Constraints**: The `employee_shifts` table uses an advanced PostgreSQL constraint (`employee_shifts_no_overlap_excl`) over `daterange(effective_from, effective_to)`. This constraint acts as an impenetrable shield—the database will physically reject any attempt to assign an employee to two overlapping shifts at the same time.
*   **Unique Constraints**: A unique index `employee_shifts_tenant_id_employee_id_effective_from_key` guarantees there can never be two records starting on the exact same date for the same employee.

### 5. Edge Functions & RPCs
*   **None utilized for this module**: The Shift Management module *does not* use any Edge Functions or custom PostgreSQL RPCs. 
*   **Why?**: It doesn't need to. The module relies entirely on the standard InsForge/Supabase Client SDK (`db.from('shifts')...`) wrapped in Promises. It offloads all the heavy safety lifting (overlap prevention, multi-tenant isolation, cascade mapping) directly to the robust SQL schema constraints and RLS policies described above.



In the HRMS, the **Policy Center** (`src/hr/PolicyCenter.tsx`) acts as the global configuration engine. It directly controls the boundary conditions, penalties, and fallbacks for the Shift Management module. 

Here are the specific modules within the Policy Center that affect Shift Management, how they work, and their associated edge cases:

### 1. Company Profile Module (Global Fallbacks & Time)
This module establishes the baseline environment for shifts.
*   **Timezone (`timezone`)**: 
    *   **Logic**: Every shift's `effective_from` date and midnight crossover calculations are bound to this timezone (via `getTenantDate(tenantForm.timezone)`), rather than the server's UTC time.
    *   **Edge Case**: If HR changes the company timezone mid-month, the definition of "today" and "tomorrow" shifts. This can cause an employee to either miss a scheduled shift change or have an attendance record assigned to the wrong calendar date if they were working during the timezone switch.
*   **Default Shift Timings (`punch_in_start`, `punch_in_cutoff`)**:
    *   **Logic**: If an employee has no custom shift assigned and the "Default Shift" is missing or broken, the system falls back to these raw global times.
    *   **Edge Case**: If these global times are drastically different from actual working hours, an employee falling through the cracks (no explicit shift) will be incorrectly marked absent or heavily late.

### 2. Attendance Policy Module (Penalties & Constraints)
This module determines what happens when an employee deviates from their assigned shift.
*   **Late Marks (`late_mark_enabled`, `late_mark_grace_minutes`)**:
    *   **Logic**: If an employee punches in after `shift.start_time` + `late_mark_grace_minutes`, they get a late mark. 
    *   **Interaction/Edge Case**: A custom shift in Shift Management can define a `late_mark_grace_override`. The attendance calculator must securely check if the shift's override is `null`; if it is, it falls back to this global policy. If HR leaves the global policy at 0 but expects a 15-min grace, employees will be unfairly penalized.
*   **Deductions (`late_mark_threshold`, `late_mark_deduction_hours`)**:
    *   **Logic**: For example, "For every 3 late marks, deduct 0.5 hours of salary." This aggregates across the month regardless of which specific shifts the employee worked.
*   **Geofencing (`geofence_enabled`, `geofence_mode`, `office_lat`/`lng`)**:
    *   **Logic**: When an employee tries to punch in for their shift, their GPS coordinates are checked against the office location and radius. `geofence_mode` determines if they are hard-blocked (`strict`) or just flagged (`warn`).
    *   **Edge Case**: If an employee is assigned to a "Remote/Night" shift but geofencing is globally enabled in `strict` mode without a remote bypass, they will be physically unable to start their shift from home.
*   **Immutability (`payroll_lock_date`)**:
    *   **Logic**: Prevents any changes to attendance records or shift assignments before a specific date.
    *   **Edge Case**: If HR makes a mistake in assigning an employee's shift and the month rolls over past the `payroll_lock_date`, the system will mathematically block HR from retroactively correcting the shift assignment. They must temporarily remove the lock date, fix the shift, and re-lock it.

### 3. Task Policy Module (Shift Exit Conditions)
This module governs how and when an employee is allowed to end their shift.
*   **Punch Out Gate (`punch_out_gate_enabled`)**:
    *   **Logic**: When enabled, the system intercepts the employee's attempt to punch out at the end of their shift. If they have incomplete tasks marked for that day, the system physically blocks the punch-out.
    *   **Edge Case**: If an employee works a Night Shift (e.g., 8 PM to 4 AM), their tasks might technically belong to the previous calendar day. If the query strictly looks at "today's" tasks, the employee might be blocked from punching out because the task system thinks they are trying to punch out on a day with no tasks.

### 4. Salary Policy Module (Shift Value)
*   **Loss of Pay Method (`lop_calculation_method`)**:
    *   **Logic**: Determines how missed shifts are monetized. Can be `calendar` (Gross / Days in month), `fixed_26` (Gross / 26), or `working_days`.
    *   **Edge Case**: If a custom shift requires working 7 days a week, but the company policy is set to `fixed_26`, deducting a day for a missed shift will deduct a disproportionately large amount of money relative to the employee's actual daily earnings.


leave Management:-


I have conducted a comprehensive audit of the **Leave Management** module across both the Employee and HR flows. 

Here is a detailed breakdown of the logic, edge cases, best practices, RLS policies, and its architectural approach.

### 1. What the Logic Does (The Core Flow)
The system bridges **Leaves, Balances, and Attendance** tightly together:
* **Employee Application (`MyLeaves.tsx`)**: The UI calculates dynamic "business days" in real-time by checking the employee's assigned shift (`working_days`) and comparing it against the `holidays` table. It strictly prevents submission if the requested days exceed their `leave_balances`. 
* **HR Approval (`LeaveManagement.tsx`)**: HR receives the pending request. When they click "Approve", the frontend dynamically resolves the employee's historical shift at the time of the leave (`effective_from <= leave.start_date`) to recalculate the exact working days. It then sends this payload to the SQL RPC `approve_leave_request`.
* **The RPC Engine (`update-approve-leave-request-rpc.sql`)**: 
  1. Deducts the `approved_business_days` from `leave_balances`.
  2. Updates the `leaves` status to `'approved'`.
  3. **Auto-injects `attendance` rows** for those dates, marking them as `'on_leave'` and `session_status = 'closed'`.
* **Cancellations**: HR can cancel approved leaves via `cancel_leave_request`, which acts as a state machine reversal, automatically refunding the leave balance.

---

### 2. Edge Cases (Handled & Protected Against)
The system is highly defensive and protects against several complex edge cases:
* **The "Double-Spend" Race Condition**: If two HR admins approve the same leave at the exact same millisecond, or a user spams the apply button, it will **not** deduct the balance twice. The RPC explicitly locks the rows (`FOR UPDATE`) and validates `IF v_leave.status != 'pending' THEN RAISE EXCEPTION`.
* **Attendance Session Collisions**: An employee might have a "pending" leave but decide to punch in on that day anyway. When HR later approves the leave, the RPC injects the attendance row but explicitly sets `session_status = 'closed'`. This directly prevents the database from crashing with a unique constraint violation (`idx_single_open_session`).
* **Shift Re-assignments**: If an employee moves from a 5-day work week to a 6-day work week, the HR approval logic fetches the specific `employee_shifts` record active *during* the leave dates, ensuring math is always perfectly accurate to history.
* **Malformed Bulk Imports**: The Holiday import logic uses `PapaParse` to safely handle commas inside CSV descriptions and strictly regex-validates dates before they ever touch the database, preventing DB panic errors.

---

### 3. Good Practices Followed
* **Server-Side Validation as the Source of Truth**: The client calculates days for UX, but the RPC recalculates and enforces the true mathematical deduction. The frontend is never trusted blindly.
* **Idempotency in Data Imports**: The Holiday bulk upload uses an `UPSERT` with `ignoreDuplicates: true` (`ON CONFLICT (tenant_id, date) DO NOTHING`). This guarantees mathematical uniqueness without destructively overwriting existing holiday descriptions or corrupting `created_at` audit trails.
* **Robust Audit Trails**: Every approval, rejection, and holiday import triggers the `logAction` hook, inserting undeniable records into the `notifications` and audit logging system.

---

### 4. Row Level Security (RLS) & SQL Policies
* **Strict Tenant Isolation**: `leaves`, `leave_balances`, and `holidays` tables are all governed by the `tenant_active_restrictive` policy: 
  ```sql
  USING ((SELECT public.can_access_tenant(tenant_id))) 
  WITH CHECK ((SELECT public.can_access_tenant(tenant_id)))
  ```
  This guarantees that data bleeding across tenants is impossible at the database engine level.
* **The `SECURITY DEFINER` Strategy (Excellent Practice)**: The `approve_leave_request` function is defined as `SECURITY DEFINER`. Because leaves require touching 3 different tables (`leaves`, `leave_balances`, `attendance`), writing complex RLS policies for all 3 would be a nightmare. By using `SECURITY DEFINER`, the RPC temporarily elevates privileges to run the atomic transaction safely, strictly enforcing the logic inside the wrapper while bypassing the need for overly complex cross-table RLS policies.

---

### 5. Edge Functions Architecture
* **Zero Edge Functions (Which is the Correct Choice here)**: The leave management module completely bypasses external Edge Functions (like Deno/Node functions) in favor of **pure Postgres RPCs**. 
* **Why this is great**: By keeping this logic inside Postgres, the system guarantees **ACID compliance** (Atomicity, Consistency, Isolation, Durability). If this were an Edge Function, a network timeout between updating the `leave_balances` and inserting the `attendance` rows could result in a fatal desync (partial failure). By keeping it entirely in SQL, it succeeds or rolls back as a single guaranteed unit.






Within the **Policy Center** (`src/hr/PolicyCenter.tsx`), Leave Management is governed by two primary modules. These modules control everything from how leaves are earned to how they roll over, feeding directly into both the Employee portal and Payroll.

Here is a breakdown of the modules, their logic, and the associated edge cases:

### 1. The Leave Types Module (Granular Control)
This is the most powerful module affecting leaves. Instead of hardcoding "Sick" or "Casual" leaves, it allows HR to dynamically create leave types with highly specific rule sets:

* **Accrual Logic (`accrual_type`)**: 
  * *Logic*: Can be set to `lump_sum` (employee gets all 12 days on Jan 1st) or `monthly` (employee earns 1 day per month).
  * *Effect*: If set to monthly, it hooks into the system's Postgres cron jobs (`create-monthly-accrual-job.sql`) to automatically increment balances on the 1st of every month.
* **Carry Forward Limits (`carry_forward`, `max_carry_forward_days`)**: 
  * *Logic*: Dictates whether unused days expire at the end of the year or roll over to the next, up to a strict mathematical cap.
* **Probation & Waiting Periods (`restrict_during_probation`, `applicable_after_days`)**: 
  * *Logic*: Prevents new hires from burning leaves immediately. If an employee's tenure is less than the `applicable_after_days`, they are blocked from using this specific leave type.
* **Duration & Notice Limits (`maximum_consecutive_days`, `minimum_notice_days`)**: 
  * *Logic*: Prevents abuse (e.g., taking 10 Casual Leaves in a row) and ensures managers have enough lead time for scheduling.
* **Financial Impact (`is_paid`, `encashment_allowed`)**: 
  * *Logic*: `is_paid = false` directly flags the days for Payroll to calculate Loss of Pay (LOP). `encashment_allowed` permits HR to cash out unused balances during year-end or final settlement.
* **Compliance (`requires_document`)**: 
  * *Logic*: Flags the leave type (usually Sick Leave) to require file uploads (like a doctor's note) before HR can approve it.

### 2. The Leave Balance Initializer
* **Logic**: When HR adds a new leave type or a new year begins, this module seeds the `leave_balances` table for all active employees. 
* **Edge Case Handled (Idempotency)**: It performs a "dry run" first, calculating a composite key of `employee_id:leave_type_id:year`. It only provisions balances for the `newCount` missing records and explicitly skips the `existingCount`. This prevents a catastrophic edge case where clicking "Initialize" accidentally resets or overwrites an employee's currently consumed balances.

---

### Edge Cases and Potential Risks

While the Policy Center is robust, changing these policies introduces several edge cases you should be aware of:

1. **Mid-Year Policy Reversals (The Negative Balance Risk)**: 
   If HR reduces the `days_per_year` for Casual Leave from 12 to 8 in July, but an employee has already consumed 10 days, their balance will mathematically drop to `-2`. The system handles this gracefully by preventing new requests, but HR must manually resolve the negative balance during payroll (LOP deduction).
2. **Accrual Timing (The 1st of the Month Gap)**: 
   For `monthly` accruals, if an employee desperately needs a sick leave on the morning of the 1st, but the database cron job hasn't fired yet to credit their monthly balance, the UI will block their request due to "Insufficient Balance". (Usually mitigated by allowing negative balances for sick leaves or HR overriding it).
3. **Client vs. Server Enforcement Gaps**: 
   While the Policy Center defines rich rules (like `maximum_consecutive_days` or `minimum_notice_days`), if these are not strictly enforced on the Employee's `applyLeave` submission form in the UI, an employee could technically submit an invalid request, forcing HR to manually catch the violation and reject it.
4. **Year-End Rollover Race Conditions**: 
   When transferring balances to the new year on Dec 31st, the system must carefully apply the `max_carry_forward_days` limit before the new year's `lump_sum` is deposited, ensuring the maximum cap isn't circumvented by timing issues.

   Policy Center:-


Based on my audit of the **Policy Center** module (`src/hr/PolicyCenter.tsx`) and the associated SQL functions/policies (`insforge-task-policy-hardening.sql` and `insforge-enterprise-03-restrictive.sql`), here is a comprehensive breakdown of its logic, edge cases, practices, security, and functions.

### 1. What the Policy Center Logic Does
The Policy Center acts as the central configuration hub for HR admins to set rules globally for their tenant. It is categorized into five main pillars:
- **Attendance**: Defines punch-in/cutoff times, late mark deductions, overtime rates, and geofencing boundaries.
- **Leave**: Configures minimum notice days, carry-forward limits, and leave types.
- **Salary**: Sets LOP (Loss of Pay) calculation methods (e.g., `calendar` vs `fixed_26`), PF/ESI ceilings, and Professional Tax limits.
- **Task**: Enforces rules like the "Punch-Out Gate" (blocking punch-outs if tasks are pending) and EOD red-marking times.
- **Company**: Global tenant settings (Timezone, Company logo, etc.).

**How it works structurally:**
Instead of having a monolithic `tenants` table with 50+ columns for every possible setting, the system uses an **EAV (Entity-Attribute-Value)** pattern via the `tenant_settings` table. Key-value pairs (e.g., `late_mark_enabled = "true"`) are saved to the database. The React component transforms these key-value pairs into structured forms, allows editing, and saves them back.

---

### 2. Edge Cases and Potential Failure Points
While the system is robust, there are a few edge cases that could cause operational friction or silent failures:

1. **Strict Punch-Out Gate vs. Shift Abandonment:**
   - **Edge Case:** If `punch_out_gate_enabled` is active, an employee cannot punch out until they mark all tasks due today as resolved. 
   - **Failure Point:** If an employee simply leaves the office without resolving tasks (or their phone dies), the session stays "open". They will need HR to manually intervene and force-close the session the next day, skewing overtime/work-hour calculations.
2. **JSON Serialization in Salary Templates:**
   - **Edge Case:** Department salary templates (like `salary_template_sales`) are stored as JSON strings inside the `tenant_settings` value column.
   - **Failure Point:** If an admin manually updates the DB with malformed JSON, the frontend's `parseSalaryTemplate` function uses a `try/catch` that silently returns `null`. The template will magically disappear from the UI instead of throwing an alert.
3. **Timezone Drift during Cron Execution:**
   - **Edge Case:** The automated `fn_auto_redmark_tasks` cron job converts UTC to the tenant's local timezone (`AT TIME ZONE v_tenant_tz`).
   - **Failure Point:** If HR enters an invalid timezone string or PostgreSQL doesn't natively support the exact format provided, the timezone conversion might fallback or fail, causing tasks to be marked overdue at the wrong time.

---

### 3. Good Practices Followed
The module follows several excellent software engineering patterns:
- **Optimistic Concurrency Control (Stale Write Detection):** If two HR admins have the Policy Center open simultaneously and Admin A saves changes, Admin B's attempt to save will be rejected with a `STALE_WRITE` exception. This prevents silent overwrites of critical payroll rules.
- **Error Classification:** The UI catches raw PostgREST errors (like `PGRST301` or `42501`) and gracefully maps them into user-friendly toasts (e.g., *"Permission denied"*, *"Another admin has modified these settings"*).
- **Separation of Policy vs. Enforcement:** The UI merely saves the policy flags (e.g., `payroll_lock_date`). The actual enforcement logic is embedded deep in the database RPCs, meaning even if a user bypassed the frontend, they couldn't circumvent the rules.
- **Comprehensive Audit Logging:** Every time a policy is saved, it triggers `logAction("settings.updated")`, creating a non-repudiable trail of who changed company rules and when.

---

### 4. Row-Level Security (RLS) & SQL Policies
The application implements highly strict, multi-tenant isolation at the database level to ensure cross-tenant data leaks are impossible.

- **Restrictive Access Policy:** Inside `insforge-enterprise-03-restrictive.sql`, the `tenant_settings` table uses a `RESTRICTIVE` policy:
  ```sql
  CREATE POLICY tenant_active_restrictive ON public.tenant_settings AS RESTRICTIVE 
  FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id)));
  ```
  *Why this is great:* A restrictive policy acts as a global `AND` condition. Even if a permissive policy accidentally granted access to all settings, this restrictive policy hard-stops any read/write unless the authenticated user actually belongs to that specific `tenant_id`.

---

### 5. Edge Functions & Postgres RPCs
Instead of using slow API-based serverless functions to enforce policies, the platform heavily utilizes **PostgreSQL Remote Procedure Calls (RPCs)** and **pg_cron** to enforce rules at the lowest possible latency level:

- **`punch_out_attendance` (RPC):** 
  When an employee punches out, this RPC executes within a locked transaction (`FOR UPDATE`). It actively queries `tenant_settings` on-the-fly to enforce rules.
  - Checks if the date violates `payroll_lock_date` (Throws `P0002 PAYROLL_LOCKED`).
  - Evaluates `punch_out_gate_enabled` and counts pending tasks (Throws `P0003 TASK_GATE_BLOCKED`).
  - Auto-calculates lunch deductions and overtime strictly based on the HR policy configurations.
- **`fn_auto_redmark_tasks` (pg_cron Extension):**
  Instead of an external server polling the database, a Postgres cron schedule (`* * * * *`) runs every minute natively in the database.
  - It iterates over every active tenant, reads their specific `task_eod_redmark_time` and `task_grace_period_minutes` from settings.
  - It calculates the precise cutoff timestamp in the tenant's local timezone.
  - If a task is past the deadline, it runs a bulk `UPDATE` setting them to `overdue` and logs an automated `system` audit trail.




The settings configured in the Policy Center are not just local UI flags; they act as the "brain" for the entire HRMS platform. The key-value pairs stored in `tenant_settings` actively dictate the logic in almost every major module of the system. 

Here is exactly how the Policy Center impacts each module logic-wise:

### 1. Attendance & Geofencing (`src/employee/PunchInOut.tsx`)
When an employee clicks "Punch In" or "Punch Out", the component first pulls the active tenant settings to determine *how* they are allowed to punch:
- **Geofence Enforcement:** If `geofence_enabled` is true, the system forces the browser to request the employee's GPS coordinates. It calculates the distance between their GPS and the HR-configured `office_lat`/`office_lng`. If they are outside the `geofence_radius_meters`, the punch-in is either warned or hard-blocked depending on the `geofence_mode`.
- **Late Marks:** The logic evaluates the `punch_in_cutoff` and `late_mark_grace_minutes`. If the current time exceeds the cutoff + grace period, it permanently tags the attendance session with a `late_mark`.
- **Regularization Gate:** If `regularization_enabled` is false, the "Correct Attendance" button is completely disabled for the employee, forcing them to talk to HR manually.
- **Overtime Engine:** During punch-out, it reads `overtime_enabled` and `overtime_rate`. If they worked more than the `work_hours_per_day`, it automatically creates a record in the `overtime_records` table with the exact financial amount owed.

### 2. Task Management (`insforge-task-policy-hardening.sql`)
The Task Policy settings tightly couple task completion with daily attendance via database RPCs and Cron Jobs:
- **The Punch-Out Gate (`punch_out_gate_enabled`):** If an HR admin turns this on, the system executes an RPC (`punch_out_attendance`) when an employee tries to end their day. The database checks if the employee has any tasks due today (or earlier) that are still in `assigned` or `rejected` status. If they do, the database **throws a `P0003` error**, physically blocking them from punching out until they resolve the tasks.
- **Automated Red-Marking (Cron Job):** A background Postgres pg_cron job checks the `task_eod_redmark_time` (e.g., 23:30) and `task_grace_period_minutes`. Once that exact time hits in the tenant's local timezone, it sweeps through all incomplete tasks and forcefully updates their status to `overdue`.

### 3. Payroll Calculation Engine (`src/payroll/hr/RunPayroll.tsx`)
When HR runs the monthly payroll, the calculation engine relies exclusively on the Salary Policy tab:
- **Loss of Pay (LOP) Formula:** It reads the `lop_calculation_method`. Based on this, a day's salary deduction is calculated dynamically:
  - `calendar`: (Gross ÷ total days in that specific month)
  - `fixed_26`: (Gross ÷ 26 days)
  - `working_days`: (Gross ÷ actual shift working days)
- **Compliance Caps:** The payroll engine reads the `pf_wage_ceiling` (usually ₹15,000) and `esi_gross_ceiling` (₹21,000). It automatically caps the provident fund deductions so HR doesn't over-deduct employee pay.
- **Payroll Lock (`payroll_lock_date`):** If HR sets a lock date (e.g., May 25th), the system freezes all attendance and task modifications before that date. If an employee tries to correct attendance for May 24th, the database rejects it with a `P0002 PAYROLL_LOCKED` error.

### 4. Employee Onboarding (`src/hr/EmployeeCreate.tsx`)
When HR adds a new employee to the system, they select a department. The system queries the `tenant_settings` to find the matching **Salary Template** (e.g., `salary_template_sales`). 
- It auto-populates the new employee's basic pay percentage, HRA, and flags if PF/ESI are applicable, significantly reducing data-entry errors for HR during onboarding.



Policy Management:-
Based on a thorough review of the HR Policy Management module (`src/hr/PolicyUpload.tsx`, `src/employee/Policies.tsx`, and the SQL schemas), here is an audit of its logic, edge cases, best practices, and security measures.

### 1. How the Logic Works (HR Side)
The Policy Management page allows HR to upload, view, and delete company policies and handbooks.

* **Upload Flow**:
  1. The HR user selects a file (`.pdf`, `.doc`, `.docx`), sets a title, description, and chooses **Visibility** (`All Employees`, `HR Only`, or `Specific Department`).
  2. The file is uploaded directly from the frontend to the InsForge Storage bucket (`hr-policies`) with a randomized, collision-proof filename.
  3. Once the upload succeeds, a record is inserted into the `hr_policies` PostgreSQL table containing the file's public URL, metadata, and visibility rules.
  4. The system queries the `employees` table for active users matching the visibility criteria and inserts a notification for each of them.
  5. The action is logged to the audit system.
* **View/Download Flow**:
  1. Files can be downloaded directly via their public URL.
  2. For previews, it embeds the Google Docs Viewer in an iframe (`https://docs.google.com/viewer?url=...`), passing the public URL of the policy.
* **Delete Flow**:
  1. The file path is extracted from the URL, and the file is deleted from the `hr-policies` storage bucket.
  2. The database record is deleted, and the action is audit-logged.

---

### 2. Best Practices Followed (The "Good Things")
The implementation has several excellent architectural patterns:

* **Upload Rollbacks**: If the database insert fails *after* the file is successfully uploaded to storage, the frontend catches the error and automatically deletes the orphaned file from the storage bucket (`await storage.from("hr-policies").remove(filePath)`).
* **Collision-Proof Filenames**: Files are saved with a randomized prefix and timestamp (e.g., `[random]-[timestamp].pdf`), preventing overwrites if two policies have the exact same filename.
* **Granular Audit Logging**: Every upload and deletion invokes `useAuditLog()`, leaving an immutable trail of which HR user modified company policies.
* **Optimized Payload for Notifications**: When fetching employees to notify, it only selects the `id` column (`.select("id")`), minimizing network payload instead of pulling the entire employee object.

---

### 3. Edge Cases & Potential Failures
While the logic is solid, there are a few edge cases where it could fail or present security concerns:

* **File Deletion Parsing Logic (Orphaned Files)**: 
  When deleting a policy, the code extracts the storage path by splitting the URL: `deletePolicyItem.file_url.split("/hr-policies/")[1]`. If the bucket name ever changes, or if the InsForge URL structure changes, this split will fail. The file won't be deleted from storage, causing orphaned files and ballooning storage costs.
  * **Fix**: Store the `storage_path` as a dedicated column in the `hr_policies` table upon upload.
* **Public Bucket Privacy Risk**: 
  The preview functionality relies on the Google Docs Viewer. For Google's servers to read the PDF, the `hr-policies` storage bucket **must be public**. This means anyone on the internet who guesses or intercepts the URL can download sensitive company policies.
  * **Fix**: Use signed URLs for private buckets, or use a client-side PDF viewer library (like `react-pdf`) instead of relying on Google's external public viewer.
* **Client-Side Bulk Inserts (Notification Limits)**:
  When a policy is uploaded for "All Employees" in a company with thousands of employees, the frontend maps thousands of notification objects and does a bulk `.insert()` in one HTTP request. This can easily hit payload size limits or API timeouts.
  * **Fix**: Notifications should be offloaded to an Edge Function or a Database Trigger that runs asynchronously on the backend.
* **No File Size Validation**:
  There is no client-side check to restrict the maximum file size before upload. A user could accidentally upload a 500MB file, blocking the UI and consuming unnecessary bandwidth.
* **Local Filtering on Employee Side**:
  In `src/employee/Policies.tsx`, the query fetches *all* department-specific policies and then filters them locally in JavaScript (`filtered = data.filter(...)`). If there are hundreds of department-specific policies, the employee downloads all of them before discarding the ones not meant for their department.

---

### 4. Row-Level Security (RLS) & SQL Policies
The HRMS employs a strict Multi-Tenant RLS architecture to ensure data isolation.

* **Restrictive Tenant Isolation**:
  There is a global restrictive policy on the `hr_policies` table:
  ```sql
  CREATE POLICY tenant_active_restrictive ON public.hr_policies AS RESTRICTIVE 
  FOR ALL TO public 
  USING ((SELECT public.can_access_tenant(tenant_id))) 
  WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
  ```
  This ensures that no matter what other permissive policies exist, a user can **never** read, update, or delete a policy that does not belong to their company's `tenant_id`. The `tenant_id` is securely extracted from the user's JWT Auth Metadata via the `can_access_tenant()` helper.
* **Permissive Policies (Implied)**:
  * **Select**: Employees are granted `SELECT` access to policies where `tenant_id` matches theirs.
  * **Insert/Delete**: Restricted to users whose Auth metadata defines their role as HR/Admin.

### 5. Edge Functions
Currently, **no Edge Functions are utilized in this specific module**. 
The entire flow—file uploading, database row insertion, and notification dispatching—is handled directly from the client (Browser -> InsForge PostgREST API). 

As mentioned in the edge cases, moving the notification dispatching to a database trigger or an Edge Function would heavily optimize the performance and reliability of this feature for larger enterprises.


Team Calendar:-


I have completed a comprehensive audit of the Team Calendar logic on the HR side, including its core behavior, edge cases, good practices, Row-Level Security (RLS) policies, and backend functions. 

I've documented my full findings in this detailed report: audit_team_calendar

Here is a high-level summary of what I found:

### 1. What the Logic Does
The `HRCalendar` component (`src/hr/Calendar.tsx`) provides an HR-level view by determining each employee's daily status based on a priority hierarchy:
- **Holidays** override everything.
- **Leaves** and **Approved Events** are shown next.
- **Task Gates**: If an employee has any incomplete tasks (`assigned`, `in_progress`, or `rejected`), they are marked as **Incomplete (Red)**, *even if they were present*.
- **Attendance**: If they punched in, they are marked as present/approved.

### 2. Edge Cases and Potential Failures
- **URL Length Limits**: The component uses `.in.(id1, id2...)` to filter employees. For a large number of employees (>1000), the URL will become too long and crash the API request.
- **Missing Pagination**: The query `db.from("attendance").select("*")` has no `.limit()` or pagination. In large companies, this will hit PostgREST's 1000-row limit, silently dropping data for the rest of the month and falsely showing employees as absent.
- **Timezone Drift**: It uses the local browser's timezone (`new Date()`, `parseLocalDate`) to determine "Today", which might misalign calendar days if the HR admin is in a different timezone than the tenant/employees.
- **Overriding Actual Attendance**: If an employee punches in on a holiday, the calendar hides their attendance and just shows "Holiday". Similarly, missing a single task shows the day as "Incomplete", hiding the fact that they worked a full shift.

### 3. Good Practices Followed
- **O(1) Data Normalization**: Data arrays (attendance, leaves, tasks) are heavily normalized into `useMemo` lookup dictionaries (e.g. `attByDateEmp`), ensuring the UI grid renders efficiently without nested array scanning loops.
- **Concurrent Fetching**: Uses `Promise.all` to fetch all 5 data streams (attendance, tasks, leaves, events, holidays) in parallel.
- **Midnight Auto-Rollover**: A clever 60-second polling mechanism checks if the day has rolled over at midnight and updates the "Today" state, so the calendar doesn't go stale overnight.

### 4. Row-Level Security (RLS) & SQL Policies
The calendar interacts with highly restrictive SQL policies. Based on `insforge-enterprise-03-restrictive.sql`, all HR tables (`attendance`, `tasks`, `leaves`, `employees`, etc.) enforce a `RESTRICTIVE` policy named `tenant_active_restrictive`. This uses `public.can_access_tenant(tenant_id)` to guarantee that HR managers cannot fetch or view data belonging to a different tenant under any circumstances.

### 5. Edge Functions / Backend Jobs
The calendar's data is governed by robust backend database functions (seen in `insforge-task-policy-hardening.sql`):
- **Task Gate Enforcement (RPC)**: The `punch_out_attendance` RPC blocks employees from punching out if `tenant.punch_out_gate_enabled` is true and they have unresolved tasks on the calendar.
- **Auto Red-Marking (pg_cron)**: A periodic Postgres scheduler job (`fn_auto_redmark_tasks`) runs in the background to automatically flag tasks as `overdue` at the end-of-day (adjusted for tenant timezones and grace periods).



# HR Team Calendar Audit Report

## 1. Core Logic Overview
The `HRCalendar` component (`src/hr/Calendar.tsx`) provides an HR-level view of attendance, tasks, leaves, and holidays. It fetches data for a selected month, filters by department, and constructs a grid.

**Status Resolution Hierarchy:**
For any given day and employee, the component determines their status (`getEmpStatus`) in this priority order:
1. **Holiday:** If the day is a global holiday, it applies to everyone (White dot).
2. **Leave:** If an employee has an approved leave spanning the date (Blue dot).
3. **Approved Event:** If they have a "green" calendar event (Green dot).
4. **Task Gate/Block:** If the employee has any tasks due on that day that are in `assigned`, `in_progress`, or `rejected` state, their status is "incomplete" (Red dot), **even if they are present**.
5. **Attendance:** If they punched in ("present"), they are "approved" (Green dot). If their attendance says "on_leave", they are "leave" (Blue dot).
6. **Completed Tasks:** If they have tasks and all are "approved" or "submitted", they are "approved".
7. **Absent:** Default state if no records exist (Gray dot).

---

## 2. Identified Edge Cases & Failure Points

> [!WARNING]
> **Performance at Scale (Query URLs)**
> The frontend constructs a `.in.(id1, id2...)` filter for employees based on `involvedIds` derived from all fetched records. If there are thousands of unique employee IDs in a given month, the URL string length might exceed HTTP limits, causing the query to crash.

> [!WARNING]
> **Missing Pagination on Large Datasets**
> `db.from("attendance").select("*")` fetches all records for the month without limits. For a large enterprise, this will exceed PostgREST limits (default 1000 rows). This means data will be silently truncated, and employees will show as absent even if they were present.

> [!CAUTION]
> **Client-side Timezone vs DB Dates**
> `parseLocalDate` and local `Date` objects are used to compare dates (e.g., `isToday`). If an HR admin is in a different timezone than the tenant or the employee, the "today" status and calendar day matching might shift incorrectly, leading to misaligned dots.

> [!NOTE]
> **Task State Override Priority**
> An employee who works a full 8-hour shift but leaves one task incomplete will be shown as "Task Incomplete" (Red) rather than "Present" (Green). While this might be intentional to highlight task delinquency, it visually obscures their physical attendance presence.

> [!NOTE]
> **Holiday Blanket Coverage**
> A global holiday overrides everything. If an employee actually punches in on a holiday (e.g., working overtime, on-call support), the calendar will still just show "Holiday" and ignore their attendance presence in the UI calculation.

---

## 3. Good Practices Followed

> [!TIP]
> **Efficient UI Rendering with Normalization**
> The component transforms fetched arrays into normalized dictionaries (e.g., `attByDateEmp`, `tasksByDate`) using `useMemo`. This makes rendering the grid O(1) lookups per cell rather than O(n) array scans, significantly improving rendering performance.

- **Concurrent Fetching:** Uses `Promise.all` to fetch attendance, leaves, events, holidays, and tasks in parallel, improving initial load times.
- **Midnight Rollover Handling:** A clever 60-second `setInterval` checks if the local date string (`todayStr`) has changed, ensuring the calendar doesn't become stale if a user leaves the HR tab open overnight.
- **Rich Visual Feedback:** It uses a color-coded dot-indicator system to summarize the day compactly without overwhelming the grid, complemented by a detailed popup modal on click.

---

## 4. Row-Level Security (RLS) & SQL Policies

The system uses strong multi-tenant isolation policies defined in `insforge-enterprise-03-restrictive.sql` and `insforge-superadmin-setup.sql`.

- **Strict Tenant Isolation:** All relevant tables (`attendance`, `tasks`, `leaves`, `holidays`, `calendar_events`, `employees`) enforce a `RESTRICTIVE` policy named `tenant_active_restrictive`.
- **Policy Definition:** `USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)))`.
- **Impact:** This guarantees that an HR manager can never fetch or view calendar data belonging to another tenant, even if the frontend query accidentally omits the `tenant_id` filter.

---

## 5. Edge Functions & Backend Jobs

While the frontend component queries the database directly, the underlying data is governed by robust backend database functions (seen in `insforge-task-policy-hardening.sql`):

- **Task Gate Enforcement (RPC):** When an employee attempts to punch out, the `punch_out_attendance` RPC checks if `tenant.punch_out_gate_enabled` is true. If they have unresolved tasks on the calendar, it raises a `TASK_GATE_BLOCKED` exception, forcing them to complete tasks before punching out.
- **Auto Red-Marking (pg_cron Job):** The function `fn_auto_redmark_tasks` runs periodically via `pg_cron` (Postgres scheduler). It automatically updates task statuses to `overdue` and logs `tasks.auto_redmark_run` if a task is not submitted by the End-Of-Day (plus a grace period) based on the tenant's specific timezone settings. This acts as a background "edge" job entirely within the database.






The Team Calendar on the HR side is a central dashboard that doesn't just display data; it acts as an aggregation point for several core modules. Because of this, it is deeply interconnected with other systems.

Here is a breakdown of the modules that affect (or are affected by) the Team Calendar, their underlying logic, and the critical edge cases that arise from these integrations:

### 1. Attendance & Time Tracking (Punch In / Out)
* **How it affects the Calendar:** The calendar reads the `attendance` table to determine if an employee is present. If they have an attendance record for that day, they get a Green dot ("Approved").
* **Core Logic:** In `PunchInOut.tsx`, employees punch in/out. The backend uses the `punch_out_attendance` RPC to calculate `work_hours` and enforce "task gates" (preventing punch-out if tasks are pending).
* **Inter-module Edge Cases:**
  * **Geofence Blindspot:** If an employee punches in outside the geofence, the backend flags it as a violation (`outside_fence`). However, the Team Calendar logic only checks if `status === 'present'`, meaning HR will see a perfectly fine Green dot on the calendar, completely unaware of the location violation unless they check a different report.
  * **Client vs Backend Timezones:** The calendar uses the HR admin's local browser timezone (`new Date()`) to group dates. If the tenant's backend is in UTC, an attendance record created at 11:00 PM in New York might show up on the *next day* in the Calendar if the HR admin is in London.

### 2. Task Management 
* **How it affects the Calendar:** This is the most aggressive override in the calendar logic. The calendar queries the `tasks` table. If an employee has *any* task due on a given date with a status of `assigned`, `in_progress`, or `rejected`, the calendar forces their daily status to **Incomplete (Red dot)**.
* **Core Logic:** This is designed to visually alert HR to delinquent employees. There is also a backend `pg_cron` job (`fn_auto_redmark_tasks`) that auto-marks tasks as `overdue` at the end of the day.
* **Inter-module Edge Cases:**
  * **The "Yesterday" Loophole:** The calendar logic groups tasks by their *exact due date* (`tasksByDate[dateStr]`). If an employee fails to do a task on Monday, Monday shows as Red. But on Tuesday, if they have no new tasks due, Tuesday will show as Green (Present), even though Monday's task is still overdue and unresolved. 
  * **Attendance Erasure:** An employee can work a 10-hour shift and punch out correctly, but if they leave one minor task incomplete, the calendar shows them as Red ("Incomplete"). HR looking at the calendar might assume they were absent.

### 3. Leave Management
* **How it affects the Calendar:** The calendar queries the `leaves` table for `status = 'approved'` and paints those days Blue ("On Leave").
* **Core Logic:** The logic iterates from the leave's `start_date` to `end_date` and adds the employee to a "leave map".
* **Inter-module Edge Cases:**
  * **Cancelled but not Deleted Leaves:** If an employee's leave is approved, but they decide to come into work anyway and punch in, the Team Calendar logic evaluates Leaves *before* Attendance. It will show a Blue dot (Leave) and entirely hide the fact that the employee actually came to work and has a punch-in record.

### 4. Holiday Management
* **How it affects the Calendar:** The calendar reads the `holidays` table.
* **Core Logic:** A holiday is a blanket override. If a date is a holiday, the calendar immediately returns "Holiday" (White dot) for *every* employee and stops checking other tables.
* **Inter-module Edge Cases:**
  * **Holiday Overtime Blindspot:** If your company requires support staff or essential workers to punch in on a holiday (earning holiday overtime), the Team Calendar will fail to show this. It will just render the entire day as a Holiday for everyone, hiding the attendance records of the people who actually worked.

### 5. Payroll Module (Impacted by Calendar)
* **How it is affected:** The Team Calendar is the visual source of truth that HR uses to verify data before running payroll.
* **Inter-module Edge Cases:**
  * **Pagination Limits:** As noted in the audit, the Calendar fetches `db.from("attendance").select("*")` without pagination. PostgREST limits queries to 1000 rows by default. If a company has 500 employees, 2 days of attendance hits the limit. The calendar will silently truncate the data, showing hundreds of employees as "Absent". If HR runs payroll based on this visual confirmation, they could severely underpay their workforce.
  * **Visual Disconnect:** Payroll scripts typically calculate wages based on `work_hours` in the attendance table. But because the Calendar turns the day Red if a task is missed, HR might see a month full of Red dots and assume pay should be docked, while the Payroll system calculates full pay because the actual hours were worked.

---

## Known Discrepancies & Open Issues (Audit: 2026-05-31)

This section documents gaps found between what this document originally described and the actual state of the codebase.

### Fixed in Hardening Pass (2026-05-31)

| Issue | Location | Fix |
|---|---|---|
| `ADMIN_KEY` hard-coded in source | `functions/create-employee-user.ts:12` | Moved to `Deno.env.get("INSFORGE_ADMIN_KEY")`. Old key **must be rotated** in InsForge dashboard. |
| Anon key hard-coded in test scripts | `test-admin.js`, `test-admin2.js`, `test-api.js` | Replaced with `process.env.VITE_INSFORGE_ANON_KEY` read from `.env` (gitignored). |
| `approve_task_request` trusted frontend `p_hr_employee_id` | `insforge-tasks-rpc.sql` | Removed parameter; reviewer now derived via `auth.uid()` inside function. |
| `reject_task_request` trusted frontend `p_hr_employee_id` | `insforge-tasks-rpc.sql` | Same fix as above. |
| `submit_task_request` trusted frontend `p_employee_id` | `insforge-tasks-rpc.sql` | Removed parameter; submitter derived via `auth.uid()`. |
| `approve_leave_request` trusted frontend `p_hr_employee_id` | `update-approve-leave-request-rpc.sql` | Removed; reviewer derived via `auth.uid()` + role check. |
| Geofence strict mode was UI-only (no actual block) | `src/employee/PunchInOut.tsx:330` | Now hard-blocks punch-in **and** punch-out when `geofence_mode = 'strict'`. |
| HR manual attendance edit left `session_status = 'open'` | `src/hr/Attendance.tsx` `saveEdit()` | Now sets `session_status = 'closed'` when punch_out is saved. |

### Documentation Inaccuracies Corrected

| Claim in this document | Actual behaviour |
|---|---|
| "Secure Edge Functions" for `create-employee-user` | Admin key was hard-coded in plain text (now fixed). |
| `/hr/settings` described as a standalone Settings page | Route redirects to Policy Center (`App.tsx:146`). |
| Payroll described as "Coming Soon" | Payroll module is fully live at `/payroll`. |

### Remaining Open Issues (Not Fixed In This Pass)

| Issue | Location | Risk |
|---|---|---|
| Storage buckets `employee-documents`, `task-attachments`, `hr-policies` are **public** | InsForge Storage config | Any URL-holder can download docs without auth. Requires private buckets + signed-URL reads. |
| `MyLeaves.tsx` uses browser local year (`new Date().getFullYear()`) | `src/employee/MyLeaves.tsx` | At year boundaries, timezone-ahead employees see wrong year's balances. |
| No automated test suite | `package.json` | No test script. Auth, task approval, leave approval, and tenant isolation flows are untested in CI. |