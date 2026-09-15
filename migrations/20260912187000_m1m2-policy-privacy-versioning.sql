-- P3-01: Policy Center privacy, versioning and supported settings
--
-- The `hr-policies` storage bucket was public. Measured on TB-M1M2 before this migration: an
-- anonymous, unauthenticated curl against a live object key succeeded end to end (302 -> signed
-- CDN redirect -> 200, 222,253 bytes, application/pdf). RLS on `storage.objects` is irrelevant to
-- that path, because a public bucket never consults it.
--
-- This migration:
--   1. The bucket is flipped to private OUTSIDE this file. `storage.buckets` carries RLS with zero
--      policies and no role (not even `project_admin`, confirmed by testing `UPDATE storage.buckets`
--      through both `db query` and the migration runner -- both fail `permission denied for table
--      buckets`) has BYPASSRLS, so no SQL statement in a migration can flip it. The only reachable
--      path is the storage management API: `PATCH /api/storage/buckets/hr-policies` with body
--      `{"isPublic": false}`, authenticated with the project admin key (the CLI's `create-bucket`
--      only supports create-time --public/--private, not an update). That call was made directly
--      against TB-M1M2 and is recorded, with before/after evidence, in the P3-01 report -- it is not
--      migration-tracked because there is no migration-trackable form of it. Re-running it is
--      idempotent (setting isPublic:false on an already-private bucket is a no-op 200).
--   2. Backfills `hr_policies.storage_path` from `file_url` for any row that predates the column
--      being populated on every insert (idempotent: only touches NULL storage_path rows).
--   3. Adds tenant + audience scoped RLS to `storage.objects` for bucket = 'hr-policies'. This
--      table previously carried 18 policies, all PERMISSIVE, none scoped to this bucket -- so once
--      the bucket went private, the default (deny, absent a matching PERMISSIVE policy) would have
--      locked out every reader including HR. The new RESTRICTIVE fence is scoped to
--      `bucket = 'hr-policies'` only (`bucket <> 'hr-policies' OR ...`) so it passes through for
--      every other bucket's existing, unaudited policies untouched -- this package does not attempt
--      to fix the other 17.
--   4. Reads are gated by a SECURITY DEFINER helper that re-derives tenant and audience from the
--      owning `hr_policies` row (looked up by `storage_path = key`), matching the same visibility
--      rule already enforced in `get_employee_visible_hr_policies` (all / HR / department-specific
--      by `org_unit_id`). An object with no matching `hr_policies` row (orphan) is unreadable by
--      anyone but `project_admin`.
--   5. Writes: INSERT is HR-only and cannot be tenant-scoped at the storage layer, because the app
--      uploads the object before the `hr_policies` row exists (see PolicyUpload.tsx handleUpload).
--      Tenant is enforced one step later by the existing `policies_hr_all` RLS on `hr_policies`
--      itself. UPDATE/DELETE run after the DB row still exists (handleDeletePolicy removes the
--      object, then the row), so those ARE tenant-checked via the same helper.

-- 1. Bucket privacy is set via the storage management API, not SQL -- see the header note above.
--    Guard here only asserts the precondition this migration's RLS depends on; it does not attempt
--    the flip itself (that statement is unreachable under this project's RLS on storage.buckets).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'hr-policies' AND public = true) THEN
    RAISE EXCEPTION 'hr-policies bucket is still public - flip it via PATCH /api/storage/buckets/hr-policies {isPublic:false} before applying this migration''s RLS';
  END IF;
END $$;

-- 2. Idempotent backfill: storage_path from file_url, decoding the one '%2F' escape the app ever
-- writes into `/objects/<key>` URLs. No-op if storage_path is already populated (true for every
-- row already inserted through the current PolicyUpload.tsx, which sets storage_path directly).
UPDATE public.hr_policies
SET storage_path = replace(split_part(file_url, '/objects/', 2), '%2F', '/')
WHERE storage_path IS NULL
  AND file_url LIKE '%/objects/%';

-- 3. Read-visibility helper. Mirrors get_employee_visible_hr_policies' audience rule exactly, plus
-- the tenant fence and the HR-sees-everything-in-tenant rule from get_hr_policy_library.
CREATE OR REPLACE FUNCTION public.hr_policy_object_readable(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_visible_to text;
  v_org_unit_id uuid;
  v_employee_org_unit_id uuid;
  v_found boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.tenant_id, p.visible_to, p.org_unit_id
    INTO v_tenant_id, v_visible_to, v_org_unit_id
    FROM public.hr_policies p
    WHERE p.storage_path = p_key
    LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN false; -- no owning row: orphan object, unreadable by anyone but project_admin
  END IF;

  IF NOT public.can_access_tenant(v_tenant_id) THEN
    RETURN false;
  END IF;

  IF public.is_hr() THEN
    RETURN true;
  END IF;

  SELECT e.org_unit_id INTO v_employee_org_unit_id
    FROM public.employees e
    WHERE e.user_id = auth.uid() AND e.tenant_id = v_tenant_id
    LIMIT 1;
  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF NOT v_found THEN
    RETURN false; -- no employee association in this tenant: association-required, not a leak
  END IF;

  RETURN v_visible_to = 'all'
    OR (v_visible_to = 'department-specific' AND v_org_unit_id IS NOT NULL AND v_org_unit_id = v_employee_org_unit_id);
END;
$function$;

-- Tenant-match helper for UPDATE/DELETE, reusing the same lookup. Returns true (pass-through) if
-- no row exists yet, since INSERT is the only case with no owning row, and INSERT does not use this.
CREATE OR REPLACE FUNCTION public.hr_policy_object_tenant_ok(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT public.can_access_tenant(p.tenant_id) FROM public.hr_policies p WHERE p.storage_path = p_key LIMIT 1),
    true
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.hr_policy_object_readable(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_policy_object_tenant_ok(text) FROM anon;

-- 4. RLS on storage.objects, scoped to bucket = 'hr-policies' only.
DROP POLICY IF EXISTS "hr_policies_bucket_tenant_isolation" ON storage.objects;
CREATE POLICY "hr_policies_bucket_tenant_isolation" ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (bucket <> 'hr-policies' OR public.hr_policy_object_tenant_ok(key))
  WITH CHECK (bucket <> 'hr-policies' OR public.is_hr());

DROP POLICY IF EXISTS "hr_policies_bucket_select" ON storage.objects;
CREATE POLICY "hr_policies_bucket_select" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (bucket = 'hr-policies' AND public.hr_policy_object_readable(key));

DROP POLICY IF EXISTS "hr_policies_bucket_insert" ON storage.objects;
CREATE POLICY "hr_policies_bucket_insert" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket = 'hr-policies' AND public.is_hr());

DROP POLICY IF EXISTS "hr_policies_bucket_update" ON storage.objects;
CREATE POLICY "hr_policies_bucket_update" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (bucket = 'hr-policies' AND public.is_hr())
  WITH CHECK (bucket = 'hr-policies' AND public.is_hr());

DROP POLICY IF EXISTS "hr_policies_bucket_delete" ON storage.objects;
CREATE POLICY "hr_policies_bucket_delete" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (bucket = 'hr-policies' AND public.is_hr());
