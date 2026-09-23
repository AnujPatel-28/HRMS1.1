-- migration: C9 -- RESTRICTIVE write fences for the buckets that had none
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C9 section (found in C6).
--
-- Measured on TB-M1M2 2026-09-23 (tests/m1m2/c9_storage_write_fences.mjs, pre-migration, 8/18):
-- plain employee.a created objects at the tenant root of application-snapshots, attendance-selfies,
-- avatars, company-assets, company-logos, insurance-documents, payslips, recruiter_documents and
-- resumes, and uploaded a SELFIE INTO A COLLEAGUE'S folder (forged punch evidence). Cause: the global
-- PERMISSIVE storage_objects_owner_insert (WITH CHECK uploaded_by = me) ORs with every bucket policy,
-- so a bucket without a RESTRICTIVE fence accepts an insert at any key.
--
-- Real writers (grep of src/ and functions/, 2026-09-23):
--   attendance-selfies  -> the employee, <tenant>/<own employee id>/<attendance id>/<type>.jpg (PunchInOut)
--   company-assets      -> HR, <tenant>/logo-*.ext (Settings, PolicyCenter)
--   insurance-documents -> HR, <tenant>/<employee id>/* (HR Insurance)
--   payslips            -> HR (payroll -- hidden, rebuilt later)
--   avatars, company-logos, resumes, recruiter_documents, application-snapshots -> no client code
--     references them and TB holds 0 objects in each: closed to clients (admin key only).
-- Every other bucket keeps its own policies/fences (this function returns true for it).
-- Reads are unchanged. No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

CREATE OR REPLACE FUNCTION public.c9_storage_write_allowed(p_bucket text, p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_bucket = 'attendance-selfies' THEN
      split_part(p_key, '/', 1) = (SELECT public.get_auth_tenant_id())::text
      AND (split_part(p_key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
    WHEN p_bucket IN ('company-assets', 'insurance-documents', 'payslips') THEN
      split_part(p_key, '/', 1) = (SELECT public.get_auth_tenant_id())::text
      AND (SELECT public.is_hr())
    WHEN p_bucket IN ('avatars', 'company-logos', 'resumes', 'recruiter_documents', 'application-snapshots') THEN
      false
    ELSE true
  END;
$function$;
REVOKE ALL ON FUNCTION public.c9_storage_write_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.c9_storage_write_allowed(text, text) TO authenticated;

CREATE POLICY c9_storage_write_fence_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.c9_storage_write_allowed(bucket, key));
CREATE POLICY c9_storage_write_fence_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.c9_storage_write_allowed(bucket, key))
  WITH CHECK (public.c9_storage_write_allowed(bucket, key));
CREATE POLICY c9_storage_write_fence_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.c9_storage_write_allowed(bucket, key));
