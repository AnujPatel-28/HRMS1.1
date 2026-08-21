-- 06-organisation-management.md §5 step 6, SECOND half: DROP `employees.designation`.
-- `employees.department` went in 20260820190000 / 20260820200000. This finishes step 6.
--
-- `job_titles` is the managed reference entity (06 §3, §9.4) and `employees.job_title_id` is the FK.
-- The free-text copy goes.
--
-- ── `employment_type` is NOT part of this, deliberately ──────────────────────
-- 06 §5 step 6 names three columns. The third, `employees.employment_type`, was RETRACTED by §4b: it
-- is a CHECK-constrained enum (`full_time`) paired with `employment_types.name` as a display label
-- (`Full Time`) — a code/label convention, not drift. Backfilling it would violate the constraint.
-- It stays. Step 6 is complete at two columns, not three.
--
-- ── Data ─────────────────────────────────────────────────────────────────────
-- 13 of 16 employees carry BOTH job_title_id and designation; the other 3 carry neither (drafts).
-- FK coverage therefore already equals text coverage — dropping the text loses nothing.
--
-- ── The frontend half is already done ────────────────────────────────────────
-- Reads resolve through `src/utils/jobTitleLabel.ts` + `useJobTitleLabel()` (same provider as the
-- department lookup). The free-text "Designation" inputs in EmployeeCreate, EmployeeDetail and
-- AddTeamMemberModal became job-title PICKERS — a deliberate UX change, see below.
--
-- ── UX change a reviewer must accept ─────────────────────────────────────────
-- Those inputs were free text with a `<datalist>` of job titles: typing an exact match set
-- `job_title_id`, and typing ANYTHING ELSE silently produced an employee with a designation string
-- and NO job title. That is the same "two sources of truth, one of them unmanaged" defect this module
-- exists to remove. They are now `<select>` elements over `job_titles`. Consequence: HR must create a
-- job title in Organisation Structure before assigning it. Each picker shows an explicit hint when
-- the tenant has none rather than rendering an empty dropdown.
--
-- ── Dependencies, found with the alias-agnostic query 20260820200000 taught us ─
-- Never search for the aliases you expect; search for the column name across ALL of them:
--   SELECT p.proname, substring(pg_get_functiondef(p.oid) from '[A-Za-z_]+\.designation[^_a-zA-Z]')
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.prokind='f'
--     AND pg_get_functiondef(p.oid) ~ '[A-Za-z_]+[.]designation[^_a-zA-Z]';
-- plus a pg_depend sweep for views. That found:
--
--   employee_directory_public       VIEW  -> recreated without it (already exposes job_title_id)
--   employees_public                VIEW  -> recreated with job_title_id in its place
--   create_draft_employee                 -> resolves p_designation to a job_titles row
--   hr_activate_draft_employee (x2)       -> same
--   create_employee_transaction           -> drops the write; it already takes p_job_title_id
--   enforce_employee_update_restrictions  -> `designation` removed from the protected-field list
--
-- ── Why two functions RESOLVE rather than simply drop the write ──────────────
-- create_draft_employee and hr_activate_draft_employee accept `p_designation` and have NO
-- `p_job_title_id` parameter. Dropping the write would silently discard the caller's input — the
-- draft would end up with no job title at all. Instead each resolves the text to a `job_titles` row
-- by case-insensitive name WITHIN THE TENANT (tenant-scoped, because a cross-tenant name match baked
-- into a migration is a tenancy breach), and stores the id. Unmatched text resolves to NULL, which
-- fails closed and is visible as "—" rather than as a wrong title.
--
-- `p_designation` parameters are KEPT in every signature. PostgREST resolves RPCs by named argument,
-- so removing one breaks every already-deployed client the instant this applies. Retiring the
-- parameters is a separate, deploy-gated cleanup.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- The DATA is gone. Re-adding the column and running
--   UPDATE employees e SET designation = jt.title FROM job_titles jt WHERE jt.id = e.job_title_id;
-- reconstructs every value that was backed by a real job title. Text that never matched a job title
-- is not recoverable — it was, by definition, not reference data.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Function edits (self-verifying: asserts the exact hit count before replacing)
-- ═══════════════════════════════════════════════════════════════════════════════
DO $do$
DECLARE
  spec       record;
  fn         record;
  fn_def     text;
  hits       integer;
  total_hits integer;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- Resolve the text to a job_titles row instead of storing it.
      ('create_draft_employee',
       '    tenant_id, full_name, email, designation, date_of_joining, status, manager_id, user_id',
       '    tenant_id, full_name, email, job_title_id, date_of_joining, status, manager_id, user_id'),
      ('create_draft_employee',
       '    p_tenant_id, p_full_name, p_email, p_designation,',
       '    p_tenant_id, p_full_name, p_email, (SELECT jt.id FROM public.job_titles jt WHERE jt.tenant_id = p_tenant_id AND lower(jt.title) = lower(trim(p_designation)) LIMIT 1),'),

      -- Same resolution; COALESCE keeps the existing title when the text matches nothing, so
      -- activating a draft can never BLANK a title that was already set.
      ('hr_activate_draft_employee',
       E'    designation = p_designation,\n',
       E'    job_title_id = COALESCE((SELECT jt.id FROM public.job_titles jt WHERE jt.tenant_id = (SELECT e2.tenant_id FROM public.employees e2 WHERE e2.id = p_employee_id) AND lower(jt.title) = lower(trim(p_designation)) LIMIT 1), job_title_id),\n'),

      -- Already takes p_job_title_id separately, so the text write is pure duplication.
      ('create_employee_transaction', E'    designation,\n',        ''),
      ('create_employee_transaction', E'    trim(p_designation),\n', ''),

      -- Protected-field list: job_title_id is the field that matters now.
      ('enforce_employee_update_restrictions',
       E'     OLD.designation IS DISTINCT FROM NEW.designation OR\n', '')
    ) AS t(fn_name, old_snip, new_snip)
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

      IF hits > 1 THEN
        RAISE EXCEPTION
          'public.%() contains its target snippet % times, expected at most 1 per overload. Review by hand. Snippet: %',
          spec.fn_name, hits, left(spec.old_snip, 70);
      END IF;

      IF hits = 1 THEN
        EXECUTE replace(fn_def, spec.old_snip, spec.new_snip);
        total_hits := total_hits + 1;
      END IF;
    END LOOP;

    IF total_hits = 0 THEN
      RAISE EXCEPTION
        'No overload of public.%() contained the expected snippet — it has drifted, or the function is gone. Snippet: %',
        spec.fn_name, left(spec.old_snip, 70);
    END IF;

    RAISE NOTICE 'public.%(): patched % overload(s).', spec.fn_name, total_hits;
  END LOOP;
