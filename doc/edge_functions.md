# TalentMesh HRMS Serverless Edge Functions Documentation

> **Last verified against live InsForge backend:** 2026-06-23
> All functions below are confirmed active via `npx insforge functions list`.

---

## ⚙️ Runtime & Architecture Overview

All backend logic that requires high privileges, administrative access (e.g., creating accounts, updating credentials), external integrations, or scheduled events is offloaded to **InsForge Edge Functions**.

* **Runtime**: Deno (written in TypeScript/JavaScript, utilizing Deno standard libraries and npm modules directly via the `npm:` prefix).
* **Communication**: Functions expose HTTP endpoints with CORS enabled, allowing direct calls from the React frontend.
* **Database Client**: Uses `@insforge/sdk` initialized with either the caller's JWT token (for user-level queries) or an admin key (for database overrides).

---

## 🔒 Security, Authorization & Rate Limiting

The live Edge Functions implement a multi-layered security model:

1. **CORS Guard**: Explicitly intercepts preflight `OPTIONS` requests returning a `204 No Content` to allow cross-origin browser requests safely.
2. **Caller Identity Verification**: Mutating functions extract the `Authorization: Bearer <token>` header, initialize the InsForge client, and fetch the caller details:
   ```typescript
   const client = createClient({ baseUrl: BASE_URL, edgeFunctionToken: callerToken });
   const { data: userData } = await client.auth.getCurrentUser();
   ```
   The caller's role (e.g., `hr`) and tenant context are verified against the input parameters to prevent cross-tenant request forgery.
3. **Database Rate Limiting**: Administrative functions call the PostgreSQL database RPC `check_rate_limit` before execution:
   ```typescript
   const { data: rateLimitOk } = await client.database.rpc("check_rate_limit", {
     p_tenant_id: tenantId,
     p_user_id: actorId,
     p_endpoint: 'function-slug',
     p_max_requests: 20,
     p_window_interval: '1 hour'
   });
   ```

---

## ✅ Live Database Schema Alignment Verification

During synchronization analysis, the database schema of the live InsForge project was validated against the serverless functions:
1. **Settings Table**: `tenant_settings` is structured as a key-value pair table (`id`, `tenant_id`, `key`, `value`, `updated_at`).
2. **Settings Queries**: Both the local file ([calculate-late-marks.ts](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/functions/calculate-late-marks.ts)) and the live deployed code correctly query `tenant_settings` using `.select("key,value").in("key", ["late_mark_threshold", "late_mark_deduction_hours"])`.
3. **Alignment**: The local code and the live deployed environment are **100% in alignment** with the actual schema.

---

## 📦 Complete Live Function Inventory

> 20 functions are currently active on the live backend (verified 2026-06-23).

---

### 1. Authentication & Platform Access

#### `auth-signup` *(active since 17/6/2026)*
Handles candidate/public user self-registration flow.
* **Operations**: Creates an auth account and profile record via a single HTTP call. Returns session tokens on success.

#### `auth-verify` *(active since 17/6/2026)*
Email OTP verification for newly registered users.
* **Operations**: Forwards the OTP code to the InsForge auth verification endpoint. Returns a session on success.

#### `auth-session` *(active since 5/6/2026)*
Refreshes or validates an existing JWT session token.
* **Operations**: Takes a refresh token, returns a new access token if the session is still valid.

#### `admin-auth-login` *(active since 17/6/2026)*
Dedicated login endpoint for platform-level admins.
* **Operations**: Validates credentials against `platform_admins` table. Returns an elevated JWT with superadmin metadata.

---

### 2. Employee Onboarding Flow

#### `create-employee-user`
Triggered during Step 4 of the HR Add Employee wizard. Sets up the authentication user.
* **Operations**:
  * Enforces `hr` authorization check.
  * Checks if the email is already in use by an active employee in *any* tenant (using database RPC `check_employee_exists_by_email`) to prevent cross-tenant duplicates.
  * Safely cleans up abandoned onboarding accounts: If an auth account exists for that email but has no corresponding employee profile, it is deleted and re-created (immediately if the same tenant, or after 30 minutes if orphaned elsewhere).
  * Creates the auth user in InsForge Auth with `metadata: { role: 'employee', tenant_id: tenantId }`. This triggers a 6-digit verification code email to the employee.
  * Initializes the `employee_onboarding` tracker table with a status of `pending_auth`.

