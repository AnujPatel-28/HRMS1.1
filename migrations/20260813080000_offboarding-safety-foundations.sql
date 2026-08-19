-- Phase 1 safety and Phase 2 foundations for Employees, Directory, Org Chart, and Offboarding.
-- This migration is intentionally additive: current text fields and flat clearance booleans keep working.

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_status_check
CHECK (status IN (
  'active',
  'inactive',
  'terminated',
  'draft',
  'pending_hr_review',
  'pending_onboarding'
));

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employment_type_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_employment_type_check
CHECK (
  employment_type IS NULL
  OR employment_type IN (
    'full_time',
    'part_time',
    'contract',
    'consultant',
    'freelancer',
    'intern',
    'temporary',
    'vendor'
  )
);

CREATE TABLE IF NOT EXISTS public.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  name text NOT NULL,
  unit_type text NOT NULL DEFAULT 'department',
  code text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_units_unit_type_check CHECK (unit_type IN (
    'company',
    'business_unit',
    'division',
    'department',
    'team',
    'sub_team',
    'project',
    'other'
  )),
  CONSTRAINT org_units_unique_name_per_parent UNIQUE (tenant_id, parent_id, name)
);

CREATE TABLE IF NOT EXISTS public.job_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  grade text,
  level text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_titles_unique_title_grade UNIQUE (tenant_id, title, grade)
);

CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  country text,
  state text,
  city text,
  timezone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_unique_name UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS public.employment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employment_types_unique_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS public.employee_reporting_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'primary',
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_reporting_no_self CHECK (employee_id <> manager_id),
  CONSTRAINT employee_reporting_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_reporting_type_check CHECK (relationship_type IN (
    'primary',
    'secondary',
    'mentor',
    'project_manager',
    'reviewer',
    'temporary'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_reporting_one_active_primary
ON public.employee_reporting_relationships(employee_id)
WHERE relationship_type = 'primary' AND is_active = true AND effective_to IS NULL;

CREATE TABLE IF NOT EXISTS public.exit_clearance_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exit_clearance_templates_unique_department UNIQUE (tenant_id, department)
);

CREATE TABLE IF NOT EXISTS public.exit_clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exit_request_id uuid NOT NULL REFERENCES public.exit_requests(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.exit_clearance_templates(id) ON DELETE SET NULL,
  department text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_at timestamptz,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exit_clearances_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT exit_clearances_unique_department UNIQUE (exit_request_id, department)
);

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS org_unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS job_title_id uuid REFERENCES public.job_titles(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_type_id uuid REFERENCES public.employment_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_units_tenant_parent ON public.org_units(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_job_titles_tenant_title ON public.job_titles(tenant_id, title);
CREATE INDEX IF NOT EXISTS idx_locations_tenant_name ON public.locations(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_employment_types_tenant_code ON public.employment_types(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_employee_reporting_tenant_employee ON public.employee_reporting_relationships(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_reporting_tenant_manager ON public.employee_reporting_relationships(tenant_id, manager_id);
CREATE INDEX IF NOT EXISTS idx_exit_clearance_templates_tenant ON public.exit_clearance_templates(tenant_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_exit_clearances_request ON public.exit_clearances(exit_request_id, status);
CREATE INDEX IF NOT EXISTS idx_employees_org_unit ON public.employees(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_employees_job_title ON public.employees(job_title_id);
CREATE INDEX IF NOT EXISTS idx_employees_location ON public.employees(location_id);
CREATE INDEX IF NOT EXISTS idx_exit_requests_tenant_status ON public.exit_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_exit_requests_employee_status ON public.exit_requests(employee_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS exit_requests_one_active_per_employee
ON public.exit_requests(employee_id)
WHERE status IN ('pending_approval', 'notice_period', 'clearance_pending');

INSERT INTO public.org_units (tenant_id, name, unit_type)
SELECT DISTINCT tenant_id, initcap(trim(department)), 'department'
FROM public.employees
WHERE department IS NOT NULL AND trim(department) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.job_titles (tenant_id, title, grade)
SELECT DISTINCT tenant_id, trim(designation), NULLIF(trim(grade), '')
FROM public.employees
WHERE designation IS NOT NULL AND trim(designation) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.locations (tenant_id, name)
SELECT DISTINCT tenant_id, trim(work_location)
FROM public.employees
WHERE work_location IS NOT NULL AND trim(work_location) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.employment_types (tenant_id, name, code)
SELECT DISTINCT
  tenant_id,
  initcap(replace(trim(employment_type), '_', ' ')),
  trim(employment_type)
FROM public.employees
WHERE employment_type IS NOT NULL AND trim(employment_type) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.exit_clearance_templates (tenant_id, department, label, sort_order)
SELECT t.id, template.department, template.label, template.sort_order
FROM public.tenants t
CROSS JOIN (VALUES
  ('assets', 'Asset Clearance', 10),
  ('it', 'IT / Accounts Deactivation', 20),
  ('finance', 'Finance / Final Settlement', 30),
  ('hr', 'HR Clearance & Documentation', 40),
  ('admin', 'Admin / Access Card Revocation', 50)
) AS template(department, label, sort_order)
ON CONFLICT DO NOTHING;

UPDATE public.employees e
SET org_unit_id = ou.id
FROM public.org_units ou
WHERE e.org_unit_id IS NULL
  AND ou.tenant_id = e.tenant_id
  AND lower(ou.name) = lower(trim(e.department));

UPDATE public.employees e
SET job_title_id = jt.id
FROM public.job_titles jt
WHERE e.job_title_id IS NULL
  AND jt.tenant_id = e.tenant_id
  AND lower(jt.title) = lower(trim(e.designation))
  AND COALESCE(jt.grade, '') = COALESCE(NULLIF(trim(e.grade), ''), '');

UPDATE public.employees e
SET location_id = l.id
FROM public.locations l
WHERE e.location_id IS NULL
  AND l.tenant_id = e.tenant_id
  AND lower(l.name) = lower(trim(e.work_location));

UPDATE public.employees e
SET employment_type_id = et.id
FROM public.employment_types et
WHERE e.employment_type_id IS NULL
  AND et.tenant_id = e.tenant_id
  AND et.code = e.employment_type;

INSERT INTO public.employee_reporting_relationships (
  tenant_id,
  employee_id,
  manager_id,
  relationship_type,
  effective_from
)
SELECT tenant_id, id, manager_id, 'primary', COALESCE(date_of_joining, CURRENT_DATE)
FROM public.employees
WHERE manager_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.employee_reporting_relationships (
  tenant_id,
  employee_id,
  manager_id,
  relationship_type,
  effective_from
)
SELECT tenant_id, id, secondary_manager_id, 'secondary', COALESCE(date_of_joining, CURRENT_DATE)
FROM public.employees
WHERE secondary_manager_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_org_units_updated_at ON public.org_units;
CREATE TRIGGER set_org_units_updated_at
BEFORE UPDATE ON public.org_units
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_job_titles_updated_at ON public.job_titles;
CREATE TRIGGER set_job_titles_updated_at
BEFORE UPDATE ON public.job_titles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_locations_updated_at ON public.locations;
CREATE TRIGGER set_locations_updated_at
BEFORE UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_employment_types_updated_at ON public.employment_types;
CREATE TRIGGER set_employment_types_updated_at
BEFORE UPDATE ON public.employment_types
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_employee_reporting_updated_at ON public.employee_reporting_relationships;
CREATE TRIGGER set_employee_reporting_updated_at
BEFORE UPDATE ON public.employee_reporting_relationships
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_exit_clearance_templates_updated_at ON public.exit_clearance_templates;
CREATE TRIGGER set_exit_clearance_templates_updated_at
BEFORE UPDATE ON public.exit_clearance_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_exit_clearances_updated_at ON public.exit_clearances;
CREATE TRIGGER set_exit_clearances_updated_at
BEFORE UPDATE ON public.exit_clearances
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.seed_exit_clearances()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.exit_clearances (
    tenant_id,
    exit_request_id,
    template_id,
    department,
    label
  )
  SELECT
    NEW.tenant_id,
    NEW.id,
    t.id,
    t.department,
    t.label
  FROM public.exit_clearance_templates t
  WHERE t.tenant_id = NEW.tenant_id
    AND t.is_active = true
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_exit_clearances_after_insert ON public.exit_requests;
CREATE TRIGGER seed_exit_clearances_after_insert
AFTER INSERT ON public.exit_requests
FOR EACH ROW EXECUTE FUNCTION public.seed_exit_clearances();

INSERT INTO public.exit_clearances (
  tenant_id,
  exit_request_id,
  template_id,
  department,
  label,
  status
)
SELECT
  er.tenant_id,
  er.id,
  ect.id,
  ect.department,
  ect.label,
  CASE
    WHEN ect.department = 'assets' AND er.clearance_assets THEN 'approved'
    WHEN ect.department = 'it' AND er.clearance_it THEN 'approved'
    WHEN ect.department = 'finance' AND er.clearance_finance THEN 'approved'
    WHEN ect.department = 'hr' AND er.clearance_hr THEN 'approved'
    WHEN ect.department = 'admin' AND er.clearance_admin THEN 'approved'
    ELSE 'pending'
  END
FROM public.exit_requests er
JOIN public.exit_clearance_templates ect
  ON ect.tenant_id = er.tenant_id
 AND ect.is_active = true
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.complete_exit_transaction(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.exit_requests%ROWTYPE;
  v_actor_employee_id uuid;
  v_pending_clearance_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can complete offboarding';
  END IF;

  SELECT *
  INTO v_request
  FROM public.exit_requests
  WHERE id = p_request_id
    AND tenant_id = public.get_auth_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exit request not found';
  END IF;

  IF v_request.status = 'completed' THEN
    RAISE EXCEPTION 'Exit request is already completed';
  END IF;

  IF v_request.status NOT IN ('notice_period', 'clearance_pending') THEN
    RAISE EXCEPTION 'Exit request must be in notice period or clearance pending before completion';
  END IF;

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_request.tenant_id
  LIMIT 1;

  SELECT COUNT(*)
  INTO v_pending_clearance_count
  FROM public.exit_clearances
  WHERE exit_request_id = p_request_id
    AND status <> 'approved';

  IF v_pending_clearance_count = 0 THEN
    NULL;
  ELSIF NOT (
    COALESCE(v_request.clearance_assets, false)
    AND COALESCE(v_request.clearance_it, false)
    AND COALESCE(v_request.clearance_finance, false)
    AND COALESCE(v_request.clearance_hr, false)
    AND COALESCE(v_request.clearance_admin, false)
  ) THEN
    RAISE EXCEPTION 'Cannot complete exit: % clearance item(s) are still pending', v_pending_clearance_count;
  END IF;

  UPDATE public.employees
  SET status = 'inactive',
      updated_at = now()
  WHERE id = v_request.employee_id
    AND tenant_id = v_request.tenant_id
    AND status NOT IN ('inactive', 'terminated');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee is already inactive, terminated, or unavailable';
  END IF;

  UPDATE public.exit_requests
  SET status = 'completed',
      updated_at = now()
  WHERE id = p_request_id
    AND tenant_id = v_request.tenant_id;

  INSERT INTO public.audit_logs (
    tenant_id,
    actor_id,
    actor_role,
    action,
    target_type,
    target_id,
    details,
    status
  )
  VALUES (
    v_request.tenant_id,
    v_actor_employee_id,
    'hr',
    'offboarding.completed',
    'exit_requests',
    p_request_id,
    jsonb_build_object(
      'employee_id', v_request.employee_id,
      'previous_exit_status', v_request.status,
      'new_employee_status', 'inactive'
    ),
    'success'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_exit_transaction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_exit_transaction(uuid) TO authenticated;

ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_reporting_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exit_clearance_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exit_clearances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_units_tenant_select ON public.org_units;
CREATE POLICY org_units_tenant_select
ON public.org_units FOR SELECT TO authenticated
USING (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS org_units_hr_all ON public.org_units;
CREATE POLICY org_units_hr_all
ON public.org_units FOR ALL TO authenticated
USING (public.can_access_tenant(tenant_id) AND public.is_hr())
WITH CHECK (public.can_access_tenant(tenant_id) AND public.is_hr());

DROP POLICY IF EXISTS job_titles_tenant_select ON public.job_titles;
CREATE POLICY job_titles_tenant_select
ON public.job_titles FOR SELECT TO authenticated
USING (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS job_titles_hr_all ON public.job_titles;
CREATE POLICY job_titles_hr_all
ON public.job_titles FOR ALL TO authenticated
USING (public.can_access_tenant(tenant_id) AND public.is_hr())
WITH CHECK (public.can_access_tenant(tenant_id) AND public.is_hr());

DROP POLICY IF EXISTS locations_tenant_select ON public.locations;
CREATE POLICY locations_tenant_select
ON public.locations FOR SELECT TO authenticated
USING (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS locations_hr_all ON public.locations;
CREATE POLICY locations_hr_all
ON public.locations FOR ALL TO authenticated
USING (public.can_access_tenant(tenant_id) AND public.is_hr())
WITH CHECK (public.can_access_tenant(tenant_id) AND public.is_hr());

DROP POLICY IF EXISTS employment_types_tenant_select ON public.employment_types;
CREATE POLICY employment_types_tenant_select
ON public.employment_types FOR SELECT TO authenticated
USING (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS employment_types_hr_all ON public.employment_types;
CREATE POLICY employment_types_hr_all
ON public.employment_types FOR ALL TO authenticated
USING (public.can_access_tenant(tenant_id) AND public.is_hr())
WITH CHECK (public.can_access_tenant(tenant_id) AND public.is_hr());

DROP POLICY IF EXISTS employee_reporting_tenant_select ON public.employee_reporting_relationships;
CREATE POLICY employee_reporting_tenant_select
ON public.employee_reporting_relationships FOR SELECT TO authenticated
USING (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS employee_reporting_hr_all ON public.employee_reporting_relationships;
CREATE POLICY employee_reporting_hr_all
ON public.employee_reporting_relationships FOR ALL TO authenticated
USING (public.can_access_tenant(tenant_id) AND public.is_hr())
WITH CHECK (public.can_access_tenant(tenant_id) AND public.is_hr());

DROP POLICY IF EXISTS exit_clearance_templates_tenant_select ON public.exit_clearance_templates;
CREATE POLICY exit_clearance_templates_tenant_select
ON public.exit_clearance_templates FOR SELECT TO authenticated
USING (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS exit_clearance_templates_hr_all ON public.exit_clearance_templates;
CREATE POLICY exit_clearance_templates_hr_all
ON public.exit_clearance_templates FOR ALL TO authenticated
USING (public.can_access_tenant(tenant_id) AND public.is_hr())
WITH CHECK (public.can_access_tenant(tenant_id) AND public.is_hr());

DROP POLICY IF EXISTS exit_clearances_tenant_select ON public.exit_clearances;
CREATE POLICY exit_clearances_tenant_select
ON public.exit_clearances FOR SELECT TO authenticated
USING (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS exit_clearances_hr_all ON public.exit_clearances;
CREATE POLICY exit_clearances_hr_all
ON public.exit_clearances FOR ALL TO authenticated
USING (public.can_access_tenant(tenant_id) AND public.is_hr())
WITH CHECK (public.can_access_tenant(tenant_id) AND public.is_hr());

GRANT SELECT ON public.org_units TO authenticated;
GRANT SELECT ON public.job_titles TO authenticated;
GRANT SELECT ON public.locations TO authenticated;
GRANT SELECT ON public.employment_types TO authenticated;
GRANT SELECT ON public.employee_reporting_relationships TO authenticated;
GRANT SELECT ON public.exit_clearance_templates TO authenticated;
GRANT SELECT ON public.exit_clearances TO authenticated;

GRANT INSERT, UPDATE, DELETE ON public.org_units TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.job_titles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.employment_types TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.employee_reporting_relationships TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.exit_clearance_templates TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.exit_clearances TO authenticated;
