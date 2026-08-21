-- Make modules compose, part 1 (server side).
--
-- All 12 tenants currently hold all 12 modules enabled, so the entitlement system has never
-- actually run with a module OFF. An audit of what happens when one is found several latent
-- failures. This fixes the two that live in the database. The two payroll money bugs are
-- client-side and ship separately.

-- ---------------------------------------------------------------------------
-- 1. policy_center becomes a CORE module
-- ---------------------------------------------------------------------------
-- PolicyCenter.tsx is not only a policy document library. It is the ONLY surface for the
-- statutory and calculation settings that other modules read:
--
--   lop_calculation_method · pf_wage_ceiling · esi_gross_ceiling ·
--   professional_tax_state · late-mark rules · regularization settings
--
-- With policy_center OFF, that screen is route-gated away and payroll, attendance and leave
-- silently fall back to hardcoded defaults — working_days, PF 15000, ESI 21000, PT 0 — with
-- no UI anywhere to correct them. A tenant would get statutory numbers that are wrong for
-- them and no way to discover why. Settings that other modules depend on cannot themselves
-- be a sellable module; module_architecture.md §2 already lists Settings as its own thing,
-- and the shipped registry made these gateable by mistake.
--
-- is_core is all that is needed: tenant_has_module() returns true for any core module
-- regardless of tenant_modules, so the two RESTRICTIVE policies on hr_policies and
-- employee_policy_acknowledgements now always pass. No policy is dropped or rewritten.
--
-- Side effect, accepted deliberately: the policy DOCUMENT library becomes always-on too,
-- since it shares the module key. Harmless — it renders empty for a tenant that publishes
-- no policies. Splitting settings out of the library is a refactor, not a migration, and
-- would be the right move only if the library ever needs to be sold separately.
UPDATE public.modules SET is_core = true WHERE key = 'policy_center';

-- Existing tenant_modules rows for policy_center are left alone rather than deleted. They
-- are now ignored by tenant_has_module(), and removing them would destroy the record of
-- what a tenant was actually sold.

-- ---------------------------------------------------------------------------
-- 2. tenant_has_module_for(tenant, key) — the explicit-tenant form
-- ---------------------------------------------------------------------------
-- tenant_has_module(key) resolves the tenant from the JWT via get_auth_tenant_id(), which
-- is right for an RLS policy but wrong inside a SECURITY DEFINER RPC that already received
-- p_tenant_id as an argument: the guard should test the tenant being ACTED ON, not whatever
-- tenant the session happens to belong to.
--
-- This matters more than it looks. The 34 module_enabled_* RESTRICTIVE policies are
-- BYPASSED inside every SECURITY DEFINER function: the tables are owned by project_admin
-- with relforcerowsecurity = false, and Postgres exempts a table's owner from its own RLS.
-- So `the database is the enforcement boundary` holds for the PostgREST table path and NOT
-- for the RPC path. Every server-side module seam therefore needs an EXPLICIT guard.
--
-- Do NOT try to fix that by setting FORCE ROW LEVEL SECURITY on these tables. Bypassing RLS
-- as owner is exactly how every definer helper in this system works — get_auth_tenant_id(),
-- is_hr(), jwt_role_is_hr(), employee_is_hr(), can_view_employee(). Forcing RLS would break
-- all of them, including the fix for the 2026-08-20 chat outage.
CREATE OR REPLACE FUNCTION public.tenant_has_module_for(p_tenant_id uuid, p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.modules m WHERE m.key = p_key AND m.is_core
  ) OR EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.module_key = p_key
      AND tm.enabled
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.tenant_has_module_for(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_has_module_for(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_has_module_for(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. punch_out_attendance — skip the task gate when tasks is disabled
-- ---------------------------------------------------------------------------
-- THE BUG, and it is the worst of the set because the user cannot self-rescue: the gate
-- counts unresolved rows straight out of `tasks`, bypassing that table's
-- module_enabled_tasks policy for the reason in section 2. With the Tasks module OFF, tasks
-- left over from before it was disabled still block punch-out — and the Tasks screen is
-- route-gated away, so neither the employee nor HR can see or clear the blocking task.
-- The employee simply cannot end their shift.
--
-- A tenant that does not have the Tasks module cannot have a task policy, so the gate is
-- meaningless for them. Guarding on the tenant being acted on, not the session.
--
-- Rewritten by asserting the exact snippet appears once, then replace() + EXECUTE on the
-- live body: retyping a function this large loses comments and silently reverts drift.
DO $mig$
DECLARE
  v_def  text;
  v_hits int;
  v_old CONSTANT text := '  IF v_tenant.punch_out_gate_enabled THEN';
  v_new CONSTANT text := '  IF v_tenant.punch_out_gate_enabled AND public.tenant_has_module_for(p_tenant_id, ''tasks'') THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance' AND p.prokind IN ('f', 'p');

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'punch_out_attendance not found (or overloaded)';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'punch_out task gate: expected exactly 1 occurrence, found % — refusing to rewrite a drifted body', v_hits;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

-- ---------------------------------------------------------------------------
-- 4. Prove it
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_core    boolean;
  v_guarded boolean;
BEGIN
  SELECT is_core INTO v_core FROM public.modules WHERE key = 'policy_center';
  IF NOT COALESCE(v_core, false) THEN
    RAISE EXCEPTION 'policy_center is not core';
  END IF;

  -- tenant_has_module() must now answer true for policy_center even with no session,
  -- because the core branch does not consult get_auth_tenant_id() at all.
  IF NOT public.tenant_has_module('policy_center') THEN
    RAISE EXCEPTION 'tenant_has_module(policy_center) is still false after making it core';
  END IF;

  SELECT pg_get_functiondef(p.oid) ~ 'tenant_has_module_for\(p_tenant_id, ''tasks''\)'
    INTO v_guarded
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance' AND p.prokind IN ('f', 'p');

  IF NOT COALESCE(v_guarded, false) THEN
    RAISE EXCEPTION 'punch_out_attendance task gate is not module-guarded';
  END IF;
END
$check$;
