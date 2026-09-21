-- P3-04. Measured on TB-M1M2, 2026-09-21: employee-documents, expense-receipts and
-- task-attachments are PUBLIC buckets holding personal data (payslips, receipts, resumes).
-- An anonymous curl downloaded a payslip-shaped PDF from employee-documents with no auth header.
-- Deployment also MUST PATCH /api/storage/buckets/<name> {"isPublic":false} for all three —
-- SQL cannot set the managed bucket flag. The acceptance runner verifies it separately.
--
-- Key convention (D1): every new upload uses <tenant_id>/<owner_employee_id>/<uuid>.<ext>.
-- Authorization derives the tenant + owner from the OBJECT KEY itself, never from a
-- caller-authored table reference (D2; P3-03 Tier1's forged-reference lesson, 189100/189300:
-- a message/record's stored URL must never be trusted as an access grant on its own).
--
-- employee-documents legacy shape `employees/<employee_id>/...` (13 objects, D3): the owner is
-- still in the key at the same position (part 2); tenant is resolved via the employees row.
-- task-attachments legacy unprefixed keys (5 objects, D3): fail closed by construction — no
-- tenant/owner segment in the key means no split_part match, so no caller can ever satisfy it.
-- No legacy mapping is built, per D3.

-- ============================================================================
-- employee-documents: read/write = owner OR HR document authority.
-- Catalogue check (2026-09-21): access_template_grants holds
-- (action='employee.sensitive.read', scope_type='company', template_key='hr_admin') — used here,
-- per D2, in preference to the legacy is_hr() seam.
-- ============================================================================
CREATE FUNCTION public.p3_employee_document_object_accessible(object_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      split_part(object_key,'/',1) = public.get_auth_tenant_id()::text
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE split_part(object_key,'/',1) = 'employees'
          AND e.id::text = split_part(object_key,'/',2)
          AND e.tenant_id = public.get_auth_tenant_id()
      )
    )
    AND (
      split_part(object_key,'/',2) = public.get_my_employee_id()::text
      OR public.has_access_action('employee.sensitive.read','company')
    );
$$;
REVOKE ALL ON FUNCTION public.p3_employee_document_object_accessible(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_employee_document_object_accessible(text) TO authenticated;

-- B2: these four PERMISSIVE policies checked only can_access_tenant(split_part(key,1)) — any
-- same-company employee could read/write/delete any colleague's document. Replaced below.
DROP POLICY "Authenticated users can read employee documents" ON storage.objects;
DROP POLICY "Authenticated users can upload employee documents" ON storage.objects;
DROP POLICY "Authenticated users can update employee documents" ON storage.objects;
DROP POLICY "Authenticated users can delete employee documents" ON storage.objects;

CREATE POLICY p3_employee_document_fence ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket <> 'employee-documents' OR public.p3_employee_document_object_accessible(key))
  WITH CHECK (bucket <> 'employee-documents' OR public.p3_employee_document_object_accessible(key));
CREATE POLICY p3_employee_document_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket = 'employee-documents' AND public.p3_employee_document_object_accessible(key));
CREATE POLICY p3_employee_document_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket = 'employee-documents' AND public.p3_employee_document_object_accessible(key));
CREATE POLICY p3_employee_document_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket = 'employee-documents' AND public.p3_employee_document_object_accessible(key));

-- ============================================================================
-- expense-receipts: read = owner OR is_hr() (mirrors the expenses table's own
-- expenses_hr_select rule verbatim, per D2 — the one-resolver rewrite comes later).
-- Write = owner only; no upload-on-behalf path exists in the app for receipts.
-- ============================================================================
CREATE FUNCTION public.p3_expense_receipt_readable(object_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND split_part(object_key,'/',1) = public.get_auth_tenant_id()::text
    AND (
      split_part(object_key,'/',2) = public.get_my_employee_id()::text
      OR public.is_hr()
    );
$$;
REVOKE ALL ON FUNCTION public.p3_expense_receipt_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_expense_receipt_readable(text) TO authenticated;

CREATE POLICY p3_expense_receipt_fence ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket <> 'expense-receipts' OR public.p3_expense_receipt_readable(key))
  WITH CHECK (bucket <> 'expense-receipts' OR (
    split_part(key,'/',1) = public.get_auth_tenant_id()::text
    AND split_part(key,'/',2) = public.get_my_employee_id()::text));
CREATE POLICY p3_expense_receipt_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket = 'expense-receipts' AND public.p3_expense_receipt_readable(key));
CREATE POLICY p3_expense_receipt_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket = 'expense-receipts'
    AND split_part(key,'/',1) = public.get_auth_tenant_id()::text
    AND split_part(key,'/',2) = public.get_my_employee_id()::text);

