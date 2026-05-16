CREATE TABLE IF NOT EXISTS public.salary_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  effective_from date NOT NULL,
  ctc_annual numeric NOT NULL,
  basic_percent numeric NOT NULL DEFAULT 40,
  hra_percent numeric NOT NULL DEFAULT 50,
  special_allowance numeric NOT NULL DEFAULT 0,
  pf_applicable boolean NOT NULL DEFAULT true,
  esi_applicable boolean NOT NULL DEFAULT false,
  tds_monthly numeric NOT NULL DEFAULT 0,
  other_allowances numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.employees(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, employee_id, effective_from)
);

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  month integer NOT NULL,
  year integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total_gross numeric,
  total_deductions numeric,
  total_net numeric,
  employee_count integer,
  run_by uuid REFERENCES public.employees(id),
  approved_by uuid REFERENCES public.employees(id),
  approved_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, month, year),
  CHECK (month BETWEEN 1 AND 12),
  CHECK (status IN ('draft', 'under_review', 'approved', 'paid'))
);

CREATE TABLE IF NOT EXISTS public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  month integer NOT NULL,
  year integer NOT NULL,
  days_in_month integer NOT NULL,
  working_days integer NOT NULL,
  days_present integer NOT NULL,
  days_absent integer NOT NULL,
  days_on_leave integer NOT NULL,
  half_days integer NOT NULL DEFAULT 0,
  basic_monthly numeric NOT NULL,
  hra_monthly numeric NOT NULL,
  special_allowance numeric NOT NULL,
  other_allowances numeric NOT NULL,
  gross_salary numeric NOT NULL,
  pf_employee numeric NOT NULL DEFAULT 0,
  pf_employer numeric NOT NULL DEFAULT 0,
  esi_employee numeric NOT NULL DEFAULT 0,
  esi_employer numeric NOT NULL DEFAULT 0,
  tds numeric NOT NULL DEFAULT 0,
  other_deductions numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL,
  net_payable numeric NOT NULL,
  pdf_url text,
  emailed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, payroll_run_id, employee_id),
  CHECK (month BETWEEN 1 AND 12)
);

ALTER TABLE public.salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.salary_structures;
CREATE POLICY tenant_isolation
ON public.salary_structures
FOR ALL
TO authenticated
USING ((SELECT public.can_access_tenant(tenant_id)))
WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS tenant_active_restrictive ON public.salary_structures;
CREATE POLICY tenant_active_restrictive
ON public.salary_structures
AS RESTRICTIVE
FOR ALL
TO public
USING ((SELECT public.can_access_tenant(tenant_id)))
WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS project_admin_policy ON public.salary_structures;
CREATE POLICY project_admin_policy
ON public.salary_structures
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS tenant_isolation ON public.payroll_runs;
CREATE POLICY tenant_isolation
ON public.payroll_runs
FOR ALL
TO authenticated
USING ((SELECT public.can_access_tenant(tenant_id)))
WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS tenant_active_restrictive ON public.payroll_runs;
CREATE POLICY tenant_active_restrictive
ON public.payroll_runs
AS RESTRICTIVE
FOR ALL
TO public
USING ((SELECT public.can_access_tenant(tenant_id)))
WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS project_admin_policy ON public.payroll_runs;
CREATE POLICY project_admin_policy
ON public.payroll_runs
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS tenant_isolation ON public.payslips;
CREATE POLICY tenant_isolation
ON public.payslips
FOR ALL
TO authenticated
USING ((SELECT public.can_access_tenant(tenant_id)))
WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS tenant_active_restrictive ON public.payslips;
CREATE POLICY tenant_active_restrictive
ON public.payslips
AS RESTRICTIVE
FOR ALL
TO public
USING ((SELECT public.can_access_tenant(tenant_id)))
WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS project_admin_policy ON public.payslips;
CREATE POLICY project_admin_policy
ON public.payslips
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);
