-- 06-organisation-management.md §9.6, steps 1, 4 and 5 — with step 1 deliberately NOT done.
--
-- ============================================================================
-- WHY THERE IS NO hr_admin BACKFILL HERE
-- ============================================================================
-- §9.6 step 1 says "Backfill employee_roles from employees.role / auth metadata". That
-- backfill existed to serve step 2 — removing the JWT branch from is_hr(). 20260821110000
-- proved step 2 is not buildable: four HR admins have no employees row at all, because
-- create-hr-admin-user provisions a tenant's first HR admin as an auth user only. JWT stays
-- load-bearing.
--
-- With step 2 gone, the backfill has no purpose left, and running it anyway would CREATE
-- the defect this module exists to remove. Copy 'hr' into employee_roles and hr is stored
-- twice; nothing writes the second copy (set_hr_user_metadata, the promotion path, updates
-- auth metadata only), so the day someone is promoted the two disagree. That is precisely
-- how employees.department came to contradict org_units on 7 of 16 rows.
--
-- The model that does not drift keeps the two sources NON-OVERLAPPING:
--
--   auth.users.metadata  -> is this session HR, and which tenant. One writer
--                           (set_hr_user_metadata). Nothing else claims this fact.
--   employee_roles       -> grants that CANNOT be expressed in a JWT: owner, and scoped
--                           manager/payroll_admin over a unit. One writer (HR, via RLS).
--
-- employee_is_hr()'s table branch is the forward path, not dead code: when an HR-grant UI
-- writes hr_admin rows, they compose through the existing OR with no migration and no
-- drift window. Do not "complete" this later by backfilling hr_admin rows unless you are
-- simultaneously making employee_roles the WRITER for HR promotion.
--
-- This migration therefore does: retire the department scope type, add the owner role,
-- enforce at-most-one owner per tenant, and seed the owners that are identifiable.

-- ---------------------------------------------------------------------------
-- 1. Retire the 'department' scope type
-- ---------------------------------------------------------------------------
-- 20260820190000 repointed the department branch of can_view_employee onto org_unit_id,
-- which left the function with TWO overlapping unit branches: the correct pre-existing
-- scope_type='org_unit' (uuid = uuid, via the scope_id FK to org_units) and a repointed
-- scope_type='department' comparing target.org_unit_id::text to the free-text scope_value.
-- The second is the same uuid test done through a text column with no FK. Off-model, and
-- exactly the kind of second path that drifts. Zero rows use it, so retiring it is free.
ALTER TABLE public.employee_roles DROP CONSTRAINT IF EXISTS employee_roles_scope_type_check;
ALTER TABLE public.employee_roles ADD CONSTRAINT employee_roles_scope_type_check
  CHECK (scope_type = ANY (ARRAY['self'::text, 'direct_reports'::text, 'org_unit'::text, 'tenant'::text]));

ALTER TABLE public.employee_roles DROP CONSTRAINT IF EXISTS employee_roles_scope_target_check;
ALTER TABLE public.employee_roles ADD CONSTRAINT employee_roles_scope_target_check
  CHECK (
    ((scope_type = 'org_unit'::text) AND (scope_id IS NOT NULL))
    OR (scope_type = ANY (ARRAY['self'::text, 'direct_reports'::text, 'tenant'::text]))
  );

-- ---------------------------------------------------------------------------
-- 2. Add the 'owner' role
-- ---------------------------------------------------------------------------
-- Owner carries org-level rights distinct from hr_admin's operational ones: transfer
-- ownership, close the account, manage billing when billing exists (§9.6). None of those
-- surfaces exist yet, so owner is recorded as a DESIGNATION and given no permission
-- plumbing here. Building enforcement for capabilities that have no caller is the mistake
-- §9.5 documented — employee_roles itself was built that way and sat inert for a week.
-- What owner needs today is to be true, unique, and visible.
ALTER TABLE public.employee_roles DROP CONSTRAINT IF EXISTS employee_roles_role_check;
ALTER TABLE public.employee_roles ADD CONSTRAINT employee_roles_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'hr_admin'::text, 'payroll_admin'::text, 'manager'::text, 'employee'::text]));

-- AT MOST one active owner per tenant, not "exactly one". Exactly-one is unachievable as a
-- constraint: employee_roles.employee_id is NOT NULL with an FK to employees, and 8 of the
-- 12 tenants have zero employees. It is also unachievable at provisioning time for the same
-- reason the JWT branch is load-bearing — a new tenant's first HR admin has no employees
-- row to attach ownership to. Exactly-one is a rule for the tenant-provisioning flow to
-- uphold once that flow creates an employee; the database enforces the half that is true.
CREATE UNIQUE INDEX IF NOT EXISTS employee_roles_one_active_owner_per_tenant
  ON public.employee_roles (tenant_id)
  WHERE role = 'owner' AND is_active;

-- ---------------------------------------------------------------------------
-- 3. can_view_employee — drop the retired branch
-- ---------------------------------------------------------------------------
-- Restated in full rather than patched: the body is small, and the change is a deletion
-- whose whole point is that the remaining branches are exactly the pre-existing ones.
-- 'owner' is NOT added to the grant list. Owner is an org-level designation; conflating it
-- with employee-record visibility would grant a permission nobody asked for.
CREATE OR REPLACE FUNCTION public.can_view_employee(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        )
    );
$function$;

-- ---------------------------------------------------------------------------
-- 4. Seed one owner per tenant, where one can be identified
-- ---------------------------------------------------------------------------
-- §9.6 called this an open data call: "who becomes owner for the 12 existing tenants? Most
-- likely the earliest HR user per tenant." That resolves to the earliest active employee
-- who is HR, by date_of_joining then created_at.
--
-- Seeded ONLY where the tenant has an HR employee. Tenants with employees but no HR are
-- skipped deliberately: promoting an arbitrary employee to owner invents an authority
-- nobody granted. They get an owner when a real one is designated through the UI.
--
-- scope_type='tenant' — ownership is org-level by definition, never unit-scoped.
INSERT INTO public.employee_roles (tenant_id, employee_id, role, scope_type, is_active)
SELECT DISTINCT ON (e.tenant_id)
  e.tenant_id, e.id, 'owner', 'tenant', true
FROM public.employees e
WHERE e.status = 'active'
  AND e.user_id IS NOT NULL
  AND public.employee_is_hr(e.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.employee_roles r
    WHERE r.tenant_id = e.tenant_id AND r.role = 'owner' AND r.is_active
  )
ORDER BY e.tenant_id, e.date_of_joining NULLS LAST, e.created_at;

-- The seed must not have violated the invariant it just declared.
DO $check$
DECLARE
  v_dupes int;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT tenant_id FROM public.employee_roles
    WHERE role = 'owner' AND is_active
    GROUP BY tenant_id HAVING count(*) > 1
  ) x;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'owner seed produced % tenant(s) with more than one active owner', v_dupes;
  END IF;
END
$check$;
