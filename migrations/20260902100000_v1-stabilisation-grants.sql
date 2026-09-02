-- V1 stabilisation sprint: fix two EXECUTE grants that the 2026-08-17 hardening pass got wrong in
-- opposite directions. One under-granted and has blocked all employee creation since; the other
-- over-granted and lets any employee fire a cross-tenant balance mutation.
--
-- ############################################################################
-- 1. check_rate_limit — UNDER-granted. This is a production Blocker.
-- ############################################################################
-- `migrations/20260817100000_revoke-anon-execute-on-secdef-functions.sql:33` and
-- `migrations/20260817130000_revoke-public-execute-on-secdef-functions.sql:24` both revoked
-- EXECUTE from `authenticated`, and NEITHER re-granted it.
--
-- Verified live 2026-09-02:  check_rate_limit :: project_admin=X/project_admin
--                            -- `authenticated` has no EXECUTE at all.
--
-- The edge function `create-employee-user` calls it with the CALLER's token, so every HR admin
-- gets `permission denied for function check_rate_limit`. The function then collapses that
-- permission failure into a 429, so HR reads "Rate limit exceeded. Please try again later." on
-- their very first attempt, with `rate_limits` holding zero rows.
--
-- Net effect: HR has been unable to create an employee since 2026-08-17. The honest-error half
-- of this fix is in functions/create-employee-user.ts (a permission failure must surface as a
-- 500 with the real message, not as a rate limit).

GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, uuid, text, integer, interval)
  TO authenticated;

-- ############################################################################
-- 2. fn_accrue_monthly_leaves — OVER-granted.
-- ############################################################################
-- `migrations/20260817130000_revoke-public-execute-on-secdef-functions.sql:70` re-granted EXECUTE
-- to `authenticated`.
--
-- Verified live 2026-09-02:  fn_accrue_monthly_leaves :: project_admin=X/project_admin ;
--                                                        authenticated=X/project_admin
-- Confirmed during the QA run by calling it successfully as `employee-qa`.
--
-- It is SECURITY DEFINER and loops over `leave_balances` for EVERY TENANT in the database, with
-- no tenant filter. Blast radius is limited by its own
-- `last_accrual_date < date_trunc('month', CURRENT_DATE)` guard, which makes it idempotent within
-- a calendar month — so it cannot be looped to inflate a balance. But an ordinary employee of one
-- tenant should not be able to trigger accrual for all tenants, and that guard is the only thing
-- standing between this grant and unbounded self-service leave.
--
-- Safe to revoke: `grep -rn "fn_accrue_monthly_leaves\|accrue_monthly" src/ functions/` returns
-- NOTHING, so no application path calls it. It is fired by a pg_cron job which runs as its own
-- role, unaffected by this revoke.
--
-- NOTE: this closes the reachability hole only. The function is still WRONG — it adds to
-- `balance` without touching `total_allocated`, breaking the ledger identity, and 14 of 34
-- balance rows already violate it. That is the Leave rebuild's problem, not this sprint's.
-- The pg_cron row is also registered in no migration and needs database-owner access to find.

REVOKE EXECUTE ON FUNCTION public.fn_accrue_monthly_leaves()
  FROM authenticated;

-- ############################################################################
-- 3. Backfill `work_calendar` entitlement rows.
-- ############################################################################
-- `trg_seed_tenant_modules` fires on tenant INSERT only, so adding a row to `public.modules`
-- grants it to nobody. Verified live: the 12 tenants created before 2026-08-21 have 12
-- `tenant_modules` rows; the 3 created after have 13. `work_calendar` was added on 2026-08-21
-- and never backfilled.
--
-- Functionally inert today — `tenant_has_module()` short-circuits on `modules.is_core` — but the
-- superadmin console reads `tenant_modules` directly, so it shows a gap for 12 tenants, and the
-- frontend's `hasModule()` consults the same set. Backfilled here so the catalogue and the
-- entitlement table agree.

INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, enabled_at)
SELECT t.id, 'work_calendar', true, now()
FROM public.tenants t
ON CONFLICT DO NOTHING;

-- ############################################################################
-- Assertions — this migration is only correct if all three hold.
-- ############################################################################
DO $$
DECLARE
  v_missing integer;
BEGIN
  IF NOT has_function_privilege(
       'authenticated',
       'public.check_rate_limit(uuid, uuid, text, integer, interval)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'check_rate_limit: authenticated still lacks EXECUTE';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.fn_accrue_monthly_leaves()',
       'EXECUTE') THEN
    RAISE EXCEPTION 'fn_accrue_monthly_leaves: authenticated still holds EXECUTE';
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = t.id AND tm.module_key = 'work_calendar'
  );

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'work_calendar backfill incomplete: % tenants still missing a row', v_missing;
  END IF;
END $$;
