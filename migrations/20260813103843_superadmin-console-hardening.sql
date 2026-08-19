-- Super Admin Console hardening.
--
-- 1. Superadmin can DELETE tenants. Without this policy the rollback in
--    AddCompany.tsx silently affected 0 rows (RLS denial returns no error),
--    which is how the orphan tenants a / ab / abc / test2 / test123 were left
--    behind after HR-admin creation failed.
-- 2. Deleting a tenant that still owns employees or auth users is blocked in
--    the database, not just in the UI.
-- 3. Tenants carry the manual DNS provisioning state, because subdomains are
--    added by hand in Vercel + GoDaddy (no wildcard domain yet).
-- 4. Subdomains are constrained to a routable, non-reserved shape.
-- 5. A tenant's own users can read their tenant row even while suspended, so
--    the app can say "account unavailable" instead of "Company not found".

-- ── 1. Superadmin delete ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS tenants_superadmin_delete ON public.tenants;

CREATE POLICY tenants_superadmin_delete
ON public.tenants
FOR DELETE
TO authenticated
USING ((SELECT public.is_superadmin()));

-- ── 2. Refuse to delete a tenant that still has people in it ─────────────────

CREATE OR REPLACE FUNCTION public.prevent_nonempty_tenant_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.employees e WHERE e.tenant_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete "%" because it still has employee records.', OLD.company_name;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.metadata->>'tenant_id' = OLD.id::text) THEN
    RAISE EXCEPTION 'Cannot delete "%" because it still has user accounts.', OLD.company_name;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tenants_prevent_nonempty_delete ON public.tenants;
CREATE TRIGGER tenants_prevent_nonempty_delete
BEFORE DELETE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.prevent_nonempty_tenant_delete();

-- ── 3. Manual DNS provisioning state ─────────────────────────────────────────
-- 'pending' = subdomain exists in the database but has not been added to Vercel
-- and GoDaddy yet, so the tenant URL does not resolve. 'live' = DNS is in place.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS domain_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS domain_verified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_domain_status_check') THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_domain_status_check CHECK (domain_status IN ('pending', 'live'));
  END IF;
END $$;

-- ── 4. Subdomain shape ───────────────────────────────────────────────────────
-- NOT VALID: existing rows include 'a' and 'ab', which are shorter than the new
-- minimum. The constraint is enforced on every INSERT/UPDATE from now on; run
-- ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_subdomain_shape_check;
-- once those legacy rows are cleaned up.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_subdomain_shape_check') THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_subdomain_shape_check CHECK (
        subdomain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
        AND length(subdomain) BETWEEN 3 AND 30
        AND subdomain NOT LIKE '%--%'
        AND subdomain NOT IN (
          'www', 'admin', 'api', 'app', 'hrms', 'mail', 'smtp', 'imap', 'pop',
          'ns1', 'ns2', 'mx', 'cdn', 'static', 'assets', 'blog', 'docs', 'help',
          'support', 'status', 'dev', 'staging', 'test', 'demo', 'portal',
          'dashboard', 'login', 'auth', 'account', 'accounts', 'billing',
          'payments', 'webhook', 'webhooks', 'vercel', 'insforge', 'talentmesh',
          'talentmeshsolutions', 'superadmin', 'root', 'system', 'internal',
          'secure', 'vpn', 'git', 'my'
        )
      ) NOT VALID;
  END IF;
END $$;

-- ── 5. Suspended tenants stay visible to their own users ─────────────────────
-- Only the tenants row itself becomes readable while suspended, which is what
-- lets the app say "account unavailable" instead of "Company not found".
--
-- Scope of this change: it touches public.tenants and nothing else. Every table
-- whose policies go through can_access_tenant() still ANDs tenant_is_active(),
-- so those stay blocked for a suspended tenant.
--
-- Pre-existing gap, NOT introduced here: a number of tenant_id tables
-- (leave_balances, projects, posts, shifts, employee_shifts, it_declarations,
-- and others) check get_auth_tenant_id() directly instead of
-- can_access_tenant(), and carry no RESTRICTIVE tenant policy. Suspension is
-- therefore not enforced on those tables today. Closing that gap needs its own
-- migration and is deliberately out of scope here.

DROP POLICY IF EXISTS tenants_select_own ON public.tenants;

CREATE POLICY tenants_select_own
ON public.tenants
FOR SELECT
TO authenticated
USING (id = (SELECT public.get_auth_tenant_id()));
