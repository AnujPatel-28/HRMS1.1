-- 06-organisation-management.md §5 step 6, first half: DROP `employees.department`.
--
-- `org_unit_id` has been the single source of truth for unit membership since 20260820180000, which
-- made `employee_unit_assignments` the only way to change it. This removes the duplicated text copy.
--
-- ── The frontend half is already done ────────────────────────────────────────
-- All ~100 read sites now resolve the unit NAME from `org_unit_id` through
-- `src/utils/departmentLabel.ts` + `src/contexts/OrgUnitsContext.tsx` (one tenant-wide lookup,
-- mounted inside TenantProvider). `department` was removed from the `Employee` TypeScript interface
-- and the build is green, which is the proof that nothing in the SPA still reads the column.
--
-- ── Why the column cannot simply be dropped ──────────────────────────────────
-- Postgres REFUSES the drop while a view depends on it, and four functions would fail at runtime.
-- Each is handled below, in order, before the ALTER.
--
--   employee_directory_public        VIEW, selects it            -> recreated without it
--   employees_public                 VIEW, selects it            -> recreated without it
--   sync_employee_current_unit       maintained it (20260820150000) -> clause removed
--   create_employee_transaction      INSERTs it                  -> column dropped from the INSERT
--   hr_activate_draft_employee (x2)  UPDATEs it                  -> assignment removed
--   can_view_employee                AUTHORISATION, matches it   -> repointed to org_unit_id
--   get_employee_visible_hr_policies legacy visibility branch    -> retired
--   get_hr_policy_library            legacy visibility branch    -> retired
--   acknowledge_policy_transaction   legacy visibility branch    -> retired
--
-- Deliberately NOT touched — these carry a DIFFERENT `department` that merely shares the name:
--   update_exit_clearance_transaction    p_department is an exit-clearance stage
--                                        ('assets'|'it'|'finance'|'hr'|'admin'), not an org unit.
--   create_policy_notifications_transaction  reads hr_policies.department_filter for a title string;
--                                        it never reads employees.department.
--   hr_policies.department_filter, chat_channels.target_departments,
--   projects.visibility_config->'departments', tasks.department_filter — all separate columns on
--   other tables, each with its own uuid twin already, and each its own step-6 follow-up.
--
-- ── `p_department` parameters are KEPT ───────────────────────────────────────
-- The signatures of create_employee_transaction and hr_activate_draft_employee are unchanged; the
-- parameter is simply no longer used. Dropping it would change the function signature, and PostgREST
-- resolves RPCs by named arguments — every deployed client still sending `p_department` would start
-- failing the moment this migration applied, before the new bundle shipped. Retiring the parameter is
-- a separate, deploy-gated cleanup.
--
-- ── Why scripted replacement instead of CREATE OR REPLACE ────────────────────
-- These bodies total tens of KB. Re-typing them to change one line each risks a silent behavioural
-- change somewhere in the rest — the failure mode this module exists to remove. The DO block asserts
-- each target snippet appears EXACTLY the expected number of times before swapping it, and raises
-- otherwise, so a drifted function is never silently rewritten. Same approach as 20260820170000.
--
-- ── Authorisation deltas a reviewer must accept ──────────────────────────────
-- D1. can_view_employee: a `scope_type = 'department'` role scope now compares `scope_value` against
--     `org_unit_id::text` (a uuid) instead of a department NAME. Any existing scope row holding a name
--     stops matching — it fails CLOSED. Vacuous today: `employee_roles` has 0 rows, so no scope row
--     exists at all. Re-seed scope_value with unit uuids when §9.6 activates roles.
-- D2. The three policy-visibility functions lose their legacy `department_filter = e.department` text
--     branch. Policies targeted by NAME rather than by `org_unit_id` become invisible to employees —
--     also fails closed. Vacuous today: `hr_policies` holds 1 row and it is `visible_to = 'all'`.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Not cleanly reversible: the column's DATA is gone. Re-adding the column and re-running the backfill
-- `UPDATE employees SET department = ou.name FROM org_units ou WHERE ou.id = org_unit_id` reconstructs
-- every value that mattered, because 20260820150000 had already made the column exactly equal to the
-- unit name. Then replay 20260820150000 and re-create the view with the column.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Targeted function edits
-- ═══════════════════════════════════════════════════════════════════════════════
DO $do$
DECLARE
  spec        record;
  fn          record;
  fn_def      text;
  new_def     text;
  hits        integer;
  total_hits  integer;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- D1: authorisation. A department-scoped role now keys on the unit uuid.
      ('can_view_employee',
       'target.department = r.scope_value',
       'target.org_unit_id::text = r.scope_value', 1),

      -- D2: retire the legacy name-matching visibility branches. `false` keeps the surrounding
      -- boolean structure intact, so the org_unit_id branch beside each one is untouched.
      ('get_hr_policy_library',
       '(fp.org_unit_id IS NULL AND fp.department_filter IS NOT NULL AND e.department = fp.department_filter)',
       '(false)', 1),
      ('acknowledge_policy_transaction',
       '(p.org_unit_id IS NULL AND p.department_filter = e.department)',
       '(false)', 1),
      ('get_employee_visible_hr_policies',
       'SELECT e.id, e.department, e.org_unit_id',
       'SELECT e.id, NULL::text, e.org_unit_id', 1),
      ('get_employee_visible_hr_policies',
       '(p.org_unit_id IS NULL AND p.department_filter = v_employee_department)',
       '(false)', 1),

      -- Writers: stop touching the column.
      ('create_employee_transaction', E'    department,\n',   '', 1),
      ('create_employee_transaction', E'    p_department,\n', '', 1),
      -- Two overloads exist (with and without p_user_id); both assign it.
      ('hr_activate_draft_employee',  E'    department = p_department,\n', '', 1)
    ) AS t(fn_name, old_snip, new_snip, per_overload)
  LOOP
    total_hits := 0;

    FOR fn IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = spec.fn_name
    LOOP
      fn_def := pg_get_functiondef(fn.oid);
      hits := (length(fn_def) - length(replace(fn_def, spec.old_snip, ''))) / length(spec.old_snip);

      IF hits <> spec.per_overload THEN
        RAISE EXCEPTION
          'public.%() contains its target snippet % time(s), expected % per overload. The function has drifted from what this migration was written against — review it by hand rather than letting this rewrite it. Snippet: %',
          spec.fn_name, hits, spec.per_overload, left(spec.old_snip, 80);
      END IF;

      new_def := replace(fn_def, spec.old_snip, spec.new_snip);
      EXECUTE new_def;
      total_hits := total_hits + hits;
    END LOOP;

    IF total_hits = 0 THEN
      RAISE EXCEPTION 'No function named public.%() was found — refusing to continue.', spec.fn_name;
    END IF;

    RAISE NOTICE 'public.%(): replaced % occurrence(s).', spec.fn_name, total_hits;
  END LOOP;
