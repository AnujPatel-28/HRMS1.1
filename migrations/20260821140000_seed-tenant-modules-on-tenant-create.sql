-- Seed tenant_modules when a tenant is created.
--
-- THE BUG: nothing seeds entitlements. The 12 existing tenants all hold 12 enabled rows
-- because a backfill gave them one; a tenant created *since* gets ZERO rows. With no rows,
-- tenant_has_module() returns false for everything except the core `directory` module, and
-- the 34 RESTRICTIVE module_enabled_* policies then make 34 tables unreadable. The tenant
-- lands in a directory-only product with no error to explain it.
--
-- This is live, not latent. It is also the second provisioning gap found in as many days:
-- create-hr-admin-user already gives a new tenant an HR admin with no `employees` row
-- (see 20260821110000). New-tenant provisioning is the weak spot in this system.
--
-- A TRIGGER, not a fix to AddCompany.tsx: tenants are created by a direct
-- `db.from("tenants").insert(...)` in the admin UI, so there is no RPC chokepoint to amend,
-- and any future creation path — a signup flow, a seed script, a support engineer running
-- SQL — would have to remember to seed. A trigger cannot be forgotten.

-- ---------------------------------------------------------------------------
-- The seeding function
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because tenant_modules RLS restricts writes to platform admins
-- (tenant_modules_platform_all). The superadmin creating a company through the UI would
-- pass that check anyway, but a seed script or migration running as another role would not,
-- and a trigger that works only on one path is the bug this is meant to close.
--
-- Reads the `modules` catalogue rather than a hardcoded list, so a module added to the
-- catalogue later is picked up here automatically.
--
-- ⚠️ PRODUCT DECISION ENCODED HERE: new tenants get every module ENABLED.
--
-- This is deliberately consistent with the backfill every existing tenant received, and it
-- avoids the worst failure — a paying customer's first login showing an empty product.
-- The trade-off is real and worth restating: it means entitlement defaults to "everything"
-- and a tenant is restricted by the superadmin AFTER creation, in
-- /admin/companies -> view tenant -> TenantModulesPanel.
--
-- If the business wants true à-la-carte defaults, the right shape is a `default_enabled`
-- column on `modules` (or module selection in the AddCompany form) driving the `true` below
-- — NOT flipping this to false, which would reintroduce the empty-product failure for every
-- new tenant. Do not change this without deciding which of those two you are doing.
CREATE OR REPLACE FUNCTION public.seed_tenant_modules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, enabled_at)
  SELECT NEW.id, m.key, true, now()
  FROM public.modules m
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_seed_tenant_modules ON public.tenants;
CREATE TRIGGER trg_seed_tenant_modules
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_tenant_modules();

-- ---------------------------------------------------------------------------
-- Backfill any tenant the gap already created
-- ---------------------------------------------------------------------------
-- Idempotent, and by construction affects only tenants missing a row for a given module.
-- Expected to touch 0 rows today (all 12 tenants hold all 12), but a tenant created between
-- the registry migration and this one would be stranded, and this is how it is rescued.
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, enabled_at)
SELECT t.id, m.key, true, now()
FROM public.tenants t
CROSS JOIN public.modules m
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_modules tm
  WHERE tm.tenant_id = t.id AND tm.module_key = m.key
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------
-- Every tenant must now hold exactly one row per catalogue module. Asserted here rather
-- than checked by hand, so a future module added to the catalogue without a matching
-- backfill fails loudly the next time this suite is replayed onto a fresh project.
DO $check$
DECLARE
  v_modules  int;
  v_tenants  int;
  v_missing  int;
BEGIN
  SELECT count(*) INTO v_modules FROM public.modules;
  SELECT count(*) INTO v_tenants FROM public.tenants;

  SELECT count(*) INTO v_missing
  FROM public.tenants t
  CROSS JOIN public.modules m
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = t.id AND tm.module_key = m.key
  );

  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'tenant_modules incomplete: % tenant/module pairs still missing (% tenants x % modules)',
      v_missing, v_tenants, v_modules;
  END IF;
END
$check$;
