-- Migration: Phase 2 Onboarding State Table

CREATE TABLE IF NOT EXISTS public.employee_onboarding (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending_auth',
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.employee_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR can manage employee_onboarding in their tenant"
ON public.employee_onboarding FOR ALL TO authenticated
USING (public.can_access_tenant(tenant_id))
WITH CHECK (public.can_access_tenant(tenant_id));

-- Trigger for updated_at
CREATE TRIGGER set_employee_onboarding_updated_at
BEFORE UPDATE ON public.employee_onboarding
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();