END
$do$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. The sync trigger stops maintaining the column
--    Reverts sync_employee_current_unit() to its 20260820180000 behaviour minus the department
--    clause, exactly as 20260820150000's header said to do at this point.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_employee_current_unit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  target_employee uuid;
  current_unit    uuid;
BEGIN
  target_employee := CASE WHEN TG_OP = 'DELETE' THEN OLD.employee_id ELSE NEW.employee_id END;

  IF TG_OP <> 'DELETE' AND NEW.effective_to IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.org_unit_id INTO current_unit
  FROM public.employee_unit_assignments a
  WHERE a.employee_id = target_employee
    AND a.effective_to IS NULL
  ORDER BY a.effective_from DESC
  LIMIT 1;

  UPDATE public.employees e
  SET org_unit_id = current_unit
  WHERE e.id = target_employee;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. The view — this is what actually BLOCKS the drop
--    Recreated with the column removed and everything else preserved verbatim.
-- ═══════════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.employee_directory_public;
CREATE VIEW public.employee_directory_public AS
 SELECT e.id,
    e.tenant_id,
    e.full_name,
    e.email,
    e.profile_photo_url,
    e.designation,
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
    e.role,
    e.user_id
   FROM public.employees e
     LEFT JOIN public.employees mgr ON mgr.id = e.manager_id
     LEFT JOIN public.employees sec_mgr ON sec_mgr.id = e.secondary_manager_id
  WHERE e.tenant_id = public.get_auth_tenant_id();

-- DROP VIEW discards grants, so they are restored EXACTLY as they were — project_admin only.
-- Note this view has NO `security_invoker`, so it runs as its owner and bypasses `employees` RLS;
-- its tenant isolation comes from the explicit `WHERE e.tenant_id = get_auth_tenant_id()` above.
-- That is why granting it more broadly is a deliberate decision and NOT something this migration
-- does as a side effect.
GRANT ALL ON public.employee_directory_public TO project_admin;

-- ── The second dependent view ────────────────────────────────────────────────
-- `employees_public` also selects the column. It is read by src/shared/Chat.tsx:200, which now
-- resolves the department label from org_unit_id, so the view must expose that instead.
-- `security_invoker = true` is PRESERVED deliberately: it is what makes `employees` RLS apply as the
-- CALLER, which is the only thing keeping this unfiltered view (it has no tenant predicate of its
-- own) from being a cross-tenant read. Recreating it without that option would turn it into a leak.
DROP VIEW IF EXISTS public.employees_public;
CREATE VIEW public.employees_public
WITH (security_invoker = true) AS
 SELECT employees.id,
    employees.full_name,
    employees.org_unit_id,
    employees.designation,
    employees.profile_photo_url,
    employees.status,
    employees.tenant_id
   FROM public.employees;

GRANT ALL ON public.employees_public TO anon;
GRANT ALL ON public.employees_public TO authenticated;
GRANT ALL ON public.employees_public TO project_admin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Drop it
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.employees DROP COLUMN IF EXISTS department;

-- ── Verify after applying ────────────────────────────────────────────────────
--   -- the column is gone (expect 0):
--   SELECT count(*) FROM information_schema.columns
--   WHERE table_name = 'employees' AND column_name = 'department';
--
--   -- nothing server-side still reads it (expect 0). Note this pattern also matches the UNRELATED
--   -- department fields listed in the header, so read any hits before acting on them:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f'
--     AND pg_get_functiondef(p.oid) ~ '\me\.department\M';
--
--   -- and the directory view still resolves:
--   SELECT count(*) FROM public.employee_directory_public;
