-- Migration to create insurance policies table and configure RLS
-- Created on 2026-06-25

BEGIN;

CREATE TABLE IF NOT EXISTS public.insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  insurer_name text NOT NULL,
  policy_number text NOT NULL,
  policy_type text NOT NULL CHECK (policy_type IN ('Health', 'Life', 'Accident', 'Dental', 'Vision', 'Group')),
  coverage_amount numeric NOT NULL,
  premium_amount numeric NOT NULL,
  premium_frequency text NOT NULL CHECK (premium_frequency IN ('Monthly', 'Quarterly', 'Annual')),
  start_date date NOT NULL,
  expiry_date date NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Cancelled')),
  rm_name text,
  rm_phone text,
  rm_email text,
  rm_company text,
  notes text,
  policy_document_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;

-- Clean up any existing policies to avoid conflicts
DROP POLICY IF EXISTS insurance_policies_self_read ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_hr_all ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_restrictive ON public.insurance_policies;

-- Employees read their own insurance policies
CREATE POLICY insurance_policies_self_read ON public.insurance_policies
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT id FROM public.employees WHERE user_id = auth.uid()));

-- HR has full access to create/read/update/delete in their own tenant
CREATE POLICY insurance_policies_hr_all ON public.insurance_policies
  FOR ALL TO authenticated
  USING ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT is_hr()) AND (SELECT can_access_tenant(tenant_id)));

-- Restrictive policy for tenant isolation
CREATE POLICY insurance_policies_restrictive ON public.insurance_policies
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT can_access_tenant(tenant_id)));

-- 1. Create database function to check insurance expiries (runs as SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.fn_check_insurance_expiries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_rec RECORD;
    v_hr RECORD;
BEGIN
    FOR v_rec IN
        SELECT ip.id, ip.tenant_id, ip.employee_id, ip.policy_type, ip.insurer_name, ip.expiry_date, e.full_name AS employee_name
        FROM public.insurance_policies ip
        JOIN public.employees e ON ip.employee_id = e.id
        WHERE ip.status = 'Active'
          AND ip.expiry_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
    LOOP
        -- 1. Create notification for the employee
        INSERT INTO public.notifications (tenant_id, employee_id, title, body, type)
        VALUES (
            v_rec.tenant_id,
            v_rec.employee_id,
            'Insurance Expiring Soon',
            'Your ' || v_rec.policy_type || ' insurance with ' || v_rec.insurer_name || ' expires on ' || v_rec.expiry_date || '. Please contact HR.',
            'general'
        );

        -- 2. Create notification for all active HRs of this tenant
        FOR v_hr IN
            SELECT id FROM public.employees
            WHERE tenant_id = v_rec.tenant_id
              AND role = 'hr'
              AND status = 'active'
        LOOP
            INSERT INTO public.notifications (tenant_id, employee_id, title, body, type)
            VALUES (
                v_rec.tenant_id,
                v_hr.id,
                'Employee Insurance Expiring',
                v_rec.employee_name || 's ' || v_rec.policy_type || ' insurance expires on ' || v_rec.expiry_date || '.',
                'general'
            );
        END LOOP;
    END LOOP;
END;
$$;

-- Schedule Monthly Expiry Check cron job to run on the 1st of every month at midnight
DO $$
BEGIN
  PERFORM cron.unschedule('insurance-expiry-check');
EXCEPTION WHEN OTHERS THEN
END $$;

SELECT cron.schedule(
  'insurance-expiry-check',
  '0 0 1 * *',
  $$SELECT http_post('https://rq3qmu8y-jx7.functions.insforge.app/insurance-expiry-check', '{}', 'application/json')$$
);

COMMIT;
