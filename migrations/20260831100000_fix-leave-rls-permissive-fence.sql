-- CRITICAL: leave_types and leave_balances have a tenant "fence" written as a PERMISSIVE policy,
-- which makes it a blanket GRANT to every employee in the tenant instead of a restriction.
--
-- ############################################################################
-- THE BUG
-- ############################################################################
-- In Postgres, PERMISSIVE policies are OR-ed together: access is allowed if ANY of them passes.
-- RESTRICTIVE policies are AND-ed: they can only ever take access away. A tenant fence is only a
-- fence when it is RESTRICTIVE. Written PERMISSIVE, it stops being a fence and becomes a grant.
--
-- Verified live 2026-08-31:
--
--   leave_types
--     tenant_isolation    PERMISSIVE  ALL   USING (tenant_id = get_auth_tenant_id())
--     module_enabled_leave RESTRICTIVE ALL
--     -- and NOTHING else. No HR check anywhere.
--
--   leave_balances
--     tenant_isolation    PERMISSIVE  ALL   USING (tenant_id = get_auth_tenant_id())
--     leave_balances_hr_all PERMISSIVE ALL  USING (is_hr())
--     leave_balances_self  PERMISSIVE ALL   USING (own row)
--     module_enabled_leave RESTRICTIVE ALL
--
-- `authenticated` holds UPDATE and DELETE on leave_types and UPDATE on leave_balances (verified
-- with has_table_privilege). So the single PERMISSIVE tenant policy is enough, on its own, to let
-- ANY logged-in employee:
--
--   * set their OWN leave balance to any number -- unlimited leave, granted by the employee;
--   * edit a COLLEAGUE'S balance (tenant_isolation does not check whose row it is);
--   * change leave_types.days_per_year, or flip is_paid -- which feeds payroll;
--   * DELETE a leave type outright.
--
-- The `_hr_all` and `_self` policies on leave_balances are already redundant: tenant_isolation
-- alone grants everything they grant and more. That is the tell-tale shape of this mistake.
--
-- `leaves` itself is NOT affected -- there tenant_isolation is correctly RESTRICTIVE, and the
-- permissive policies are HR-only plus self-insert/self-read. Only these two tables are wrong.
--
-- ############################################################################
-- WHY THE FIX IS SAFE
-- ############################################################################
-- Verified before writing:
--   1. Every leave write function is SECURITY DEFINER -- approve_leave_request,
--      employee_apply_leave_request, employee_cancel_pending_leave, cancel_leave_request,
--      save_leave_type_transaction, deactivate_leave_type_transaction,
--      initialize_leave_balances_transaction, fn_accrue_monthly_leaves. Definer functions run as
--      the owner and are unaffected by RLS, so none of them loses anything.
--   2. NO code in src/ writes leave_types or leave_balances directly -- an exhaustive scan for
--      .from("leave_types"/"leave_balances") followed by a write verb returns zero hits. Every
--      write already goes through the RPCs above.
-- So removing the blanket grant takes away only the capability nobody legitimately uses.
--
-- ############################################################################
-- WHAT CHANGES
-- ############################################################################
-- leave_types    : fence becomes RESTRICTIVE; add HR-manage + tenant-read, matching the
--                  dominant <table>_hr_all / <table>_tenant_select shape used across this schema.
--                  Employees must still READ leave types -- the apply form lists them.
-- leave_balances : fence becomes RESTRICTIVE; the self policy is narrowed from ALL to SELECT so
--                  an employee can see their balance but not set it; HR keeps full management.
--
-- Binding rules: no BEGIN/COMMIT/ROLLBACK. No FORCE ROW LEVEL SECURITY. No function is modified.
-- No frontend file is touched. Module gating is untouched.

-- --------------------------------------------------------------------
-- 1. leave_types
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public.leave_types;
CREATE POLICY tenant_isolation ON public.leave_types
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());

DROP POLICY IF EXISTS leave_types_hr_all ON public.leave_types;
CREATE POLICY leave_types_hr_all ON public.leave_types
  FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

-- Employees must be able to READ the types -- the leave application form lists them.
DROP POLICY IF EXISTS leave_types_tenant_select ON public.leave_types;
CREATE POLICY leave_types_tenant_select ON public.leave_types
  FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id));

-- --------------------------------------------------------------------
-- 2. leave_balances
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public.leave_balances;
CREATE POLICY tenant_isolation ON public.leave_balances
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());

-- An employee may SEE their balance. They may not SET it -- that is what the bug allowed.
DROP POLICY IF EXISTS leave_balances_self ON public.leave_balances;
CREATE POLICY leave_balances_self ON public.leave_balances
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = leave_balances.employee_id
      AND e.user_id = auth.uid()
  ));

-- --------------------------------------------------------------------
-- 3. Verification
-- --------------------------------------------------------------------
DO $leave_rls_check$
DECLARE
  v_n integer;
BEGIN
  -- The fence must be RESTRICTIVE on both tables, or it is still a grant.
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('leave_types', 'leave_balances')
    AND policyname = 'tenant_isolation'
    AND permissive = 'RESTRICTIVE';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FENCE FAILED: expected 2 RESTRICTIVE tenant_isolation policies, got %', v_n;
  END IF;

  -- No PERMISSIVE policy on either table may grant a write without checking is_hr().
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('leave_types', 'leave_balances')
    AND permissive = 'PERMISSIVE'
    AND cmd IN ('ALL', 'UPDATE', 'INSERT', 'DELETE')
    AND coalesce(qual, '') NOT LIKE '%is_hr()%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'GRANT FAILED: % permissive write policy(ies) still do not require is_hr()', v_n;
  END IF;

  -- Employees must still be able to READ both, or the apply form breaks.
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'leave_types'
    AND cmd = 'SELECT' AND permissive = 'PERMISSIVE';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'OVER-REVOKED: employees can no longer read leave_types -- the apply form would be empty';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'leave_balances'
    AND policyname = 'leave_balances_self' AND cmd = 'SELECT';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OVER-REVOKED: employees can no longer read their own leave balance';
  END IF;

  -- HR must retain management on both.
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('leave_types', 'leave_balances')
    AND cmd = 'ALL' AND permissive = 'PERMISSIVE'
    AND coalesce(qual, '') LIKE '%is_hr()%';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'HR ACCESS FAILED: expected an HR-manage policy on both tables, got %', v_n;
  END IF;

  -- The module gate must survive untouched.
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('leave_types', 'leave_balances')
    AND policyname = 'module_enabled_leave';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'MODULE GATE LOST: expected module_enabled_leave on both tables, got %', v_n;
  END IF;

  RAISE NOTICE 'Leave RLS verified: tenant fence is RESTRICTIVE on both tables, no permissive write policy without is_hr(), employees keep read access, HR keeps management, module gate intact';
END
$leave_rls_check$;
