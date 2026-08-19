-- Phase 0b, part 1 of 2: the module registry.
--
-- Per-tenant module entitlement, so a superadmin can sell/enable modules per company.
-- Design: doc/architecture/02-module-registry.md
--
-- THIS MIGRATION CHANGES NO BEHAVIOUR. It creates the catalogue, the per-tenant table, and the
-- lookup function, then backfills every existing tenant with every module ENABLED. Enforcement
-- (the RESTRICTIVE policies that make a disabled module actually unreadable) lands separately in
-- 20260817210000 so the enforcement diff can be reviewed on its own.

CREATE TABLE IF NOT EXISTS public.modules (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  is_core     boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 100
);

-- Absence of a row means DISABLED — deny by default (P6).
CREATE TABLE IF NOT EXISTS public.tenant_modules (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES public.modules(key),
  enabled    boolean NOT NULL DEFAULT true,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  enabled_by uuid,
  PRIMARY KEY (tenant_id, module_key)
);

CREATE INDEX IF NOT EXISTS tenant_modules_lookup
  ON public.tenant_modules (tenant_id, module_key) WHERE enabled;

-- `directory` is core: every other module joins to employees, so disabling it would make the
-- product inoperable rather than reduced.
INSERT INTO public.modules (key, name, description, is_core, sort_order) VALUES
  ('directory',     'Employee Directory', 'Employees, org structure, reference data', true,  10),
  ('attendance',    'Attendance & Time',  'Punch in/out, breaks, shifts, overtime',   false, 20),
  ('leave',         'Leave',              'Leave types, balances, applications',      false, 30),
  ('payroll',       'Payroll',            'Salary structures, payroll runs, payslips',false, 40),
  ('tasks',         'Tasks & Projects',   'Task assignment, submissions, projects',   false, 50),
  ('expenses',      'Expenses',           'Expense claims and reimbursement',         false, 60),
  ('insurance',     'Insurance',          'Employee insurance policies',              false, 70),
  ('policy_center', 'Policy Center',      'HR policies and acknowledgements',         false, 80),
  ('chat',          'Chat',               'Realtime channels and messaging',          false, 90),
  ('connect',       'Connect Feed',       'Company feed, posts and reactions',        false, 100),
  ('onboarding',    'Onboarding',         'Employee onboarding workflow',             false, 110),
  ('offboarding',   'Offboarding',        'Exit requests and clearances',             false, 120)
ON CONFLICT (key) DO NOTHING;

-- Backfill: every existing tenant gets every module enabled, so this migration is a no-op for
-- everyone currently using the system. New tenants are seeded at creation (application concern).
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled)
SELECT t.id, m.key, true FROM public.tenants t CROSS JOIN public.modules m
ON CONFLICT (tenant_id, module_key) DO NOTHING;

-- SECURITY DEFINER per P2: it reads tenant_modules, and a policy on tenant_modules that called it
-- would otherwise re-enter RLS. Core modules short-circuit to true so a missing row can never lock
-- a tenant out of the directory.
CREATE OR REPLACE FUNCTION public.tenant_has_module(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.modules m WHERE m.key = p_key AND m.is_core
  ) OR EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = (SELECT public.get_auth_tenant_id())
      AND tm.module_key = p_key
      AND tm.enabled
  )
$$;

-- New functions grant EXECUTE to PUBLIC by default, which includes anon — the exact gap closed in
-- 20260817130000. Grant explicitly instead. authenticated needs it because the RESTRICTIVE policies
-- in the next migration call it as the invoking role.
REVOKE EXECUTE ON FUNCTION public.tenant_has_module(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_has_module(text) TO authenticated;

-- Maps a document type to the module that owns it, for the cross-module approval_requests table
-- (04-configurability.md §2). Kept here so the mapping lives beside the registry it depends on.
CREATE OR REPLACE FUNCTION public.module_for_doc_type(p_doc_type text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $$
  SELECT CASE p_doc_type
    WHEN 'leave'                 THEN 'leave'
    WHEN 'expense'               THEN 'expenses'
    WHEN 'attendance_correction' THEN 'attendance'
    WHEN 'task'                  THEN 'tasks'
    WHEN 'exit'                  THEN 'offboarding'
    ELSE 'directory'
  END
$$;

REVOKE EXECUTE ON FUNCTION public.module_for_doc_type(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.module_for_doc_type(text) TO authenticated;

-- ── RLS on the registry itself ───────────────────────────────────────────────
ALTER TABLE public.modules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_modules ENABLE ROW LEVEL SECURITY;

-- The catalogue is not tenant data; any signed-in user may read it to render nav.
-- It changes by migration only, so there is no write policy.
CREATE POLICY modules_read ON public.modules
FOR SELECT TO authenticated USING (true);

-- A tenant may READ its own entitlements (to render nav) but never write them —
-- otherwise a tenant could grant itself modules it has not bought.
CREATE POLICY tenant_modules_self_read ON public.tenant_modules
FOR SELECT TO authenticated
USING (tenant_id = (SELECT public.get_auth_tenant_id()));

CREATE POLICY tenant_modules_platform_all ON public.tenant_modules
FOR ALL TO authenticated
USING      ((SELECT public.get_my_platform_role()) IS NOT NULL)
WITH CHECK ((SELECT public.get_my_platform_role()) IS NOT NULL);
