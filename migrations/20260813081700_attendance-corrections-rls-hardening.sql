-- Migration: Harden attendance_corrections RLS policies
-- Created: 2026-07-12
-- Target: public.attendance_corrections

-- Drop existing permissive tenant_isolation policy
DROP POLICY IF EXISTS tenant_isolation ON public.attendance_corrections;

-- Re-create tenant_isolation as RESTRICTIVE to ensure it is always ANDed with employee check
CREATE POLICY tenant_isolation ON public.attendance_corrections
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (tenant_id = get_auth_tenant_id())
  WITH CHECK (tenant_id = get_auth_tenant_id());
