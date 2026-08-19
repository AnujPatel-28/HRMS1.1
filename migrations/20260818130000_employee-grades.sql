-- Phase 1, step 8: employee grades as a first-class entity.
--
-- Design: doc/architecture/06-organisation-management.md §3.3.
--
-- `employees.grade` exists today as free text and is used by ZERO employees. That is the symptom, not
-- the cause: grade-as-text can carry no defaults, so there was never a reason to populate it. Frappe
-- hangs default leave policy and salary structure off Employee Grade; we add notice period and
-- probation now, and the salary structure at the payroll phase.
--
-- Grade is NOT structural — it is orthogonal to the org tree. Someone in Engineering and someone in
-- Sales can both be L3.

CREATE TABLE IF NOT EXISTS public.employee_grades (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  level                    integer NOT NULL,
  default_notice_days      integer,
  default_probation_months integer,
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- default_leave_policy_id is added in Phase 2, when leave policies become entities.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS grade_id uuid REFERENCES public.employee_grades(id) ON DELETE SET NULL;

ALTER TABLE public.job_titles
  ADD COLUMN IF NOT EXISTS default_grade_id uuid REFERENCES public.employee_grades(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employee_grades_tenant_idx ON public.employee_grades (tenant_id) WHERE is_active;

-- No grades are seeded. Banding is a per-company decision — L1..L5, Junior/Mid/Senior, or Band 1..8 —
-- and inventing one would be imposing a structure, exactly what §3.1 avoids for unit types.
-- `employees.grade` (text) is left in place until a tenant populates real grades; it holds no data
-- today, so nothing needs migrating.

ALTER TABLE public.employee_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_grades_tenant_select ON public.employee_grades
FOR SELECT TO authenticated
USING ((SELECT public.can_access_tenant(employee_grades.tenant_id)));

CREATE POLICY employee_grades_hr_all ON public.employee_grades
FOR ALL TO authenticated
USING      ((SELECT public.can_access_tenant(employee_grades.tenant_id)) AND (SELECT public.is_hr()))
WITH CHECK ((SELECT public.can_access_tenant(employee_grades.tenant_id)) AND (SELECT public.is_hr()));
