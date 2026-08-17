-- Entry-point security hardening — TalentMesh HRMS
-- Author: system audit 2026-08-12
-- Target: PRODUCTION project `HRMS` (rq3qmu8y). Review before applying. Apply to the branch too.
--
-- Fixes two live cross-tenant holes in the employee creation/activation path:
--   S8a: create_draft_employee — SECURITY DEFINER, NO authz, PUBLIC EXECUTE
--        -> any user (any tenant, even anon) could inject employees into ANY company.
--   S8b: hr_activate_draft_employee(9-arg) — checks role='hr' but NOT the caller's tenant
--        -> an HR of company A could activate/modify an employee in company B.
--
-- Strategy: add proper internal authorization (caller must be authenticated HR of the
-- target tenant) instead of only revoking, so any legitimately-deployed HR flow keeps
-- working. Also revoke anon EXECUTE and pin search_path (defense in depth).
-- NOTE: current app code calls neither of these (it uses create_employee_transaction),
-- so this change is non-breaking for the current frontend.

BEGIN;

-- ── S8a: harden create_draft_employee ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_draft_employee(
  p_tenant_id uuid,
  p_full_name text,
  p_email text,
  p_designation text,
  p_date_of_joining text,
  p_manager_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_id uuid;
BEGIN
  -- Authorization: caller must be an authenticated HR of the SAME tenant.
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;
  IF NOT (public.is_hr() AND public.get_auth_tenant_id() = p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: only HR of this company can create employees';
  END IF;

  INSERT INTO public.employees (
    tenant_id, full_name, email, designation, date_of_joining, status, manager_id, user_id
  ) VALUES (
    p_tenant_id, p_full_name, p_email, p_designation,
    NULLIF(p_date_of_joining, '')::date, 'draft', p_manager_id, NULL
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_draft_employee(uuid,text,text,text,text,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_draft_employee(uuid,text,text,text,text,uuid) TO authenticated;

-- ── S8b: add the missing tenant check to the 9-arg hr_activate_draft_employee ──
CREATE OR REPLACE FUNCTION public.hr_activate_draft_employee(
  p_employee_id uuid,
  p_designation text,
  p_department text,
  p_date_of_joining date,
  p_employee_code text,
  p_employment_type text,
  p_grade text DEFAULT NULL,
  p_work_location text DEFAULT NULL,
  p_work_mode text DEFAULT 'office'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid uuid;
  v_caller_role text;
  v_caller_tenant_id uuid;
  v_tenant_id uuid;
BEGIN
  v_caller_uid := (SELECT auth.uid());
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.employees WHERE id = p_employee_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found';
  END IF;

  -- Strict multi-tenant safety: caller must be HR of the SAME tenant.
  SELECT metadata->>'role', (metadata->>'tenant_id')::uuid
    INTO v_caller_role, v_caller_tenant_id
  FROM auth.users WHERE id = v_caller_uid;

  IF v_caller_role <> 'hr' OR v_caller_tenant_id IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'Only HR admins of the same company can activate employees';
  END IF;

  UPDATE public.employees SET
    status = 'active',
    designation = p_designation,
    department = p_department,
    date_of_joining = p_date_of_joining,
    employee_code = p_employee_code,
    employment_type = p_employment_type,
    grade = p_grade,
    work_location = p_work_location,
    work_mode = p_work_mode,
    updated_at = now()
  WHERE id = p_employee_id
    AND tenant_id = v_tenant_id
    AND status IN ('draft','pending_hr_review','inactive');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found or not in a reviewable status';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.hr_activate_draft_employee(uuid,text,text,date,text,text,text,text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.hr_activate_draft_employee(uuid,text,text,date,text,text,text,text,text) TO authenticated;

COMMIT;

-- Verify after apply:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc WHERE proname IN ('create_draft_employee','hr_activate_draft_employee');
