-- migration: C6 forward fix -- RESTRICTIVE fence on profile-photo writes
-- Source: C6 (prompts/c2_c6_cleanup_packages_2026-09-22.md); the package's pre-authorized forward fix.
--
-- Measured 2026-09-23 after 20260912197000: employee.a could still upload into a colleague's photo
-- folder. The narrowed "Authenticated users can upload profile photos" policy is PERMISSIVE, and the
-- global PERMISSIVE storage_objects_owner_insert (WITH CHECK uploaded_by = me) ORs with it, so any
-- bucket without a RESTRICTIVE fence accepts an insert at any key. employee-documents has one
-- (p3_employee_document_fence); profile photos did not. Fence = own folder, or HR.
-- Reads stay public; nothing else changes.
-- No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

CREATE POLICY c6_profile_photo_insert_fence ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket <> 'employee-profile-photos'
    OR (
      key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
      AND split_part(key, '/', 1) = (SELECT public.get_auth_tenant_id())::text
      AND (split_part(key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
    )
  );

CREATE POLICY c6_profile_photo_update_fence ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    bucket <> 'employee-profile-photos'
    OR (
      split_part(key, '/', 1) = (SELECT public.get_auth_tenant_id())::text
      AND (split_part(key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
    )
  )
  WITH CHECK (
    bucket <> 'employee-profile-photos'
    OR (
      split_part(key, '/', 1) = (SELECT public.get_auth_tenant_id())::text
      AND (split_part(key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
    )
  );

CREATE POLICY c6_profile_photo_delete_fence ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    bucket <> 'employee-profile-photos'
    OR (
      split_part(key, '/', 1) = (SELECT public.get_auth_tenant_id())::text
      AND (split_part(key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
    )
  );
