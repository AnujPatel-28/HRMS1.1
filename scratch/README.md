# TalentMesh HRMS Hardened Workflow Regression Suite

This directory contains the testing and regression suite for the transaction-hardened atomic database workflows. These tests ensure that SQL RPCs (which enforce security, tenant boundaries, payroll locks, and calculations) continue to behave correctly through future schema updates or frontend modifications.

---

## 📂 Suite Directory Structure

*   **[`test-workflows-integration.sql`](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/scratch/test-workflows-integration.sql)**: A comprehensive PostgreSQL transaction-enclosed verification suite. It tests:
    1.  *Employee Leave Requests* (overlaps, consecutive limits, notice periods)
    2.  *HR Leave Approvals* (deducting balances, creating system-level `on_leave` attendance records)
    3.  *HR Leave Cancellations* (restoring balances, cleanly removing `on_leave` records)
    4.  *Shift Assignment Scheduler* (clearing Conflicts, closing old shift assignments, effective dates)
    5.  *Attendance Updates* (hours math, late grace minutes, break/lunch deductions)
*   **[`test-leave-approval.js`](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/scratch/test-leave-approval.js)**: Javascript API test script using the InsForge SDK client. Checks authentication-scoped leave approval/cancellation RPC actions.
*   **[`test-exceptions.js`](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/scratch/test-exceptions.js)**: Javascript API test script using the InsForge SDK client. Checks location exceptions, date bounds validation, and overlap protections.
*   **[`phase3_restrict_direct_hr_writes.sql`](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/scratch/phase3_restrict_direct_hr_writes.sql)**: The post-stabilization hardening script that revokes direct table mutation privileges on core tables, forcing the app to use the RPC endpoints.

---

## 🚀 Running the Tests

### 1. Database-Level Integration Tests (Recommended)
The database-level integration tests run inside a single **PostgreSQL Transaction Block** with `ROLLBACK` at the end. This allows you to verify all validations, constraints, side-effects, and calculations on production-like databases safely without polluting the database with test data.

To execute:
1. Copy the contents of [`test-workflows-integration.sql`](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/scratch/test-workflows-integration.sql).
2. Execute the script via your Database Management Tool (e.g. PgAdmin, DBeaver, or InsForge SQL Executor).
3. Verify that the output prints: `========== ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ==========`.

### 2. Client-Level SDK Tests
Client-level scripts test auth boundaries and SDK integration. 

To execute, run the following commands in the workspace root:
```bash
# Run leave approval SDK tests
node scratch/test-leave-approval.js

# Run exception and date-validation SDK tests
node scratch/test-exceptions.js
```
*(Ensure you have a `.env` file in the root containing active `VITE_INSFORGE_URL` and `VITE_INSFORGE_ANON_KEY` variables).*
