-- Security RLS Hardening — Sprint 1
-- Verified against production policy inventory on 2026-06-15
-- Rollback: 20260615120000_security_rls_hardening_rollback.sql
--
-- Closes authorization gaps on 5 tables where tenant_isolation (PERMISSIVE, ALL)
-- allowed any authenticated user in the same tenant full CRUD access.
-- Replaces with employee self-scoped reads + HR per-command policies +
-- restrictive tenant guards.

BEGIN;

-- ============================================================================
-- SAFETY CHECKS
-- Fail fast if environment doesn't match expectations.
-- ============================================================================
DO $$
BEGIN
  -- Table existence
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'overtime_records')
    THEN RAISE EXCEPTION 'SAFETY: overtime_records table not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'salary_structures')
    THEN RAISE EXCEPTION 'SAFETY: salary_structures table not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payslips')
    THEN RAISE EXCEPTION 'SAFETY: payslips table not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'attendance_breaks')
    THEN RAISE EXCEPTION 'SAFETY: attendance_breaks table not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'attendance_selfies')
    THEN RAISE EXCEPTION 'SAFETY: attendance_selfies table not found'; END IF;

  -- Helper function existence
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_hr')
    THEN RAISE EXCEPTION 'SAFETY: is_hr() function not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_access_tenant')
    THEN RAISE EXCEPTION 'SAFETY: can_access_tenant() function not found'; END IF;

  -- Pre-migration policy existence
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'overtime_records'  AND policyname = 'tenant_isolation')
    THEN RAISE EXCEPTION 'SAFETY: overtime_records.tenant_isolation not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'salary_structures' AND policyname = 'tenant_isolation')
    THEN RAISE EXCEPTION 'SAFETY: salary_structures.tenant_isolation not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payslips'           AND policyname = 'tenant_isolation')
    THEN RAISE EXCEPTION 'SAFETY: payslips.tenant_isolation not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_breaks'  AND policyname = 'tenant_isolation')
    THEN RAISE EXCEPTION 'SAFETY: attendance_breaks.tenant_isolation not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_selfies' AND policyname = 'selfies_tenant_isolation')
    THEN RAISE EXCEPTION 'SAFETY: attendance_selfies.selfies_tenant_isolation not found'; END IF;
END $$;

-- ============================================================================
-- overtime_records
-- Before: 1 policy — tenant_isolation (PERMISSIVE, authenticated, ALL)
-- After:  self_read (SELECT, employee-owned) +
--         hr_select/insert/update/delete (per-command, HR-only) +
--         overtime_restrictive (RESTRICTIVE, tenant gate)
-- ============================================================================
DROP POLICY IF EXISTS tenant_isolation ON public.overtime_records;

CREATE POLICY overtime_self_read ON public.overtime_records
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = overtime_records.employee_id
      AND e.user_id = auth.uid()
  ));

CREATE POLICY overtime_hr_select ON public.overtime_records
  FOR SELECT TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY overtime_hr_insert ON public.overtime_records
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY overtime_hr_update ON public.overtime_records
  FOR UPDATE TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY overtime_hr_delete ON public.overtime_records
  FOR DELETE TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY overtime_restrictive ON public.overtime_records
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT can_access_tenant(tenant_id)));

-- ============================================================================
-- salary_structures
-- Before: 2 policies — tenant_isolation (PERMISSIVE, auth, ALL) +
--          tenant_active_restrictive (RESTRICTIVE, public, ALL)
-- After:  self_read (SELECT, employee-owned) +
--         hr_select/insert/update/delete (per-command, HR-only) +
--         keep existing tenant_active_restrictive
-- ============================================================================
DROP POLICY IF EXISTS tenant_isolation ON public.salary_structures;

CREATE POLICY salary_self_read ON public.salary_structures
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = salary_structures.employee_id
      AND e.user_id = auth.uid()
  ));

CREATE POLICY salary_hr_select ON public.salary_structures
  FOR SELECT TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY salary_hr_insert ON public.salary_structures
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY salary_hr_update ON public.salary_structures
  FOR UPDATE TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY salary_hr_delete ON public.salary_structures
  FOR DELETE TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

-- ============================================================================
-- payslips
-- Before: 3 policies — tenant_isolation (PERMISSIVE, auth, ALL) +
--          employee_own_payslips (PERMISSIVE, auth, SELECT) +
--          tenant_active_restrictive (RESTRICTIVE, public, ALL)
-- After:  keep employee_own_payslips (already correct for SELECT) +
--         hr_select/insert/update/delete (per-command, HR-only) +
--         keep existing tenant_active_restrictive
-- ============================================================================
DROP POLICY IF EXISTS tenant_isolation ON public.payslips;

CREATE POLICY payslips_hr_select ON public.payslips
  FOR SELECT TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY payslips_hr_insert ON public.payslips
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY payslips_hr_update ON public.payslips
  FOR UPDATE TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

CREATE POLICY payslips_hr_delete ON public.payslips
  FOR DELETE TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

-- ============================================================================
-- attendance_breaks
-- Before: 3 policies — tenant_isolation (PERMISSIVE, auth, ALL) +
--          breaks_hr_all (PERMISSIVE, auth, ALL) +
--          breaks_self_read (PERMISSIVE, auth, SELECT)
-- After:  RPC-only for employee writes (start/end_employee_break).
--         HR via existing breaks_hr_all.
--         Employee SELECT via existing breaks_self_read.
--         New breaks_restrictive (RESTRICTIVE, tenant gate).
-- No self-write policy: direct writes would bypass RPC business logic
-- (double-click protection, duration calc, active break constraints).
-- ============================================================================
DROP POLICY IF EXISTS tenant_isolation ON public.attendance_breaks;

CREATE POLICY breaks_restrictive ON public.attendance_breaks
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT can_access_tenant(tenant_id)));

-- ============================================================================
-- attendance_selfies
-- Before: 4 policies — selfies_tenant_isolation (PERMISSIVE, auth, ALL) +
--          selfies_hr_all (PERMISSIVE, auth, ALL) +
--          selfies_self_read (PERMISSIVE, auth, SELECT) +
--          selfies_tenant_active_restrictive (RESTRICTIVE, public, ALL)
-- After:  self_insert (INSERT, ownership validated through attendance_id) +
--         keep existing selfies_self_read, selfies_hr_all,
--               selfies_tenant_active_restrictive
-- ============================================================================
DROP POLICY IF EXISTS selfies_tenant_isolation ON public.attendance_selfies;

CREATE POLICY selfies_self_insert ON public.attendance_selfies
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.attendance a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.id = attendance_selfies.attendance_id
      AND e.user_id = auth.uid()
  ));

COMMIT;

-- ============================================================================
-- Post-deployment verification (run after apply)
-- ============================================================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE tablename IN ('overtime_records','salary_structures','payslips',
--                     'attendance_breaks','attendance_selfies')
-- ORDER BY tablename, policyname;