-- ============================================================================
-- task-attachments: read = owner OR (a task_submissions row owned by the key's owner
-- references this key AND the reviewing caller passes p3_task_scope(...,'read') on that
-- submission's task — HR/company, direct manager, project manager). Write = owner only.
-- task_submissions has no INSERT/UPDATE/DELETE grant for `authenticated` (writes only via
-- SECURITY DEFINER RPCs that derive employee_id from auth.uid()), so attachment_url values
-- read here cannot be forged by a direct table write.
-- ============================================================================
CREATE FUNCTION public.p3_task_attachment_readable(object_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND split_part(object_key,'/',1) = public.get_auth_tenant_id()::text
    AND (
      split_part(object_key,'/',2) = public.get_my_employee_id()::text
      OR EXISTS (
        SELECT 1 FROM public.task_submissions ts
        JOIN public.tasks t ON t.id = ts.task_id AND t.tenant_id = ts.tenant_id
        WHERE ts.tenant_id = public.get_auth_tenant_id()
          AND ts.employee_id::text = split_part(object_key,'/',2)
          AND (ts.attachment_url = 'task-attachments:' || object_key
            OR split_part(ts.attachment_url,'/api/storage/buckets/task-attachments/objects/',2)
               IN (object_key, replace(object_key,'/','%2F')))
          AND public.p3_task_scope(t.tenant_id, t.assigned_to, t.project_id, 'read')
      )
    );
$$;
REVOKE ALL ON FUNCTION public.p3_task_attachment_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_task_attachment_readable(text) TO authenticated;

CREATE POLICY p3_task_attachment_fence ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket <> 'task-attachments' OR public.p3_task_attachment_readable(key))
  WITH CHECK (bucket <> 'task-attachments' OR (
    split_part(key,'/',1) = public.get_auth_tenant_id()::text
    AND split_part(key,'/',2) = public.get_my_employee_id()::text));
CREATE POLICY p3_task_attachment_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket = 'task-attachments' AND public.p3_task_attachment_readable(key));
CREATE POLICY p3_task_attachment_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket = 'task-attachments'
    AND split_part(key,'/',1) = public.get_auth_tenant_id()::text
    AND split_part(key,'/',2) = public.get_my_employee_id()::text);

-- Belt-and-suspenders anon deny for these three buckets (no anon PERMISSIVE policy already
-- grants them, but the public bucket flag bypasses RLS entirely until the API PATCH lands —
-- this only helps once the bucket is private).
CREATE POLICY p3_private_docs_no_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING (bucket NOT IN ('employee-documents','expense-receipts','task-attachments'))
  WITH CHECK (bucket NOT IN ('employee-documents','expense-receipts','task-attachments'));

-- ============================================================================
-- B3: employee_documents (table) tenant_isolation was PERMISSIVE ALL USING
-- can_access_tenant(tenant_id) — a grant, not a fence. Any employee could read/insert/
-- update/delete any colleague's row. tenant_active_restrictive (RESTRICTIVE, unchanged)
-- remains the tenant fence. No screen deletes/updates a row it doesn't own as HR, so
-- update/delete are HR-only; insert allows self (onboarding self-upload) or HR
-- (EmployeeCreate.tsx uploads onto a new employee's record before they can sign in).
-- ============================================================================
DROP POLICY tenant_isolation ON public.employee_documents;

CREATE POLICY p3_employee_documents_select ON public.employee_documents FOR SELECT TO authenticated
  USING (
    employee_id = public.get_my_employee_id()
    OR public.has_access_action('employee.sensitive.read','company')
  );
CREATE POLICY p3_employee_documents_insert ON public.employee_documents FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = public.get_my_employee_id()
    OR public.has_access_action('employee.sensitive.read','company')
  );
CREATE POLICY p3_employee_documents_hr_update ON public.employee_documents FOR UPDATE TO authenticated
  USING (public.has_access_action('employee.sensitive.read','company'))
  WITH CHECK (public.has_access_action('employee.sensitive.read','company'));
CREATE POLICY p3_employee_documents_hr_delete ON public.employee_documents FOR DELETE TO authenticated
  USING (public.has_access_action('employee.sensitive.read','company'));

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['p3_employee_document_object_accessible',
    'p3_expense_receipt_readable','p3_task_attachment_readable'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=fn) <> 1 THEN
      RAISE EXCEPTION 'P3 function overload invariant failed: %', fn;
    END IF;
  END LOOP;
END $$;
