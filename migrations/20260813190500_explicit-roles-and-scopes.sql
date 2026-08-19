-- Migration: Explicit roles and scopes (Phase 2 of the manager-role work)
-- Created: 2026-08-13
-- Target: public.employee_roles, public.has_role(), public.is_hr(), public.can_view_employee()
--
-- Phase 1 gave managers read access to their direct reports, but "manager" was still *inferred* from
-- the org chart. That makes some real cases impossible: a project lead, a department head covering a
-- vacancy, or a dotted-line reviewer has no path to team visibility without being made someone's
-- line manager.
--
-- This migration separates the two things that were conflated:
--     ROLE  = what actions you may perform   (hr_admin, payroll_admin, manager, employee)
--     SCOPE = who you may perform them over  (self, direct_reports, org_unit, department, tenant)
--
-- Permissions are stored as DATA, so "what can a manager see?" becomes configuration rather than a
-- schema change. Nothing here widens existing access on its own — an empty employee_roles table
-- behaves exactly like the system did before this migration.

-- ==========================================
-- 1. The grants table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.employee_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  role text NOT NULL,
  scope_type text NOT NULL DEFAULT 'direct_reports',
  -- Set when scope_type = 'org_unit'.
  scope_id uuid,
  -- Set when scope_type = 'department' (departments are free text on employees, not a table).
  scope_value text,
  granted_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id) REFERENCES public.org_units(id) ON DELETE CASCADE
);

ALTER TABLE public.employee_roles DROP CONSTRAINT IF EXISTS employee_roles_role_check;
ALTER TABLE public.employee_roles ADD CONSTRAINT employee_roles_role_check
  CHECK (role IN ('hr_admin', 'payroll_admin', 'manager', 'employee'));

ALTER TABLE public.employee_roles DROP CONSTRAINT IF EXISTS employee_roles_scope_type_check;
ALTER TABLE public.employee_roles ADD CONSTRAINT employee_roles_scope_type_check
  CHECK (scope_type IN ('self', 'direct_reports', 'org_unit', 'department', 'tenant'));

-- A scoped grant must actually carry its scope, or it silently matches nothing.
ALTER TABLE public.employee_roles DROP CONSTRAINT IF EXISTS employee_roles_scope_target_check;
ALTER TABLE public.employee_roles ADD CONSTRAINT employee_roles_scope_target_check
  CHECK (
    (scope_type = 'org_unit'   AND scope_id IS NOT NULL)
    OR (scope_type = 'department' AND scope_value IS NOT NULL)
    OR (scope_type IN ('self', 'direct_reports', 'tenant'))
  );

CREATE INDEX IF NOT EXISTS idx_employee_roles_lookup
  ON public.employee_roles USING btree (tenant_id, employee_id, is_active);

-- ==========================================
-- 2. RLS on the grants table itself
-- ==========================================
-- This table decides who can see what, so it must not be self-serviceable: an employee who could
-- insert their own row here would grant themselves tenant-wide access.
ALTER TABLE public.employee_roles ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.employee_roles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_roles TO authenticated;

DROP POLICY IF EXISTS employee_roles_self_select ON public.employee_roles;
CREATE POLICY employee_roles_self_select ON public.employee_roles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    can_access_tenant(tenant_id)
    AND employee_id = (SELECT e.id FROM public.employees e WHERE e.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS employee_roles_hr_all ON public.employee_roles;
CREATE POLICY employee_roles_hr_all ON public.employee_roles
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

-- ==========================================
-- 3. has_role()
-- ==========================================
CREATE OR REPLACE FUNCTION public.has_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_roles r
    JOIN public.employees me ON me.id = r.employee_id
    WHERE me.user_id = (SELECT auth.uid())
      AND r.tenant_id = me.tenant_id
      AND r.role = p_role
      AND r.is_active
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO authenticated;

-- ==========================================
-- 4. Extend is_hr() — additive only
-- ==========================================
-- 63 existing policies depend on is_hr(). The original definition (auth metadata role = 'hr' for the
-- caller's tenant) is preserved exactly and an OR branch is added for an explicit hr_admin grant, so
-- no existing access is removed. This is what lets HR access be granted from the UI in future rather
-- than only by editing auth metadata.
CREATE OR REPLACE FUNCTION public.is_hr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = (SELECT auth.uid())
        AND u.metadata->>'role' = 'hr'
        AND NULLIF(u.metadata->>'tenant_id', '')::uuid = (SELECT public.get_auth_tenant_id())
    )
    OR EXISTS (
      SELECT 1
      FROM public.employee_roles r
      JOIN public.employees me ON me.id = r.employee_id
      WHERE me.user_id = (SELECT auth.uid())
        AND r.tenant_id = me.tenant_id
        AND r.role = 'hr_admin'
        AND r.is_active
    );
$$;

-- ==========================================
-- 5. can_view_employee() — the unified scope check
-- ==========================================
-- Answers "may the caller see this employee's records?" by combining every source of authority.
-- Policies should prefer this over is_manager_of() so that explicit grants are honoured too.
--
-- org_unit scope is deliberately NOT recursive: it matches the employee's own org_unit_id and does
-- not walk org_units.parent_id. Walking the tree needs a cycle guard, and the hierarchy has none yet.
CREATE OR REPLACE FUNCTION public.can_view_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    -- Yourself.
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.user_id = (SELECT auth.uid())
    )
    -- HR (metadata or explicit hr_admin grant).
    OR (SELECT public.is_hr())
    -- Line manager, primary/secondary/effective-dated relationship.
    OR (SELECT public.is_manager_of(p_employee_id))
    -- An explicit scoped grant.
    OR EXISTS (
      SELECT 1
      FROM public.employee_roles r
      JOIN public.employees me ON me.id = r.employee_id
      JOIN public.employees target ON target.id = p_employee_id
      WHERE me.user_id = (SELECT auth.uid())
        AND r.is_active
        AND r.tenant_id = me.tenant_id
        AND me.tenant_id = target.tenant_id
        AND r.role IN ('manager', 'hr_admin', 'payroll_admin')
        AND (
          r.scope_type = 'tenant'
          OR (r.scope_type = 'org_unit' AND target.org_unit_id = r.scope_id)
          OR (r.scope_type = 'department' AND target.department = r.scope_value)
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_employee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_employee(uuid) TO authenticated;

-- ==========================================
-- 6. Widen the Phase 1 policies to honour explicit grants
-- ==========================================
DROP POLICY IF EXISTS attendance_select_manager ON public.attendance;
CREATE POLICY attendance_select_manager ON public.attendance
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.can_view_employee(employee_id));

DROP POLICY IF EXISTS leaves_select_manager ON public.leaves;
CREATE POLICY leaves_select_manager ON public.leaves
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.can_view_employee(employee_id));
