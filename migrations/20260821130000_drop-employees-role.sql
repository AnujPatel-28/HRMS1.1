-- 06-organisation-management.md §9.6, step 3 — the last item in §5.
--
-- Drops employees.role, the third and redundant copy of a fact auth.users.metadata already
-- holds. See 20260821110000 for why this leaves TWO sources and not one, and why that is
-- the correct target rather than a shortfall.
--
-- SEQUENCING: this migration must be applied only AFTER the frontend that stops reading
-- employees.role is DEPLOYED, not merely committed. Commit e7a89d3 does that; the
-- department/designation drop was applied against a bundle that still read those columns,
-- and production rendered blanks until the catch-up shipped. Do not repeat it.

-- ---------------------------------------------------------------------------
-- 1. enforce_employee_update_restrictions — remove the role guard
-- ---------------------------------------------------------------------------
-- This trigger stops a non-HR employee editing administrative fields on their own row,
-- role among them. Dropping the column removes that specific guard, so the replacement
-- has to be established BEFORE the drop rather than assumed:
--
--   employee_roles RLS is strictly stronger. employee_roles_self_select is SELECT-only,
--   and employee_roles_hr_all — the only policy granting INSERT/UPDATE/DELETE — requires
--   can_access_tenant(tenant_id) AND is_hr(). A non-HR employee therefore cannot write ANY
--   role grant, their own included, where previously they could attempt the UPDATE and be
--   refused by this trigger. Strictly narrower, and enforced by RLS rather than by a
--   trigger that a future writer could bypass.
--
-- The exception message is rewritten in the same pass; leaving it naming a column that no
-- longer exists would send the next reader looking for it.
DO $mig$
DECLARE
  v_def  text;
  v_hits int;
  v_old1 CONSTANT text := '     OLD.role IS DISTINCT FROM NEW.role OR' || chr(10);
  v_old2 CONSTANT text := 'administrative profile fields (role, tenant, manager, status, grade, job details)';
  v_new2 CONSTANT text := 'administrative profile fields (tenant, manager, status, grade, job details)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'enforce_employee_update_restrictions' AND p.prokind = 'f';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'enforce_employee_update_restrictions not found';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 OLD.role guard line, found % — refusing to rewrite a drifted body', v_hits;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 exception message, found % — refusing to rewrite a drifted body', v_hits;
  END IF;

  EXECUTE replace(replace(v_def, v_old1, ''), v_old2, v_new2);
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. employee_directory_public — recreate without role
-- ---------------------------------------------------------------------------
-- Views block a column drop and the ALTER names only ONE at a time, so they were
-- enumerated up front via pg_depend -> pg_rewrite -> pg_class. There is exactly one here.
--
-- Two properties of this view must survive verbatim, because both are load-bearing and
-- neither is obvious:
--
--   * NO security_invoker. This view runs with its owner's rights and BYPASSES employees
--     RLS by design; its only tenant fence is the WHERE clause below. Adding
--     security_invoker would break every employee-portal read; omitting the WHERE clause
--     would turn it into a cross-tenant leak. (employees_public is the opposite case — it
--     DOES carry security_invoker, and that flag is the only thing making its
--     tenant-unfiltered select safe. Do not treat the two views alike.)
--   * The grants are restored exactly as they were found, not as they arguably should be.
--
-- On those grants: anon and authenticated hold INSERT/UPDATE/DELETE here. That is untidy
-- but provably inert — information_schema.views reports is_updatable = NO and
-- is_insertable_into = NO for this view (it joins employees to itself twice), and it
-- carries no INSTEAD OF triggers, so no write can be routed through it. anon SELECT
-- likewise returns zero rows, because get_auth_tenant_id() is NULL without a session.
-- Restoring them unchanged keeps this migration's diff to the one column it is about;
-- narrowing them is a real change and belongs in its own, with its own verification.
DROP VIEW IF EXISTS public.employee_directory_public;

CREATE VIEW public.employee_directory_public AS
 SELECT e.id,
    e.tenant_id,
    e.full_name,
    e.email,
    e.profile_photo_url,
    e.org_unit_id,
    e.job_title_id,
    e.location_id,
    e.employment_type_id,
    e.work_location,
    e.work_mode,
    e.manager_id,
    e.secondary_manager_id,
    mgr.full_name AS manager_name,
    sec_mgr.full_name AS secondary_manager_name,
    e.grade,
    e.status,
    e.user_id
   FROM public.employees e
     LEFT JOIN public.employees mgr ON mgr.id = e.manager_id
     LEFT JOIN public.employees sec_mgr ON sec_mgr.id = e.secondary_manager_id
  WHERE e.tenant_id = public.get_auth_tenant_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_directory_public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_directory_public TO authenticated;
GRANT ALL ON public.employee_directory_public TO project_admin;

-- ---------------------------------------------------------------------------
-- 3. Drop the column
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_employees_role;
ALTER TABLE public.employees DROP COLUMN IF EXISTS role;

-- user_role is left in place: AuthContext still types the JWT metadata role against it,
-- and dropping a type still referenced by application code buys nothing.

-- ---------------------------------------------------------------------------
-- 4. Prove there are no survivors
-- ---------------------------------------------------------------------------
-- A dropped column does NOT break a PL/pgSQL function at apply time — bodies compile
-- lazily, per session, on first execution, so "the migration applied" proves nothing about
-- the dependents. After the 2026-08-20 department drop, a trigger still referencing
-- OLD.department kept succeeding for hours. This runs the check explicitly, and searches
-- for the BARE column name as well as qualified forms: the alias-only regex used last time
-- missed two dependents, and it missed fn_check_insurance_expiries this time.
DO $audit$
DECLARE
  v_fns text;
  v_pol text;
  v_col int;
BEGIN
  SELECT count(*) INTO v_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'role';

  IF v_col <> 0 THEN
    RAISE EXCEPTION 'employees.role still exists after the drop';
  END IF;

  -- Scoped to triggers ON public.employees. An unscoped search over every OLD./NEW.role in
  -- the schema flags sync_admin_users, whose NEW.role is profiles.role -- a different
  -- table's column on a trigger that never fires for employees.
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_fns
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'public.employees'::regclass
    AND NOT t.tgisinternal
    AND pg_get_functiondef(p.oid) ~ '\m(OLD|NEW)\.role\M';

  IF v_fns IS NOT NULL THEN
    RAISE EXCEPTION 'employees.role still referenced by trigger function(s): %', v_fns;
  END IF;

  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_pol
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '\mrole\M\s*=\s*''hr''';

  IF v_pol IS NOT NULL THEN
    RAISE EXCEPTION 'employees.role still referenced by policies: %', v_pol;
  END IF;
END
$audit$;
