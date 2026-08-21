-- Adds the org-unit target column `tasks` is missing, so HR's "assign to a department" flow can be
-- moved off legacy department text. Additive only: no policy, no function and no existing row
-- changes behaviour when this is applied.
--
-- ── Why `tasks` was left behind ──────────────────────────────────────────────
-- Slice B gave `hr_policies`, `chat_channels` and `projects` a uuid twin for their department target.
-- `tasks.department_filter` never got one, because it is not read by RLS — verified live:
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE coalesce(qual,'') LIKE '%department_filter%'
--      OR coalesce(with_check,'') LIKE '%department_filter%';   -- zero rows
--
-- So it was correctly excluded from the authorisation migrations. But it is still load-bearing in the
-- application, and it is currently BROKEN.
--
-- ── The live defect this unblocks ────────────────────────────────────────────
-- src/hr/TaskManagement.tsx assigns a task to a whole department by fanning out over
--
--   employees.filter(e => e.department === form.department)      -- TaskManagement.tsx:132
--
-- where `form.department` comes from a hardcoded six-value list of lowercase slugs
-- (`sales / dev / marketing / operations / design / other`, TaskManagement.tsx:18).
--
-- `employees.department` no longer holds those slugs. 20260818100000 realigned it to the org unit's
-- NAME, so live values are `Sales`, `Dev`, `Hr`, `Design`, `Product`, `Marketing` — capitalised, and
-- including names (`Product`, `Engineering`) that are not in the hardcoded list at all. The strict
-- equality therefore matches ZERO employees, and the success toast is computed from the match count,
-- so it reports "assigned to 0 employees" as a success rather than failing. §2.3's "notifies nobody,
-- silently" — the exact failure this module exists to remove — inside HR's main assignment workflow.
--
-- Comparing case-insensitively would paper over it and leave the slug-vs-name mismatch in place. The
-- fix is to target the unit by id, which is what this column is for.
--
-- ── Deliberately NOT dropping department_filter ──────────────────────────────
-- It is still written and read by TaskManagement.tsx's own list filter. Dropping it is 06 §5 step 6,
-- gated behind the same frontend work as `employees.department`. Both columns coexist until then;
-- the frontend writes both, exactly as chat_channels and projects already do.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS public.tasks_org_unit_id_idx;
--   ALTER TABLE public.tasks DROP COLUMN IF EXISTS org_unit_id;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS org_unit_id uuid REFERENCES public.org_units(id);

-- Mirrors the access pattern TaskManagement.tsx:85 uses (tenant + target unit).
CREATE INDEX IF NOT EXISTS tasks_org_unit_id_idx
  ON public.tasks (tenant_id, org_unit_id)
  WHERE org_unit_id IS NOT NULL;

-- Backfill by name, case-insensitive and tenant-scoped — same shape as the Slice B backfills.
-- Case-insensitive because the drift being repaired IS case (`Hr`/`HR`, `sales`/`Sales`).
-- Tenant-scoped because a cross-tenant name match baked into a migration is a tenancy breach.
-- Live data at author time: 3 tasks, ALL with department_filter NULL, so this is a no-op today. It is
-- written anyway so a replay onto a project that HAS department-scoped tasks converges.
UPDATE public.tasks t
SET org_unit_id = ou.id
FROM public.org_units ou
WHERE t.org_unit_id IS NULL
  AND t.department_filter IS NOT NULL
  AND ou.tenant_id = t.tenant_id
  AND lower(ou.name) = lower(t.department_filter);

-- ── Verify after applying ────────────────────────────────────────────────────
--   -- column and index exist:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'tasks' AND column_name = 'org_unit_id';
--
--   -- any department-scoped task that could NOT be resolved to a unit (needs a human look):
--   SELECT id, department_filter FROM tasks
--   WHERE department_filter IS NOT NULL AND org_unit_id IS NULL;
