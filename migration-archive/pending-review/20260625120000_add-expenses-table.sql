-- Migration to add expenses table and configure RLS
-- Created on 2026-06-25

BEGIN;

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  title text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  category text NOT NULL CHECK (category IN ('travel', 'food', 'accommodation', 'equipment', 'medical', 'other')),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  receipt_url text,
  receipt_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'reimbursed')),
  reviewed_by uuid REFERENCES public.employees(id),
  reviewed_at timestamptz,
  rejection_reason text,
  payroll_run_id uuid REFERENCES public.payroll_runs(id),
  reimbursed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS expenses_reimbursement numeric NOT NULL DEFAULT 0;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Clean up any existing policies to avoid conflicts
DROP POLICY IF EXISTS expenses_self_read ON public.expenses;
DROP POLICY IF EXISTS expenses_self_insert ON public.expenses;
DROP POLICY IF EXISTS expenses_self_delete ON public.expenses;
DROP POLICY IF EXISTS expenses_hr_select ON public.expenses;
DROP POLICY IF EXISTS expenses_hr_update ON public.expenses;
DROP POLICY IF EXISTS expenses_restrictive ON public.expenses;

-- Employees read their own expenses
CREATE POLICY expenses_self_read ON public.expenses
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = expenses.employee_id
      AND e.user_id = auth.uid()
  ));

-- Employees insert their own expenses
CREATE POLICY expenses_self_insert ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = expenses.employee_id
      AND e.user_id = auth.uid()
  ));

-- Employees delete their own pending expenses
CREATE POLICY expenses_self_delete ON public.expenses
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = expenses.employee_id
        AND e.user_id = auth.uid()
    )
    AND status = 'pending'
  );

-- HR read all expenses
CREATE POLICY expenses_hr_select ON public.expenses
  FOR SELECT TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

-- HR update expenses (approve/reject)
CREATE POLICY expenses_hr_update ON public.expenses
  FOR UPDATE TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

-- Restrictive policy for tenant isolation
CREATE POLICY expenses_restrictive ON public.expenses
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT can_access_tenant(tenant_id)));

COMMIT;
