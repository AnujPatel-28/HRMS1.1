-- Phase 1, step 2: align the denormalised org text columns to their foreign keys.
--
-- `employees` stores department and designation TWICE — once as text, once as an FK — and both
-- EmployeeCreate.tsx and EmployeeDetail.tsx dual-write them through a `legacyValue` map. The copies
-- have drifted (verified 2026-08-18, 16 employees): 7 rows disagree on department, 1 on designation.
-- The drift is case-only: `dev`/`Dev`, `HR`/`Hr`, `sales`/`Sales`, `marketing`/`Marketing`.
--
-- WHY IT MATTERS: five RLS policies key access control off the TEXT column with an exact string match
-- (hr_policies.policies_visible_to_all, projects.projects_employee_read, three on chat_messages). A
-- policy scoped to `Hr` would be invisible to an employee whose row says `HR`.
--
-- WHY IT IS SAFE NOW: nothing is department-scoped yet — hr_policies has 1 row (visible_to = 'all'),
-- projects 1 row (unscoped), and none of the 7 chat_channels sets target_departments. No existing
-- visibility decision depends on these values, so this cannot change who sees what. It closes the gap
-- before the first scoped document is created. The FK wins because it points at a managed reference
-- row; steps 5-6 drop the text columns once the frontend stops writing them.
--
-- ── employment_type is deliberately EXCLUDED ────────────────────────────────
-- It looked like 6 more contradictions, but that was a false positive. `employees.employment_type` is
-- a CHECK-constrained enum ('full_time', 'intern', …) while `employment_types.name` is a display label
-- ('Full Time', 'Intern'). Every pair follows that convention consistently, so it is a code/label
-- pairing, not drift — and backfilling would violate employees_employment_type_check.
--
-- ── Reference-data typos found but NOT fixed here ───────────────────────────
-- These belong to other tenants' own data, so they are flagged rather than silently rewritten:
--   * org_units 'Hr'            (tenants da7a0000, 97da3641) — should read 'HR'
--   * job_titles 'iNTERN'       (tenant 97da3641, 2 employees) — casing
--   * job_titles 'intern'       (tenant 97da3641, 0 employees) — an unused duplicate of the above;
--                                the only genuine within-tenant duplicate in the reference tables
--   * job_titles 'Back-End Devloper' (tenant 111035ce) — misspelling
-- Note this backfill therefore propagates 'iNTERN' onto one employee row. That is intentional:
-- consistency with the FK is the goal here, and correcting a customer's label is their call.
--
-- (What initially looked like duplicate org_units — Dev/Hr/Sales each twice — is correct
-- multi-tenancy: one per tenant, never two within the same tenant.)

UPDATE public.employees e
SET department = ou.name
FROM public.org_units ou
WHERE ou.id = e.org_unit_id
  AND e.department IS DISTINCT FROM ou.name;

UPDATE public.employees e
SET designation = jt.title
FROM public.job_titles jt
WHERE jt.id = e.job_title_id
  AND e.designation IS DISTINCT FROM jt.title;
