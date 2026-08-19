-- Rollback SQL Script for Releases 6A through 7 Hardening Changes
--
-- This script reverses the RLS policy tightening, triggers, and schema alterations
-- introduced during the People Suite Hardening.
-- Run this ONLY in case of critical production regressions.

BEGIN;

-- ==========================================
-- 1. Rollback Release 6B: RLS Revocation
-- ==========================================
-- Re-create the permissive tenant_isolation policy on public.employees
-- to restore broad select access to standard employees.
DROP POLICY IF EXISTS tenant_isolation ON public.employees;
CREATE POLICY tenant_isolation ON public.employees
  FOR ALL
  TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

-- ==========================================
-- 2. Rollback 6B-Hardening: Trigger Restrictions
-- ==========================================
-- Drop the trigger restricting self-profile updates on administrative fields.
DROP TRIGGER IF EXISTS employees_update_restrictions_trigger ON public.employees;
DROP FUNCTION IF EXISTS public.enforce_employee_update_restrictions();

-- ==========================================
-- 3. Rollback Release 7: Exit Interview Data
-- ==========================================
-- Drop the exit interview transactional functions
DROP FUNCTION IF EXISTS public.update_exit_interview_transaction(uuid, jsonb);

-- Drop columns added for Exit Interview structured data
ALTER TABLE public.exit_requests 
  DROP COLUMN IF EXISTS exit_interview_data,
  DROP COLUMN IF EXISTS exit_interview_completed_at,
  DROP COLUMN IF EXISTS exit_interview_completed_by;

-- ==========================================
-- 4. Rollback Release 6A: Clearance Snapshot
-- ==========================================
-- Drop column added for exit clearances requirement snapshot
ALTER TABLE public.exit_clearances
  DROP COLUMN IF EXISTS is_required;

-- ==========================================
-- 5. Restore Old Function Signatures
-- ==========================================
-- Note: Restore pg_proc definitions for complete_exit_transaction and 
-- update_exit_clearance_transaction from scratch/preprod_backup_export.json if required.

COMMIT;
