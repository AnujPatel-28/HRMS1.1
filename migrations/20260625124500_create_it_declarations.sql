-- 1. Create table for Declaration Windows
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

-- 2. Create table for Employee Declarations
CREATE TABLE IF NOT EXISTS public.it_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  financial_year text NOT NULL, -- e.g. '2026-27'
  tax_regime text NOT NULL DEFAULT 'new', -- 'old' or 'new'

  -- Section 80C (max ₹1.5 lakh)
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

  status text NOT NULL DEFAULT 'draft', -- draft / submitted / verified_by_hr
  submitted_at timestamptz,
  verified_by uuid REFERENCES public.employees(id),
  verified_at timestamptz,
  hr_notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, employee_id, financial_year)
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.it_declaration_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.it_declarations ENABLE ROW LEVEL SECURITY;

-- 4. Policies for it_declaration_windows
-- RLS Tenant Isolation (all authenticated users can read within their tenant)
CREATE POLICY windows_tenant_isolation ON public.it_declaration_windows
  FOR ALL TO authenticated
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());

-- HR can manage windows (Insert/Update/Delete)
CREATE POLICY windows_hr_manage ON public.it_declaration_windows
  FOR ALL TO authenticated
  USING (is_hr())
  WITH CHECK (is_hr());

-- 5. Policies for it_declarations
-- RLS Tenant Isolation (all authenticated users can query/insert within their tenant)
CREATE POLICY declarations_tenant_isolation ON public.it_declarations
  FOR ALL TO authenticated
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());

-- Employees can select, insert, or update their own declarations
CREATE POLICY declarations_self_all ON public.it_declarations
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = auth.uid()
  ));

-- HR can select all declarations, and update them (specifically status, hr_notes, verified_by, verified_at)
CREATE POLICY declarations_hr_all ON public.it_declarations
  FOR ALL TO authenticated
  USING (is_hr())
  WITH CHECK (is_hr());
