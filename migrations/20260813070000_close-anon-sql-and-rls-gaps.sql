-- Migration: Close anon-callable SQL execution and un-protected table gaps
-- Created: 2026-08-13
-- Target: public.exec_sql, public.query_json, public.update_user_password,
--         public.org_units, public.job_titles, public.locations,
--         public.employment_types, public.exit_clearances, public.exit_clearance_templates
--
-- Findings this closes (verified live on parent rq3qmu8y on 2026-08-13):
--   1. exec_sql / query_json were SECURITY DEFINER with EXECUTE granted to `anon`.
--      POST /api/database/rpc/query_json with only the public anon key (the key shipped
--      in the frontend JS bundle) returned live query results -> unauthenticated
--      arbitrary SQL read/write against every tenant.
--   2. update_user_password was SECURITY DEFINER with EXECUTE granted to `anon` AND
--      PUBLIC -> anyone could set any user's password (account takeover).
--   3. Six tables had RLS switched off entirely with zero policies -> no tenant
--      isolation on org/location/employment reference data and exit clearances.
--
-- No application code calls these three routines (verified: no hits in src/ or
-- functions/). project_admin retains EXECUTE so admin-key tooling keeps working.
-- Policy bodies below match the definitions from the updateSuggestion backend branch.

-- ==========================================
-- 1. Revoke arbitrary-SQL and password RPCs from untrusted roles
-- ==========================================
REVOKE ALL ON FUNCTION public.exec_sql(query text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.query_json(query_text text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_user_password(p_user_id uuid, p_password text) FROM PUBLIC, anon, authenticated;

-- Pin search_path so a hostile schema cannot shadow objects these definers resolve.
ALTER FUNCTION public.exec_sql(query text) SET search_path = public;
ALTER FUNCTION public.query_json(query_text text) SET search_path = public;
ALTER FUNCTION public.update_user_password(p_user_id uuid, p_password text) SET search_path = public;

-- ==========================================
-- 2. Turn on RLS for the six unprotected tables
-- ==========================================
ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exit_clearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exit_clearance_templates ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 3. Tenant-scoped policies (HR: full control, everyone else: read within tenant)
-- ==========================================
DROP POLICY IF EXISTS org_units_hr_all ON public.org_units;
CREATE POLICY org_units_hr_all ON public.org_units
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

DROP POLICY IF EXISTS org_units_tenant_select ON public.org_units;
CREATE POLICY org_units_tenant_select ON public.org_units
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id));

DROP POLICY IF EXISTS job_titles_hr_all ON public.job_titles;
CREATE POLICY job_titles_hr_all ON public.job_titles
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

DROP POLICY IF EXISTS job_titles_tenant_select ON public.job_titles;
CREATE POLICY job_titles_tenant_select ON public.job_titles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id));

DROP POLICY IF EXISTS locations_hr_all ON public.locations;
CREATE POLICY locations_hr_all ON public.locations
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

DROP POLICY IF EXISTS locations_tenant_select ON public.locations;
CREATE POLICY locations_tenant_select ON public.locations
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id));

DROP POLICY IF EXISTS employment_types_hr_all ON public.employment_types;
CREATE POLICY employment_types_hr_all ON public.employment_types
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

DROP POLICY IF EXISTS employment_types_tenant_select ON public.employment_types;
CREATE POLICY employment_types_tenant_select ON public.employment_types
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id));

DROP POLICY IF EXISTS exit_clearances_hr_all ON public.exit_clearances;
CREATE POLICY exit_clearances_hr_all ON public.exit_clearances
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

DROP POLICY IF EXISTS exit_clearances_tenant_select ON public.exit_clearances;
CREATE POLICY exit_clearances_tenant_select ON public.exit_clearances
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id));

DROP POLICY IF EXISTS exit_clearance_templates_hr_all ON public.exit_clearance_templates;
CREATE POLICY exit_clearance_templates_hr_all ON public.exit_clearance_templates
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

DROP POLICY IF EXISTS exit_clearance_templates_tenant_select ON public.exit_clearance_templates;
CREATE POLICY exit_clearance_templates_tenant_select ON public.exit_clearance_templates
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id));
