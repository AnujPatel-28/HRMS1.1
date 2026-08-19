-- Migration: Additive self-read policy for employees table
-- This enables employees to read their own full row (e.g. for Onboarding Wizard, My Profile).
-- Note: This is an additive policy. Existing broad select policies (if any) are NOT revoked in this migration.

DROP POLICY IF EXISTS employees_self_read ON public.employees;

CREATE POLICY employees_self_read ON public.employees
FOR SELECT
USING (
  user_id = auth.uid()
  AND tenant_id = public.get_auth_tenant_id()
);
