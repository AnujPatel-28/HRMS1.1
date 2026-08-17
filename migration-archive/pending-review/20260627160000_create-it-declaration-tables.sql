-- Migration: Create IT Declaration Tables for Sprint 2 S2-E (Tax Declaration)
-- Target: updateSuggestion preview backend (https://rq3qmu8y-jx7.ap-southeast.insforge.app)
-- Date: 2026-06-27

-- TABLE: it_declaration_windows
-- HR opens and closes declaration windows for specific financial years
CREATE TABLE IF NOT EXISTS public.it_declaration_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  financial_year text NOT NULL, -- e.g. '2026-27'
  is_open boolean NOT NULL DEFAULT false,
  opens_at timestamptz,
  closes_at timestamptz,
  opened_by uuid REFERENCES public.employees(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, financial_year)
);

ALTER TABLE public.it_declaration_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS windows_tenant_isolation ON public.it_declaration_windows;
CREATE POLICY windows_tenant_isolation ON public.it_declaration_windows
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS windows_hr_all ON public.it_declaration_windows;
CREATE POLICY windows_hr_all ON public.it_declaration_windows
  FOR ALL TO authenticated
  USING ((SELECT public.is_hr()))
  WITH CHECK ((SELECT public.is_hr()));

-- Employees read-only (to check if window is open)
DROP POLICY IF EXISTS windows_employee_read ON public.it_declaration_windows;
CREATE POLICY windows_employee_read ON public.it_declaration_windows
  FOR SELECT TO authenticated
  USING (true);

-- TABLE: it_declarations
-- Employee's tax declarations per financial year
CREATE TABLE IF NOT EXISTS public.it_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  financial_year text NOT NULL, -- e.g. '2026-27'
  tax_regime text NOT NULL DEFAULT 'new',
  -- 'old' = old regime with deductions, 'new' = new regime without deductions

  -- Section 80C (max Rs. 1.5 lakh)
  ppf_amount numeric DEFAULT 0,
  lic_premium numeric DEFAULT 0,
  elss_mutual_fund numeric DEFAULT 0,
  nsc_amount numeric DEFAULT 0,
  home_loan_principal numeric DEFAULT 0,
  tuition_fees numeric DEFAULT 0,
  other_80c numeric DEFAULT 0,

  -- Section 80D (health insurance premium)
  health_insurance_self numeric DEFAULT 0,
  health_insurance_parents numeric DEFAULT 0,

  -- HRA (if claiming HRA exemption)
  hra_rent_paid_annual numeric DEFAULT 0,
  hra_landlord_name text,
  hra_landlord_pan text,

  -- Home loan interest (Section 24)
  home_loan_interest numeric DEFAULT 0,

  -- Income from previous employer (if joined mid-year)
  prev_employer_income numeric DEFAULT 0,
  prev_employer_tds numeric DEFAULT 0,
  prev_employer_name text,

  -- Reimbursements
  lta_amount numeric DEFAULT 0,
  medical_reimbursement numeric DEFAULT 0,

  status text NOT NULL DEFAULT 'draft',
  -- draft / submitted / verified_by_hr
  submitted_at timestamptz,
  verified_by uuid REFERENCES public.employees(id),
  verified_at timestamptz,
  hr_notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, employee_id, financial_year)
);

ALTER TABLE public.it_declarations ENABLE ROW LEVEL SECURITY;

-- Restrictive tenant isolation
DROP POLICY IF EXISTS declarations_tenant_isolation ON public.it_declarations;
CREATE POLICY declarations_tenant_isolation ON public.it_declarations
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

-- Employees can manage their own declarations
DROP POLICY IF EXISTS declarations_self_all ON public.it_declarations;
CREATE POLICY declarations_self_all ON public.it_declarations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())));

-- HR can read all and manage status/notes for their tenant
DROP POLICY IF EXISTS declarations_hr_all ON public.it_declarations;
CREATE POLICY declarations_hr_all ON public.it_declarations
  FOR ALL TO authenticated
  USING ((SELECT public.is_hr()))
  WITH CHECK ((SELECT public.is_hr()));
