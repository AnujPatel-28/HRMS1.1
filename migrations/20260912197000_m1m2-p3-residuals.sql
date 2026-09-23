-- migration: C6 -- P3 residuals + lead additions from C3/C7
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C6 section and "C6 additions".
-- Measured on TB-M1M2 2026-09-23 (tests/m1m2/c6_p3_residuals.mjs, pre-migration run).
-- No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

-- ── 1. expenses: an employee can only file a PENDING, unreviewed, unpaid claim ─────────────────
-- Before: expenses_self_insert checked ownership only -> employee.a created an already-'approved'
-- expense (money path). The employee screen always sends status 'pending' (column default too).
-- Employees have no UPDATE policy (HR only), so the insert is the only self write to fence.
DROP POLICY expenses_self_insert ON public.expenses;
CREATE POLICY expenses_self_insert ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.employees e WHERE e.id = expenses.employee_id AND e.user_id = (SELECT auth.uid()))
    AND status = 'pending'
    AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL
    AND payroll_run_id IS NULL AND reimbursed_at IS NULL
  );
REVOKE ALL ON public.expenses FROM anon;

-- ── 2. posts: only a feed moderator sets or changes pin / type ───────────────────────────────
-- Before: posts_update lets the AUTHOR update every column (type -> 'announcement', is_pinned),
-- and posts_insert lets an author create an already-pinned post (announcements were already
-- moderator-only at insert). A guard trigger covers every client path with no frontend change;
-- server-side writers (no auth.uid(), e.g. the birthday/anniversary edge function) are unaffected.
CREATE OR REPLACE FUNCTION public.posts_guard_moderated_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR (SELECT public.has_access_action('feed.moderate', 'company', NULL::uuid)) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_pinned THEN
      RAISE EXCEPTION 'POST_MODERATION_REQUIRED: only a feed moderator can pin a post' USING ERRCODE = 'P1001';
    END IF;
  ELSIF NEW.type IS DISTINCT FROM OLD.type OR NEW.is_pinned IS DISTINCT FROM OLD.is_pinned THEN
    RAISE EXCEPTION 'POST_MODERATION_REQUIRED: only a feed moderator can change a post''s type or pin' USING ERRCODE = 'P1001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.posts_guard_moderated_fields() FROM PUBLIC, anon;

CREATE TRIGGER posts_guard_moderated_fields
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_guard_moderated_fields();

-- ── 3. employee-documents: the folder owner cannot delete HR-issued files ────────────────────
-- Before: p3_employee_document_delete used the same predicate as read, so an employee could delete
-- anything in their own folder, including HR-issued documents. Now only HR-level
-- (employee.sensitive.read@company) deletes there; an employee still deletes files THEY uploaded
-- via the existing storage_objects_owner_delete (uploaded_by = me), still inside the RESTRICTIVE
-- p3_employee_document_fence. Upload (p3_employee_document_insert) unchanged.
DROP POLICY p3_employee_document_delete ON storage.objects;
CREATE POLICY p3_employee_document_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket = 'employee-documents'
    AND public.p3_employee_document_object_accessible(key)
    AND (SELECT public.has_access_action('employee.sensitive.read', 'company', NULL::uuid))
  );

-- ── 4. profile photos: own folder, or HR ─────────────────────────────────────────────────────
-- Keys are <tenant_id>/<employee_id>/<file> (MyProfile, EmployeeDetail, EmployeeCreate). Before:
-- insert/update/delete checked only the tenant folder -> any employee could overwrite or delete a
-- colleague's photo. Public read is unchanged.
DROP POLICY "Authenticated users can upload profile photos" ON storage.objects;
DROP POLICY "Authenticated users can update profile photos" ON storage.objects;
DROP POLICY "Authenticated users can delete profile photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload profile photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket = 'employee-profile-photos'
    AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
    AND (split_part(key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
  );
CREATE POLICY "Authenticated users can update profile photos" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket = 'employee-profile-photos'
    AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
    AND (split_part(key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
  )
  WITH CHECK (
    bucket = 'employee-profile-photos'
    AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
    AND (split_part(key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
  );
CREATE POLICY "Authenticated users can delete profile photos" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket = 'employee-profile-photos'
    AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
    AND (split_part(key, '/', 2) = (SELECT public.get_my_employee_id())::text OR (SELECT public.is_hr()))
  );

-- ── 5. policy acknowledgements: employees READ their own; writes go through the definer RPC ──
-- Before: acknowledgements_employee_self was FOR ALL -> an employee could delete (un-acknowledge)
-- or edit their own acknowledgement. The only writer is acknowledge_policy_transaction (definer).
DROP POLICY acknowledgements_employee_self ON public.employee_policy_acknowledgements;
CREATE POLICY acknowledgements_employee_self_select ON public.employee_policy_acknowledgements FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.get_my_employee_id()));

-- ── 6. create_draft_employee: dead (no caller in src/ or functions/) and it wrote manager_id
-- without a reporting relationship (C3 residual). Dropped.
DROP FUNCTION public.create_draft_employee(uuid, text, text, text, text, uuid);