END
$do$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. The two dependent views
-- ═══════════════════════════════════════════════════════════════════════════════

-- No `security_invoker`: runs as owner and bypasses `employees` RLS, with tenant isolation coming
-- from the explicit predicate below. Grants restored EXACTLY as they were — project_admin only.
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
    e.role,
    e.user_id
   FROM public.employees e
     LEFT JOIN public.employees mgr ON mgr.id = e.manager_id
     LEFT JOIN public.employees sec_mgr ON sec_mgr.id = e.secondary_manager_id
  WHERE e.tenant_id = public.get_auth_tenant_id();

GRANT ALL ON public.employee_directory_public TO project_admin;

-- `security_invoker = true` is PRESERVED and load-bearing: this view has no tenant predicate of its
-- own, so caller-side `employees` RLS is the ONLY thing stopping it being a cross-tenant read.
DROP VIEW IF EXISTS public.employees_public;
CREATE VIEW public.employees_public
WITH (security_invoker = true) AS
 SELECT employees.id,
    employees.full_name,
    employees.org_unit_id,
    employees.job_title_id,
    employees.profile_photo_url,
    employees.status,
    employees.tenant_id
   FROM public.employees;

GRANT ALL ON public.employees_public TO anon;
GRANT ALL ON public.employees_public TO authenticated;
GRANT ALL ON public.employees_public TO project_admin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Drop it
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.employees DROP COLUMN IF EXISTS designation;

-- ── Verify after applying ────────────────────────────────────────────────────
--   SELECT count(*) FROM information_schema.columns
--   WHERE table_name = 'employees' AND column_name = 'designation';          -- expect 0
--
--   SELECT p.proname, substring(pg_get_functiondef(p.oid) from '[A-Za-z_]+\.designation[^_a-zA-Z]')
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.prokind='f'
--     AND pg_get_functiondef(p.oid) ~ '[A-Za-z_]+[.]designation[^_a-zA-Z]'; -- expect 0 rows
--
--   SELECT count(*) FROM public.employees_public;                            -- resolves
--   SELECT count(*) FROM public.employee_directory_public;                   -- resolves
--   UPDATE employees SET updated_at = now() WHERE id = (SELECT id FROM employees LIMIT 1);
--     -- exercises enforce_employee_update_restrictions, whose body compiles LAZILY