#### `verify-employee-code`
Validates the OTP entered by HR during employee creation.
* **Operations**:
  * Forwards the 6-digit code to the auth endpoint `/api/auth/email/verify`.
  * On success, updates the `employee_onboarding` table status to `otp_verified`.
  * Logs a `critical` event in `audit_logs`.

#### `set-employee-password`
Configures the initial password for the onboarded employee.
* **Operations**:
  * Receives the temp password, hashes it using `bcryptjs` with 10 salt rounds.
  * Invokes the database RPC `set_employee_password_by_hr` using the caller's HR token. The database verifies both users share the same tenant ID before updating.
  * On success, updates the `employee_onboarding` table status to `password_set`.

#### `finalize-onboarding`
Concludes the onboarding process once the React client inserts the full employee record in the `employees` table.
* **Operations**:
  * Resolves the target user ID and updates the `employee_onboarding` table status to `active`.

#### `create-hr-admin-user` *(active since 12/5/2026)*
Creates the first HR admin account for a newly provisioned tenant.
* **Operations**:
  * Called during tenant self-service signup. Creates auth user with `role: 'hr'` and seeds the initial `tenants` and `employees` rows.
  * Only callable with a platform-level service key (not user-callable).

---

### 3. Time & Attendance Rules

#### `calculate-late-marks`
Invoked during payroll calculation to retrieve late count metrics.
* **Operations**:
  * Counts all non-absent, non-half_day attendance records for an employee within a month range where `is_late` is `true`.
  * Compares count against the tenant's `late_mark_threshold` from `tenant_settings`.
  * Deducts hours (`excess_late_marks * late_mark_deduction_hours`) and returns parameters.
  * **Key query pattern**:
    ```typescript
    await client.database
      .from('tenant_settings')
      .select('key,value')
      .eq('tenant_id', tenantId)
      .in('key', ['late_mark_threshold', 'late_mark_deduction_hours'])
    ```

#### `check-punch-out-gate`
Polled by the frontend when an employee attempts to clock out.
* **Operations**:
  * Reads `tenant_settings` key `task_gate_enabled`.
  * If enabled, queries the `tasks` table for any tasks `assigned_to` the employee due today that are in any status other than `approved` (e.g. `assigned`, `submitted`, `rejected`, `overdue`).
  * Also checks the `attendance.punch_out_allowed` override flag (set to `true` by `on-task-approved`).
  * Returns `punch_out_allowed: true/false` and the list of blocking pending tasks.

#### `daily-incomplete-task-marker`
Scheduled cron job that runs nightly to mark delinquent task states on the calendar.
* **Operations**:
  * Authenticates using a high-security `CRON_SECRET` header.
  * Iterates through all `active` tenants.
  * Queries all tasks due today that are NOT `approved`.
  * For the assigned employees who were clocked in today (`attendance` record exists), it upserts a `calendar_events` record with type `red` and description `'Incomplete tasks due today'`, and sets `tasks.auto_red_marked_at` timestamp.

---

### 4. Task Workflow Event Handlers

#### `on-task-assigned`
* **Trigger**: Task creation.
* **Operations**: Sends a realtime workspace notification of type `task_assigned` to the target employee's notifications center.

#### `on-task-approved`
* **Trigger**: HR approves a task submission.
* **Operations**:
  * Updates `attendance.punch_out_allowed = true` for the employee for today, resolving the Task Gate.
  * Upserts a `calendar_events` event with type `green` (complete).
  * Sends a `punch_unlock` notification to the employee.

#### `on-task-rejected`
* **Trigger**: HR rejects a task submission.
* **Operations**:
  * Updates the task status back to `assigned`.
  * Sends a `task_rejected` notification containing the reviewer's feedback notes.

---

### 5. Leave Management

#### `on-leave-reviewed`
* **Live Status**: **DEPRECATED / REDIRECTED**
  * Returns `HTTP 410 Gone`. All leave verification, approval/rejection, and balance updates are now run inside the atomic database SQL RPC `approve_leave_request` to ensure transactional integrity.

