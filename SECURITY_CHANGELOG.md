# Security Changelog

This document tracks all security-related database migrations, RLS policy updates, hardening actions, and verification results for the TalentMesh HRMS backend.

## Changelog Inventory

| Date | Migration File | Target Objects | Risk Level | Rollback File | Smoke Test Result | Production Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **2026-06-23** | `20260623190800_db_performance_tuning.sql` | `task_submissions`, `salary_structures`, `payslips`, `employee_shifts`, `attendance_corrections`, `leave_balances`, `overtime_records`, `employee_documents`, `attendance_breaks`, `attendance_selfies` | 🟢 Low (Adds performance indexes to secondary columns & FKs to speed up RLS evaluation) | N/A | Passed (All index creations verified live via schema lookup) | Deployed |
| **2026-06-15** | `20260615120000_security_rls_hardening.sql` | `overtime_records`, `salary_structures`, `payslips`, `attendance_breaks`, `attendance_selfies` | 🔴 High (Enforces employee self-scoped reads, HR-only policies, and restrictive tenant gates; removes wide open permissive ALL policies) | `20260615120000_security_rls_hardening_rollback.sql` | Passed (Verified live; details logged in `LIVE_RLS_VERIFICATION.md`) | Deployed |
| **2026-05-31** | `20260531203000_storage-rls-hardening.sql` | `employee-documents`, `attendance-selfies`, `payslips` buckets | 🟡 Medium (Adds storage policy boundaries for user files) | N/A | Passed (Manual upload/download checks pass) | Deployed |
| **2026-05-31** | `20260531201000_storage-hardening.sql` | Storage buckets | 🟡 Medium (Hardens base upload rules) | N/A | Passed | Deployed |
| **2026-05-31** | `20260531200000_harden_hr_onboarding.sql` | `employees`, `public.set_employee_password_by_hr` | 🟡 Medium (Adds unique code indexes and locks password resets to matching tenant IDs) | N/A | Passed (Verified onboarding wizards) | Deployed |
| **2026-05-13** | `20260513124500_harden-hr-password-reset-linking.sql` | `public.set_employee_password_by_hr` | 🟡 Medium (Enforces explicit search_path and restricts executes) | N/A | Passed | Deployed |

---

## Guidelines for Adding Entries
1. Every migration that alters tables, RLS policies, or SECURITY DEFINER functions **must** be logged here before deploying.
2. Record the **Risk Level**:
   * 🔴 **High**: RLS updates replacing permissive policies, altering default-deny boundaries, or dropping table-level access rules.
   * 🟡 **Medium**: Trigger creation, storage bucket policy updates, or helper function privileges.
   * 🟢 **Low**: Performance indexes, check constraints, or column additions.
3. Reference the exact **Rollback File** where applicable to ensure rapid recovery in case of production regression.
