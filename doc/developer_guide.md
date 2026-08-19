# 🛠️ Developer Environment, CLI Commands & Deployment Guide

This document details the configuration settings, testing processes, and deployment commands required to maintain the TalentMesh HRMS application and its integration with the InsForge BaaS backend.

---

## ⚙️ 1. Local Environment Configuration

The application uses environment variables loaded at runtime for API connection and subdomain routing rules.

### Environment Keys Dictionary (`.env`)
Create a `.env` file in the root workspace directory based on `.env.example`:

* **`VITE_INSFORGE_URL`** (e.g., `https://rq3qmu8y.ap-southeast.insforge.app`)
  The base REST API and WebSocket gateway URL for your InsForge project environment.
* **`VITE_INSFORGE_ANON_KEY`** (JWT Token string)
  The client-safe API key used to instantiate the client and execute operations subject to Row-Level Security (RLS).
* **`VITE_DEFAULT_TENANT_ID`** (UUID string, e.g., `111035ce-979c-429a-a482-ddfa87dbfe6e`)
  The fallback tenant ID used during local development when the caller context does not carry a resolved subdomain.
* **`VITE_BASE_DOMAIN`** (e.g., `hrms.talentmeshsolutions.com` or `localhost:5173`)
  The root domain value used by the frontend routing parser to extract tenant subdomains.

### Subdomain Routing Simulation
The application resolves tenant contexts dynamically by inspecting the current URL hostname:
* **Production**: `https://<tenant-subdomain>.hrms.talentmeshsolutions.com`
  The host parser extracts the subdomain prefix and queries the database for matching tenant configurations.
* **Local Development**: `http://localhost:5173`
  Since local environments run on a single port without default subdomains, the frontend resolves the active tenant ID using the fallback `VITE_DEFAULT_TENANT_ID` environment key, ensuring developer productivity without local DNS maps.

---

## 🧪 2. Workflows Integration Testing

The workspace includes integration test scripts in the `scratch/` folder to validate database constraints, RPCs, and RLS policies.

### Test Execution Command
To run the automated integration checks:
```bash
npm run test:hrms-workflows
```
This script executes two core validation suites sequentially using Node.js:
1. `node scratch/test-exceptions.js`
2. `node scratch/test-leave-approval.js`

### Test Suite Descriptions

#### A. Exceptions Validation ([test-exceptions.js](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/scratch/test-exceptions.js))
* **Invalid Date Range Check**: Attempts to insert a location exception where `end_date < start_date` to verify that the database constraint blocks the write.
* **Valid Exception Check**: Inserts a valid exception row and verifies success.
* **Overlap Check**: Attempts to query for overlapping exceptions in the same date ranges, validating SQL logic.
* **Soft-Cancellation**: Updates exception status to `'cancelled'` and verifies timestamps.
* **Clean-up**: Deletes the created test records to maintain a clean database state.

#### B. Leave Approvals Validation ([test-leave-approval.js](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/scratch/test-leave-approval.js))
* **HR Authentication**: Logs in using HR credentials (`patelmanya59@gmail.com`).
* **Leave Approval RPC**: Invokes database function `public.approve_leave_request` and asserts that the status updates to `'approved'`.
* **Leave Cancellation RPC**: Invokes `public.cancel_leave_request` and asserts that the status transitions to `'rejected'`.

---

## 💻 3. InsForge CLI Infrastructure Commands

Database schema modifications and serverless Edge Function updates are managed through the InsForge CLI tool.

### A. Database Migrations
Migrations are structured SQL scripts located in the `/migrations` folder. To apply changes to the live PostgreSQL database:

1. **Test Query execution**:
   Run queries directly against the database to test changes:
   ```bash
   npx insforge db query --sql "SELECT * FROM public.tenants LIMIT 5;"
   ```
2. **Applying Migrations**:
   Execute the migration files in order of their timestamp prefixes (e.g. `20260615120000_security_rls_hardening.sql`) using the query tool:
   ```bash
   npx insforge db query --file ./migrations/20260615120000_security_rls_hardening.sql
   ```

### B. Deploying Edge Functions
Backend Edge Functions are stored under the `/functions` directory. To deploy or update a function:

1. **Deploy Command**:
   ```bash
   npx insforge functions deploy <function-name> --source ./functions/<function-name>.ts
   ```
   *Example*:
   ```bash
   npx insforge functions deploy calculate-late-marks --source ./functions/calculate-late-marks.ts
   ```
2. **Environment Secrets Configuration**:
   Function secrets (such as administrative API keys) must be set in the InsForge dashboard or updated via CLI:
   ```bash
   npx insforge secrets set INSFORGE_ADMIN_KEY="your-admin-key"
   ```

---

## 📁 4. Storage Buckets & Deployments

### Active Storage Buckets
The application utilizes three dedicated file storage buckets configured in the InsForge BaaS:

1. **`employee-profile-photos`**:
   * *Purpose*: Stores employee avatar images.
   * *Upload path*: `/employee-profile-photos/<tenant_id>/<employee_id>/<random_uuid>.<ext>`
2. **`employee-documents`**:
   * *Purpose*: Stores official onboarding/KYC documents (Aadhaar, PAN, banking receipts).
   * *Upload path*: `/employee-documents/<tenant_id>/<employee_id>/<random_uuid>.<ext>`
3. **`attendance-selfies`**:
   * *Purpose*: Stores facial verification snapshots captured during clock-in/out actions.
   * *Upload path*: `/attendance-selfies/<tenant_id>/<employee_id>/<attendance_id>/[punch_in|punch_out].jpg`

### Frontend Production Deployment
To compile and deploy the frontend application:

1. **Local Build Compilation**:
   ```bash
   npm run build
   ```
   This compiles the React 19 source code, checks types, and bundles assets into the `/dist` directory.
2. **Deploy to InsForge Hosting**:
   Deploy the compiled `/dist` bundle to the InsForge CDN:
   ```bash
   npx insforge deploy --dir ./dist
   ```
