-- Migration: Tenant isolation for tenant_settings
-- Created: 2026-08-13
-- Target: public.tenant_settings
--
-- tenant_settings had RLS switched off entirely with zero policies, so any authenticated user of
-- ANY tenant could read and write EVERY tenant's configuration. This table holds payroll policy
-- (pf_wage_ceiling, esi_gross_ceiling, professional_tax_state, lop_calculation_method,
-- payroll_lock_date), attendance rules (punch_out_gate_enabled) and leave rules
-- (leave_min_notice_days) — so the hole allowed both cross-tenant disclosure and privilege
-- escalation (an employee could raise their own payroll ceilings or disable the punch-out gate).
--
-- Access model chosen:
--   SELECT  -> any authenticated user within their own tenant
--   WRITE   -> HR only, within their own tenant
--
-- Employees genuinely need read access: src/employee/PunchInOut.tsx reads all keys for the tenant
-- and src/employee/MyLeaves.tsx reads leave_min_notice_days. Restricting reads to a key whitelist
-- would be tighter still, but requires a frontend change first — tracked as follow-up hardening.

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO authenticated;

-- Read: own tenant only.
DROP POLICY IF EXISTS tenant_settings_tenant_select ON public.tenant_settings;
CREATE POLICY tenant_settings_tenant_select ON public.tenant_settings
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id));

-- Write: HR of that tenant only. Split per command so the WITH CHECK on INSERT/UPDATE also pins
-- tenant_id, preventing an HR user from writing a row into someone else's tenant.
DROP POLICY IF EXISTS tenant_settings_hr_insert ON public.tenant_settings;
CREATE POLICY tenant_settings_hr_insert ON public.tenant_settings
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

DROP POLICY IF EXISTS tenant_settings_hr_update ON public.tenant_settings;
CREATE POLICY tenant_settings_hr_update ON public.tenant_settings
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

DROP POLICY IF EXISTS tenant_settings_hr_delete ON public.tenant_settings;
CREATE POLICY tenant_settings_hr_delete ON public.tenant_settings
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr());
