-- migration: C7 -- PERMISSIVE tenant-only write policies become fences + explicit grants
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C7 section (found by the lead during C3).
--
-- A tenant rule written PERMISSIVE FOR ALL grants every employee in the tenant full write access.
-- Measured on TB-M1M2 2026-09-23 (tests/m1m2/c7_tenant_write_policies.mjs, pre-migration run), as
-- the plain employee `employee.a`:
--   * created rows in shifts, office_locations, employee_shifts, payroll_runs,
--     it_declaration_windows, it_declarations (for HR), attendance_location_exceptions (an
--     already-APPROVED exception for themself = geofence self-bypass), employee_onboarding;
--   * updated AND deleted others' rows in shifts (the delete cascaded employee_shifts),
--     office_locations (moves the geofence), payroll_runs (status -> paid), it_declaration_windows,
--     attendance_location_exceptions, employee_onboarding;
--   * read colleagues' attendance_location_exceptions.
-- employee_policy_acknowledgements had the same grant (INSERT for a colleague stopped only by an FK).
--
-- Kept, because the app uses them (grep of src/ and functions/, 2026-09-23):
--   employees read shifts / office_locations / own employee_shifts (useEmployeeShift, PunchInOut),
--   payroll_runs status (MyPayslips), it_declaration_windows (TaxDeclaration); employees write their
--   own it_declarations and acknowledgements (existing *_self policies). HR writes every table from
--   the HR portal; create-employee-user writes employee_onboarding with the HR caller's token.
--   Edge functions using the admin key and SECURITY DEFINER RPCs are unaffected by RLS.
--
-- House form: RESTRICTIVE tenant fence + `<table>_hr_all` (can_access_tenant AND is_hr) +
-- narrow read policies. No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

-- ── attendance_location_exceptions: hr_all + self_read + restrictive fence already exist ───────
DROP POLICY exceptions_tenant_isolation ON public.attendance_location_exceptions;

-- ── employee_policy_acknowledgements: self ALL + HR SELECT + restrictive fence already exist ──
DROP POLICY tenant_isolation ON public.employee_policy_acknowledgements;

-- ── it_declarations: self ALL + hr_all exist; add the fence ──────────────────────────────────
DROP POLICY declarations_tenant_isolation ON public.it_declarations;
CREATE POLICY tenant_active_restrictive ON public.it_declarations AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(it_declarations.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(it_declarations.tenant_id)));

-- ── it_declaration_windows: HR manages (windows_hr_manage); employees read ───────────────────
DROP POLICY windows_tenant_isolation ON public.it_declaration_windows;
CREATE POLICY tenant_active_restrictive ON public.it_declaration_windows AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(it_declaration_windows.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(it_declaration_windows.tenant_id)));
CREATE POLICY it_declaration_windows_tenant_select ON public.it_declaration_windows FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- ── payroll_runs: restrictive fence exists; HR writes, employees read status ─────────────────
DROP POLICY tenant_isolation ON public.payroll_runs;
CREATE POLICY payroll_runs_hr_all ON public.payroll_runs FOR ALL TO authenticated
  USING ((SELECT public.can_access_tenant(payroll_runs.tenant_id)) AND (SELECT public.is_hr()))
  WITH CHECK ((SELECT public.can_access_tenant(payroll_runs.tenant_id)) AND (SELECT public.is_hr()));
CREATE POLICY payroll_runs_tenant_select ON public.payroll_runs FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- ── shifts: HR writes, employees read ────────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON public.shifts;
CREATE POLICY tenant_active_restrictive ON public.shifts AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(shifts.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(shifts.tenant_id)));
CREATE POLICY shifts_hr_all ON public.shifts FOR ALL TO authenticated
  USING ((SELECT public.can_access_tenant(shifts.tenant_id)) AND (SELECT public.is_hr()))
  WITH CHECK ((SELECT public.can_access_tenant(shifts.tenant_id)) AND (SELECT public.is_hr()));
CREATE POLICY shifts_tenant_select ON public.shifts FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- ── employee_shifts: HR writes, an employee reads their own assignment ───────────────────────
DROP POLICY tenant_isolation ON public.employee_shifts;
CREATE POLICY tenant_active_restrictive ON public.employee_shifts AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(employee_shifts.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(employee_shifts.tenant_id)));
CREATE POLICY employee_shifts_hr_all ON public.employee_shifts FOR ALL TO authenticated
  USING ((SELECT public.can_access_tenant(employee_shifts.tenant_id)) AND (SELECT public.is_hr()))
  WITH CHECK ((SELECT public.can_access_tenant(employee_shifts.tenant_id)) AND (SELECT public.is_hr()));
CREATE POLICY employee_shifts_self_select ON public.employee_shifts FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.get_my_employee_id()));

-- ── office_locations: HR writes, employees read ──────────────────────────────────────────────
DROP POLICY office_locations_tenant_isolation ON public.office_locations;
CREATE POLICY tenant_active_restrictive ON public.office_locations AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(office_locations.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(office_locations.tenant_id)));
CREATE POLICY office_locations_hr_all ON public.office_locations FOR ALL TO authenticated
  USING ((SELECT public.can_access_tenant(office_locations.tenant_id)) AND (SELECT public.is_hr()))
  WITH CHECK ((SELECT public.can_access_tenant(office_locations.tenant_id)) AND (SELECT public.is_hr()));
CREATE POLICY office_locations_tenant_select ON public.office_locations FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- ── employee_onboarding: server-side onboarding state; HR only ───────────────────────────────
DROP POLICY "HR can manage employee_onboarding in their tenant" ON public.employee_onboarding;
CREATE POLICY tenant_active_restrictive ON public.employee_onboarding AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(employee_onboarding.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(employee_onboarding.tenant_id)));
CREATE POLICY employee_onboarding_hr_all ON public.employee_onboarding FOR ALL TO authenticated
  USING ((SELECT public.can_access_tenant(employee_onboarding.tenant_id)) AND (SELECT public.is_hr()))
  WITH CHECK ((SELECT public.can_access_tenant(employee_onboarding.tenant_id)) AND (SELECT public.is_hr()));

-- ── Guard: no PERMISSIVE write-capable policy on these tables is tenant-only any more ─────────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('attendance_location_exceptions','employee_onboarding','employee_policy_acknowledgements',
                      'employee_shifts','it_declaration_windows','it_declarations','office_locations','payroll_runs','shifts')
    AND permissive = 'PERMISSIVE' AND cmd <> 'SELECT'
    AND position('is_hr' in coalesce(qual,'') || coalesce(with_check,'')) = 0
    AND position('auth.uid' in coalesce(qual,'') || coalesce(with_check,'')) = 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'C7: tenant-only PERMISSIVE write policies remain: %', v_bad;
  END IF;
END $$;
