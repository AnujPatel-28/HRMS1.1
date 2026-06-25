-- Rollback: Sprint 1 RLS Hardening
-- Restores policies exactly as exported from production on 2026-06-15.
-- Verified via pg_get_expr: all USING/WITH CHECK expressions match production.
-- Drops all policies created by the forward migration.
--
-- Applied via: 20260615120000_security_rls_hardening.sql

BEGIN;

-- ============================================================================
-- overtime_records
-- Restore tenant_isolation (PERMISSIVE, authenticated, ALL)
-- Expression: tenant_id = get_auth_tenant_id()
-- ============================================================================
DROP POLICY IF EXISTS overtime_self_read ON public.overtime_records;
DROP POLICY IF EXISTS overtime_hr_select ON public.overtime_records;
DROP POLICY IF EXISTS overtime_hr_insert ON public.overtime_records;
DROP POLICY IF EXISTS overtime_hr_update ON public.overtime_records;
DROP POLICY IF EXISTS overtime_hr_delete ON public.overtime_records;
DROP POLICY IF EXISTS overtime_restrictive ON public.overtime_records;

CREATE POLICY tenant_isolation ON public.overtime_records
  FOR ALL TO authenticated
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());

-- ============================================================================
-- salary_structures
-- Restore tenant_isolation (PERMISSIVE, authenticated, ALL)
-- Expression: (SELECT can_access_tenant(salary_structures.tenant_id))
-- ============================================================================
DROP POLICY IF EXISTS salary_self_read ON public.salary_structures;
DROP POLICY IF EXISTS salary_hr_select ON public.salary_structures;
DROP POLICY IF EXISTS salary_hr_insert ON public.salary_structures;
DROP POLICY IF EXISTS salary_hr_update ON public.salary_structures;
DROP POLICY IF EXISTS salary_hr_delete ON public.salary_structures;

CREATE POLICY tenant_isolation ON public.salary_structures
  FOR ALL TO authenticated
  USING ((SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT can_access_tenant(tenant_id)));

-- ============================================================================
-- payslips
-- Restore tenant_isolation (PERMISSIVE, authenticated, ALL)
-- Expression: (SELECT can_access_tenant(payslips.tenant_id))
-- ============================================================================
DROP POLICY IF EXISTS payslips_hr_select ON public.payslips;
DROP POLICY IF EXISTS payslips_hr_insert ON public.payslips;
DROP POLICY IF EXISTS payslips_hr_update ON public.payslips;
DROP POLICY IF EXISTS payslips_hr_delete ON public.payslips;

CREATE POLICY tenant_isolation ON public.payslips
  FOR ALL TO authenticated
  USING ((SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT can_access_tenant(tenant_id)));

-- ============================================================================
-- attendance_breaks
-- Restore tenant_isolation (PERMISSIVE, authenticated, ALL)
-- Expression: tenant_id = get_auth_tenant_id()
-- ============================================================================
DROP POLICY IF EXISTS breaks_restrictive ON public.attendance_breaks;

CREATE POLICY tenant_isolation ON public.attendance_breaks
  FOR ALL TO authenticated
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());

-- ============================================================================
-- attendance_selfies
-- Restore selfies_tenant_isolation (PERMISSIVE, authenticated, ALL)
-- Expression: tenant_id = get_auth_tenant_id()
-- ============================================================================
DROP POLICY IF EXISTS selfies_self_insert ON public.attendance_selfies;

CREATE POLICY selfies_tenant_isolation ON public.attendance_selfies
  FOR ALL TO authenticated
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());

COMMIT;