#### `send-leave-review-notification` *(embedded within leave approval flow)*
* Sends a notification to the employee indicating the approved/rejected status of their leave request.
* Called internally after the `approve_leave_request` RPC completes.

---

### 6. Co-Hosted Candidate/Recruiter Portal Functions

> **⚠️ NOT part of the HRMS.** These 6 functions are deployed on the same InsForge backend URL but belong to a completely separate Candidate/Recruiter portal product. They are verified to have **zero references** in:
> - Any HRMS migration SQL files (no `candidate_profiles`, `jobs`, `companies`, `resume_access_log` tables)
> - Any HRMS frontend source (`src/`) files
> - Any HRMS shared types or hooks
>
> These functions operate on their own isolated tables (`candidate_profiles`, `jobs`, `companies`, `audit_log`) which are distinct from the HRMS `audit_logs` table. They are listed here only because they appear in `npx insforge functions list` output on this backend.

#### `candidate-profile` *(active since 4/6/2026)*
CRUD handler for candidate profile data (bio, skills, experience). Uses `candidate_profiles` table. **Not an HRMS table.**

#### `candidate-dashboard` *(active since 6/6/2026)*
Returns aggregated stats for a candidate's job application pipeline.

#### `candidate-applications` *(active since 11/6/2026)*
Handles job application submission and status fetching for candidates. Uses `jobs` and `companies` tables.

#### `resume-proxy` *(active since 11/6/2026)*
Secure proxy to serve resume files from InsForge Storage without exposing raw storage URLs.

#### `recruiter-document-proxy` *(active since 12/6/2026)*
Secure proxy for recruiters to access candidate documents. Checks caller role against `profiles.role` (not HRMS `employees` table). Logs access to `audit_log` (singular, not the HRMS `audit_logs` table).

#### `recommendations` *(active since 13/6/2026)*
Job recommendation engine for candidates. Reads `candidate_profiles` for the user's skills, then fetches matching `jobs` from the `jobs` table and ranks them by skill-overlap score in JavaScript. No OpenRouter/AI calls — pure database-driven ranking in the current live version.

---

## 🛠️ Developer CLI Toolkit

Developers can manage, test, and debug Edge Functions using the InsForge CLI:

```bash
# List all deployed functions in your project
npx insforge functions list

# Fetch and inspect the exact live code of a deployed function
npx insforge functions code <function-slug>

# Deploy a local function file to the InsForge backend
npx insforge functions deploy <function-slug>

# Invoke a function locally or on the cloud with a JSON payload
npx insforge functions invoke <function-slug> --json '{"tenant_id": "...", ...}'
```

---

## 🗺️ Function → Database Table Dependency Map

| Function | Reads From | Writes To |
|---|---|---|
| `create-employee-user` | `employees`, `employee_onboarding` | `employee_onboarding`, auth |
| `verify-employee-code` | `employee_onboarding` | `employee_onboarding`, `audit_logs` |
| `set-employee-password` | — | `employee_onboarding` (via RPC) |
| `finalize-onboarding` | `employee_onboarding` | `employee_onboarding` |
| `calculate-late-marks` | `attendance`, `tenant_settings` | — (read-only, returns data) |
| `check-punch-out-gate` | `tasks`, `attendance`, `tenant_settings` | — (read-only) |
| `on-task-approved` | `tasks`, `attendance` | `attendance`, `calendar_events`, `notifications` |
| `on-task-rejected` | `tasks` | `tasks`, `notifications` |
| `on-task-assigned` | `employees` | `notifications` |
| `daily-incomplete-task-marker` | `tenants`, `tasks`, `attendance` | `calendar_events`, `tasks` |
| `on-leave-reviewed` | — | — (deprecated, 410 Gone) |

### Co-Hosted Recruitment Portal Functions (separate product, different tables)

| Function | Reads From | Writes To |
|---|---|---|
| `candidate-profile` | `candidate_profiles` | `candidate_profiles` |
| `candidate-dashboard` | `candidate_profiles`, `jobs` | — |
| `candidate-applications` | `jobs`, `companies` | application tables |
| `resume-proxy` | InsForge Storage | — |
| `recruiter-document-proxy` | `profiles` (portal auth), InsForge Storage | `audit_log` (singular) |
| `recommendations` | `candidate_profiles`, `jobs`, `companies` | — |
