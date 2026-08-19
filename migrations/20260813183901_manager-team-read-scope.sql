-- Migration: Manager read scope for team attendance and leave (Phase 1 of the manager-role work)
-- Created: 2026-08-13
-- Target: public.is_manager_of(), public.attendance, public.leaves
--
-- Problem this fixes: there was no manager scope anywhere in the database. `attendance` and `leaves`
-- were readable only by the employee themselves or by HR. src/employee/MyTeam.tsx fetches each team
-- member's attendance and leaves, so for a manager who is not HR those queries returned zero rows and
-- the team detail view rendered blank. The manager rule lived only in the frontend as
-- `.eq("manager_id", currentEmployee.id)` — a query filter, not a permission.
--
-- Scope of this migration is deliberately narrow: READ only. Approving leave, editing attendance and
-- any notion of an explicit "manager" role that can be granted to someone who is not a line manager
-- are later phases. See doc/module_architecture.md.

-- ==========================================
-- 1. Helper: is the caller a manager of this employee?
-- ==========================================
-- Follows the convention of the existing helpers (is_hr, can_access_tenant): SECURITY DEFINER so it
-- can read employees without tripping that table's own RLS (which would recurse), STABLE, and
-- search_path pinned to empty so every reference must be schema-qualified.
--
-- Three sources of authority are accepted, because the codebase populates two of them:
--   * employees.manager_id            — the primary line manager (what MyTeam filters on)
--   * employees.secondary_manager_id  — dotted-line/matrix manager
--   * employee_reporting_relationships — the richer effective-dated model
CREATE OR REPLACE FUNCTION public.is_manager_of(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees target
    JOIN public.employees me
      ON me.user_id = (SELECT auth.uid())
    WHERE target.id = p_employee_id
      -- Defence in depth: tenant isolation is already enforced by the calling policy.
      AND me.tenant_id = target.tenant_id
      -- Never let a self-reference grant elevated scope.
      AND me.id <> target.id
      AND (
        target.manager_id = me.id
        OR target.secondary_manager_id = me.id
        OR EXISTS (
          SELECT 1
          FROM public.employee_reporting_relationships r
          WHERE r.employee_id = target.id
            AND r.manager_id = me.id
            AND r.is_active
            AND (r.effective_from IS NULL OR r.effective_from <= CURRENT_DATE)
            AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_manager_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_manager_of(uuid) TO authenticated;

-- ==========================================
-- 2. Manager read policies
-- ==========================================
-- Additive: these sit alongside the existing self/HR policies. The RESTRICTIVE tenant_isolation and
-- tenant_active policies on both tables still apply and are ANDed with these.
DROP POLICY IF EXISTS attendance_select_manager ON public.attendance;
CREATE POLICY attendance_select_manager ON public.attendance
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_manager_of(employee_id));

DROP POLICY IF EXISTS leaves_select_manager ON public.leaves;
CREATE POLICY leaves_select_manager ON public.leaves
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_manager_of(employee_id));
