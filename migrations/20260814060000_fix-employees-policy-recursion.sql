-- Fix: infinite recursion (42P17) in RLS policies on public.employees.
--
-- The three `managers_can_*_draft_reports` policies were applied ad hoc (they exist
-- only in `new update doc/onboarding.md`, never in a migration). Each resolves the
-- caller's own employee row with an inline subquery:
--
--     manager_id = (SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1)
--
-- An inline subquery inside a policy expression runs as the *invoking* role, so RLS on
-- `employees` is re-applied while evaluating a policy on `employees` -> 42P17.
--
-- Because the SELECT policy recursed, every authenticated read of `employees` 500'd, and
-- with it the 45 policies on other tables that subquery `employees` (leaves, attendance,
-- notifications, tasks, payslips, ...). The whole app was down for non-superadmin users.
--
-- Fix: resolve the caller's employee id through a SECURITY DEFINER helper, which runs as
-- the function owner and therefore does not re-enter RLS.
--
-- Semantics are preserved exactly: same manager_id check, same status filters. The only
-- behavioural change is that the queries now succeed instead of erroring.

CREATE OR REPLACE FUNCTION public.get_my_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$ SELECT id FROM public.employees WHERE user_id = (SELECT auth.uid()) LIMIT 1 $$;

-- New functions grant EXECUTE to PUBLIC (which includes anon) by default.
REVOKE EXECUTE ON FUNCTION public.get_my_employee_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_employee_id() TO authenticated;

-- The tenant clause each policy carried is redundant: `tenant_active_restrictive` is
-- RESTRICTIVE / FOR ALL / TO public, so tenant isolation is ANDed onto every operation
-- regardless. Dropping it here also avoids depending on get_auth_tenant_id(), which is
-- NULL for employees whose auth metadata was never populated.
--
-- (The dropped INSERT/DELETE versions also contained the tautology
-- `employees_1.tenant_id = employees_1.tenant_id`, which is not reproduced.)

DROP POLICY IF EXISTS managers_can_view_own_draft_reports ON public.employees;
CREATE POLICY managers_can_view_own_draft_reports
ON public.employees
FOR SELECT
TO authenticated
USING (manager_id = public.get_my_employee_id());

DROP POLICY IF EXISTS managers_can_create_draft_reports ON public.employees;
CREATE POLICY managers_can_create_draft_reports
ON public.employees
FOR INSERT
TO authenticated
WITH CHECK (
  status = 'draft'
  AND manager_id = public.get_my_employee_id()
);

DROP POLICY IF EXISTS managers_can_delete_own_draft_reports ON public.employees;
CREATE POLICY managers_can_delete_own_draft_reports
ON public.employees
FOR DELETE
TO authenticated
USING (
  status = 'inactive'
  AND user_id IS NULL
  AND manager_id = public.get_my_employee_id()
);
