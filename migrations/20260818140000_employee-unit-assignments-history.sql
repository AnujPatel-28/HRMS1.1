-- Phase 1, step 3.5: make org-unit membership effective-dated.
--
-- Design: doc/architecture/06-organisation-management.md §3.5.
--
-- `employees.org_unit_id` is a plain mutable column. Moving someone from Engineering to Sales
-- destroys the previous truth, so the system cannot answer "which department was this person in when
-- we ran February payroll?" or "headcount by department over time".
--
-- This is principle P3 (derive from immutable entries, never overwrite) applied to org membership. It
-- is also an inconsistency inside our own model: `employee_reporting_relationships` is ALREADY
-- effective-dated, so who-you-report-to has history while which-unit-you-are-in does not. Same class
-- of fact, two standards.
--
-- Payroll cost allocation depends on this, which is why it is built now rather than at the payroll
-- phase — with 16 employees the backfill is trivial and hand-checkable.

CREATE TABLE IF NOT EXISTS public.employee_unit_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  org_unit_id    uuid NOT NULL REFERENCES public.org_units(id),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  reason         text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_unit_assignments_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One current assignment per employee.
CREATE UNIQUE INDEX IF NOT EXISTS employee_unit_current_uniq
  ON public.employee_unit_assignments (employee_id) WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS employee_unit_lookup
  ON public.employee_unit_assignments (tenant_id, employee_id, effective_from);

-- Backfill from today's state. date_of_joining is the honest starting point where known: it is when
-- the person actually joined that unit as far as this system can tell. Rows with no unit are skipped
-- rather than invented.
INSERT INTO public.employee_unit_assignments (tenant_id, employee_id, org_unit_id, effective_from, reason)
SELECT e.tenant_id, e.id, e.org_unit_id, COALESCE(e.date_of_joining, CURRENT_DATE), 'migrated opening assignment'
FROM public.employees e
WHERE e.org_unit_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- `employees.org_unit_id` stays as a denormalised pointer to the CURRENT assignment, kept in sync by
-- trigger rather than by application code. The dual-write this module exists to remove is what
-- application-managed sync produces (§2.1) — so the sync lives in the database.
CREATE OR REPLACE FUNCTION public.sync_employee_current_unit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.employees e
    SET org_unit_id = (
      SELECT a.org_unit_id FROM public.employee_unit_assignments a
      WHERE a.employee_id = OLD.employee_id AND a.effective_to IS NULL
      ORDER BY a.effective_from DESC LIMIT 1
    )
    WHERE e.id = OLD.employee_id;
    RETURN OLD;
  END IF;

  IF NEW.effective_to IS NULL THEN
    UPDATE public.employees e SET org_unit_id = NEW.org_unit_id WHERE e.id = NEW.employee_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_unit_assignment_sync ON public.employee_unit_assignments;
CREATE TRIGGER employee_unit_assignment_sync
AFTER INSERT OR UPDATE OR DELETE ON public.employee_unit_assignments
FOR EACH ROW EXECUTE FUNCTION public.sync_employee_current_unit();

ALTER TABLE public.employee_unit_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_unit_assignments_tenant_select ON public.employee_unit_assignments
FOR SELECT TO authenticated
USING ((SELECT public.can_access_tenant(employee_unit_assignments.tenant_id)));

CREATE POLICY employee_unit_assignments_hr_all ON public.employee_unit_assignments
FOR ALL TO authenticated
USING      ((SELECT public.can_access_tenant(employee_unit_assignments.tenant_id)) AND (SELECT public.is_hr()))
WITH CHECK ((SELECT public.can_access_tenant(employee_unit_assignments.tenant_id)) AND (SELECT public.is_hr()));
