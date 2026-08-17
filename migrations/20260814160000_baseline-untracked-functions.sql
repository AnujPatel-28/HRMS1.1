-- Baseline: capture application functions that exist in the live database but in no migration.
--
-- MECHANICAL CAPTURE ONLY. Every statement is the exact output of pg_get_functiondef() for a function
-- that already exists, so applying this migration is a no-op against the live database. No behaviour
-- is changed, no duplicate/overloaded function is resolved, no grant is altered.
--
-- Why this matters more than the policy baseline it follows: 51 of these 57 are
-- SECURITY DEFINER, which run as their owner and bypass RLS entirely. They were reachable only by
-- reading the live database — they could not be reviewed in a diff or recreated on a new project.
-- Among them is the core business logic: employee_apply_leave_request, create_draft_employee,
-- hr_activate_draft_employee, the hr_* attendance/shift RPCs, fn_accrue_monthly_leaves.
--
-- CREATE OR REPLACE (never DROP + CREATE) is deliberate: REPLACE preserves ownership and the existing
-- ACL, so grants are untouched. DROP would silently reset them.
--
-- VERIFICATION: snapshot pg_get_functiondef() and proacl for every function before and after applying;
-- both must be byte-identical. Verified on a single-function pilot first
-- (20260814150000_pilot-capture-one-function.sql) because 92 of 93 bodies contain
-- semicolons inside dollar quotes, which a naive statement splitter would corrupt.
--
-- KNOWN LIMITATION — grants are NOT captured here. CREATE OR REPLACE preserves them on an existing
-- database, but applying this file to a FRESH project would create these functions with the default
-- ACL (EXECUTE to PUBLIC), which is more permissive than production for anything that has been
-- hardened. This baseline therefore achieves version control and reviewability, but is NOT yet
-- sufficient to reproduce the project from scratch. Capturing grants is a separate follow-up.
--
-- 6 overloaded names are captured as-is, both signatures each. Resolving them is deliberately
-- out of scope (see system-audit-2026-08/06-recommendations.md §E):
--     approve_task_request(p_task_id uuid) / (p_task_id uuid, p_hr_employee_id uuid)
--     check_employee_exists_by_email(user_email text) / (user_email text, exclude_employee_id uuid)
--     hr_activate_draft_employee(p_employee_id uuid, p_designation text, p_department text, p_date_of_joining date, p_employee_code text, p_employment_type text, p_grade text, p_work_location text, p_work_mode text) / (p_employee_id uuid, p_designation text, p_department text, p_date_of_joining date, p_employee_code text, p_employment_type text, p_grade text, p_work_location text, p_work_mode text, p_user_id uuid)
--     punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_lunch_minutes integer, p_overtime_enabled boolean, p_overtime_rate numeric, p_expected_shift_hours numeric) / (p_attendance_id uuid, p_tenant_id uuid, p_work_hours numeric, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text)
--     reject_task_request(p_task_id uuid, p_hr_employee_id uuid, p_notes text) / (p_task_id uuid, p_notes text)
--     submit_task_request(p_task_id uuid, p_employee_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) / (p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text)
--
-- Generated from live pg_proc on 2026-08-14. Regenerate rather than hand-edit.

-- [  1] approve_leave_request(p_leave_id uuid, p_working_dates date[], p_approved_business_days integer)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.approve_leave_request(p_leave_id uuid, p_working_dates date[] DEFAULT NULL::date[], p_approved_business_days integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_leave leaves%ROWTYPE;
  v_balance_row leave_balances%ROWTYPE;
  v_date date;
  v_caller_uid uuid;
  v_hr_employee_id uuid;
  v_working_days integer[];
  v_working_dates date[] := ARRAY[]::date[];
  v_approved_business_days integer := 0;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  SELECT * INTO v_leave
  FROM leaves
  WHERE id = p_leave_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status <> 'pending' THEN
    RAISE EXCEPTION 'Leave request is no longer pending (current status: %)', v_leave.status;
  END IF;

  v_hr_employee_id := assert_hr_for_tenant(v_leave.tenant_id);

  PERFORM assert_date_range_unlocked(v_leave.tenant_id, v_leave.start_date, v_leave.end_date);

  SELECT s.working_days INTO v_working_days
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = v_leave.tenant_id
    AND es.employee_id = v_leave.employee_id
    AND es.effective_from <= v_leave.start_date
    AND (es.effective_to IS NULL OR es.effective_to >= v_leave.start_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_working_days IS NULL THEN
    SELECT working_days INTO v_working_days
    FROM shifts
    WHERE tenant_id = v_leave.tenant_id
      AND is_default = true
      AND is_active IS NOT FALSE
    LIMIT 1;
  END IF;
  v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

  v_date := v_leave.start_date;
  WHILE v_date <= v_leave.end_date LOOP
    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT EXISTS (SELECT 1 FROM holidays WHERE tenant_id = v_leave.tenant_id AND date = v_date) THEN
      v_working_dates := array_append(v_working_dates, v_date);
      v_approved_business_days := v_approved_business_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  IF v_approved_business_days = 0 THEN
    RAISE EXCEPTION 'The selected leave range contains no working days';
  END IF;

  IF v_leave.leave_type_id IS NOT NULL THEN
    SELECT * INTO v_balance_row
    FROM leave_balances
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND leave_type_id = v_leave.leave_type_id
      AND year = EXTRACT(YEAR FROM v_leave.start_date)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Leave balance not found for this employee and type';
    END IF;

    IF v_balance_row.balance < v_approved_business_days THEN
      RAISE EXCEPTION 'Insufficient leave balance (available: %, requested: %)', v_balance_row.balance, v_approved_business_days;
    END IF;

    UPDATE leave_balances
    SET used_days = used_days + v_approved_business_days,
        balance = balance - v_approved_business_days,
        updated_at = now()
    WHERE id = v_balance_row.id;
  END IF;

  UPDATE leaves
  SET status = 'approved',
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      approved_business_days = v_approved_business_days,
      total_days = v_approved_business_days
  WHERE id = p_leave_id;

  FOREACH v_date IN ARRAY v_working_dates LOOP
    INSERT INTO attendance (tenant_id, employee_id, date, punch_in, status, punch_out_allowed, session_status)
    VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, NULL, 'on_leave', true, 'closed')
    ON CONFLICT (employee_id, date)
    DO UPDATE SET status = 'on_leave', punch_in = NULL, punch_out_allowed = true, session_status = 'closed';
  END LOOP;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      v_leave.tenant_id,
      v_leave.employee_id,
      'Leave Approved',
      'Your leave from ' || v_leave.start_date::text || ' to ' || v_leave.end_date::text || ' has been approved.',
      'leave_approved',
      p_leave_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    v_leave.tenant_id, v_hr_employee_id, 'hr', 'leave.approved', 'leave', p_leave_id,
    jsonb_build_object('approved_business_days', v_approved_business_days, 'working_dates', v_working_dates, 'correlation_id', v_correlation_id)
  );
END;
$function$;

-- [  2] approve_task_request(p_task_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.approve_task_request(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_tenant_id UUID;
  v_submission_id UUID;
  v_unapproved_count INTEGER;
  v_gate_enabled BOOLEAN;
  v_caller_uid UUID;
  v_hr_employee_id UUID;
BEGIN
  -- 0. Derive reviewer identity from auth context.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  -- 1. Fetch and lock task
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_task.status = 'approved' THEN
    RAISE EXCEPTION 'Task is already approved';
  END IF;

  v_tenant_id := v_task.tenant_id;

  -- 2. Verify caller is an HR employee of this tenant.
  SELECT id INTO v_hr_employee_id
  FROM public.employees
  WHERE user_id = v_caller_uid
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caller is not an HR employee of this tenant';
  END IF;

  -- Additional role check: ensure caller has the hr role in auth metadata.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = v_caller_uid
      AND metadata->>'role' = 'hr'
  ) THEN
    RAISE EXCEPTION 'Insufficient role: HR privileges required';
  END IF;

  -- 3. Update task
  UPDATE public.tasks
  SET status = 'approved', updated_at = NOW()
  WHERE id = p_task_id;

  -- 4. Update latest submission — reviewer derived from server-side identity
  SELECT id INTO v_submission_id
  FROM public.task_submissions
  WHERE task_id = p_task_id AND tenant_id = v_tenant_id
  ORDER BY submitted_at DESC
  LIMIT 1;

  IF v_submission_id IS NOT NULL THEN
    UPDATE public.task_submissions
    SET status = 'approved', reviewed_by = v_hr_employee_id, reviewed_at = NOW()
    WHERE id = v_submission_id;
  END IF;

  -- 5. Attendance Unlocking Logic
  SELECT punch_out_gate_enabled INTO v_gate_enabled
  FROM public.tenants
  WHERE id = v_tenant_id;

  IF v_gate_enabled THEN
    SELECT COUNT(*) INTO v_unapproved_count
    FROM public.tasks
    WHERE tenant_id = v_tenant_id
      AND assigned_to = v_task.assigned_to
      AND attendance_lock_date = v_task.attendance_lock_date
      AND status != 'approved';

    IF v_unapproved_count = 0 AND v_task.attendance_lock_date IS NOT NULL THEN
      UPDATE public.attendance
      SET punch_out_allowed = true
      WHERE tenant_id = v_tenant_id
        AND employee_id = v_task.assigned_to
        AND date = v_task.attendance_lock_date;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- [  3] approve_task_request(p_task_id uuid, p_hr_employee_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.approve_task_request(p_task_id uuid, p_hr_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_tenant_id UUID;
  v_submission_id UUID;
  v_unapproved_count INTEGER;
  v_gate_enabled BOOLEAN;
BEGIN
  -- 1. Fetch and lock task
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_task.status = 'approved' THEN
    RAISE EXCEPTION 'Task is already approved';
  END IF;

  v_tenant_id := v_task.tenant_id;

  -- 2. Update task
  UPDATE public.tasks
  SET status = 'approved', updated_at = NOW()
  WHERE id = p_task_id;

  -- 3. Update latest submission
  SELECT id INTO v_submission_id
  FROM public.task_submissions
  WHERE task_id = p_task_id AND tenant_id = v_tenant_id
  ORDER BY submitted_at DESC
  LIMIT 1;

  IF v_submission_id IS NOT NULL THEN
    UPDATE public.task_submissions
    SET status = 'approved', reviewed_by = p_hr_employee_id, reviewed_at = NOW()
    WHERE id = v_submission_id;
  END IF;

  -- 4. Attendance Unlocking Logic
  -- First, check if the punch_out_gate_enabled is true for this tenant
  SELECT punch_out_gate_enabled INTO v_gate_enabled
  FROM public.tenants
  WHERE id = v_tenant_id;

  -- If gate is enabled, check if there are any remaining unapproved tasks for the same attendance_lock_date
  IF v_gate_enabled THEN
    SELECT COUNT(*) INTO v_unapproved_count
    FROM public.tasks
    WHERE tenant_id = v_tenant_id
      AND assigned_to = v_task.assigned_to
      AND attendance_lock_date = v_task.attendance_lock_date
      AND status != 'approved';

    IF v_unapproved_count = 0 AND v_task.attendance_lock_date IS NOT NULL THEN
      -- All tasks are approved, unlock attendance for that lock date!
      UPDATE public.attendance
      SET punch_out_allowed = true
      WHERE tenant_id = v_tenant_id
        AND employee_id = v_task.assigned_to
        AND date = v_task.attendance_lock_date;
    END IF;
  ELSE
    -- If gate is NOT enabled, we don't need to touch punch_out_allowed, it's irrelevant.
    -- (Actually, punch_out_allowed defaults to true).
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- [  4] assert_date_range_unlocked(p_tenant_id uuid, p_start_date date, p_end_date date)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.assert_date_range_unlocked(p_tenant_id uuid, p_start_date date, p_end_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payroll_lock_date date;
BEGIN
  SELECT NULLIF(value, '')::date INTO v_payroll_lock_date
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'payroll_lock_date';

  IF v_payroll_lock_date IS NOT NULL AND p_start_date <= v_payroll_lock_date THEN
    RAISE EXCEPTION 'Payroll is locked for this date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payroll_runs
    WHERE tenant_id = p_tenant_id
      AND status IN ('approved', 'paid')
      AND make_date(year, month, 1) <= date_trunc('month', p_end_date)::date
      AND (make_date(year, month, 1) + interval '1 month - 1 day')::date >= date_trunc('month', p_start_date)::date
  ) THEN
    RAISE EXCEPTION 'Payroll run is already approved or paid for this period';
  END IF;
EXCEPTION WHEN undefined_table THEN
  IF v_payroll_lock_date IS NOT NULL AND p_start_date <= v_payroll_lock_date THEN
    RAISE EXCEPTION 'Payroll is locked for this date';
  END IF;
END;
$function$;

-- [  5] assert_hr_for_tenant(p_tenant_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.assert_hr_for_tenant(p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  SELECT id INTO v_employee_id
  FROM employees
  WHERE user_id = auth.uid()
    AND tenant_id = p_tenant_id
    AND status = 'active';

  IF v_employee_id IS NULL OR NOT is_hr() THEN
    RAISE EXCEPTION 'HR privileges required';
  END IF;

  RETURN v_employee_id;
END;
$function$;

-- [  6] audit_tenant_changes()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.audit_tenant_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_email text;
BEGIN
  IF NOT (SELECT public.is_superadmin()) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT email INTO actor_email FROM auth.users WHERE id = (SELECT auth.uid());

  INSERT INTO public.platform_audit_logs (actor_user_id, actor_email, action, target_table, target_id, before_data, after_data)
  VALUES (
    (SELECT auth.uid()),
    actor_email,
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- [  7] cancel_leave_request(p_leave_id uuid, p_rejection_reason text, p_new_status text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_leave_id uuid, p_rejection_reason text, p_new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_leave leaves%ROWTYPE;
  v_balance_row leave_balances%ROWTYPE;
  v_hr_employee_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF p_new_status NOT IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid leave status: %', p_new_status;
  END IF;

  SELECT * INTO v_leave
  FROM leaves
  WHERE id = p_leave_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Leave request is already %', v_leave.status;
  END IF;

  v_hr_employee_id := assert_hr_for_tenant(v_leave.tenant_id);

  PERFORM assert_date_range_unlocked(v_leave.tenant_id, v_leave.start_date, v_leave.end_date);

  IF v_leave.status = 'approved' THEN
    IF v_leave.leave_type_id IS NOT NULL AND v_leave.approved_business_days IS NOT NULL THEN
      SELECT * INTO v_balance_row
      FROM leave_balances
      WHERE tenant_id = v_leave.tenant_id
        AND employee_id = v_leave.employee_id
        AND leave_type_id = v_leave.leave_type_id
        AND year = EXTRACT(YEAR FROM v_leave.start_date)
      FOR UPDATE;

      IF FOUND THEN
        UPDATE leave_balances
        SET used_days = GREATEST(0, used_days - v_leave.approved_business_days),
            balance = balance + v_leave.approved_business_days,
            updated_at = now()
        WHERE id = v_balance_row.id;
      END IF;
    END IF;

    DELETE FROM attendance
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND date >= v_leave.start_date
      AND date <= v_leave.end_date
      AND status = 'on_leave'
      AND punch_in IS NULL;
  END IF;

  UPDATE leaves
  SET status = p_new_status,
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      rejection_reason = COALESCE(p_rejection_reason, rejection_reason)
  WHERE id = p_leave_id;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      v_leave.tenant_id,
      v_leave.employee_id,
      CASE WHEN p_new_status = 'cancelled' THEN 'Leave Cancelled' ELSE 'Leave Rejected' END,
      CASE
        WHEN p_new_status = 'cancelled'
          THEN 'Your leave from ' || v_leave.start_date::text || ' to ' || v_leave.end_date::text || ' has been cancelled.'
        ELSE 'Your leave request was rejected.' || CASE WHEN p_rejection_reason IS NULL OR p_rejection_reason = '' THEN '' ELSE ' Reason: ' || p_rejection_reason END
      END,
      CASE WHEN p_new_status = 'cancelled' THEN 'general' ELSE 'leave_rejected' END,
      p_leave_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    v_leave.tenant_id, v_hr_employee_id, 'hr',
    CASE WHEN p_new_status = 'cancelled' THEN 'leave.cancelled' ELSE 'leave.rejected' END,
    'leave', p_leave_id,
    jsonb_build_object('reason', p_rejection_reason, 'previous_status', v_leave.status, 'correlation_id', v_correlation_id)
  );
END;
$function$;

-- [  8] check_employee_exists_by_email(user_email text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.check_employee_exists_by_email(user_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.employees
    WHERE email = user_email
  );
END;
$function$;

-- [  9] check_employee_exists_by_email(user_email text, exclude_employee_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.check_employee_exists_by_email(user_email text, exclude_employee_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.employees
    WHERE email = user_email
      AND (exclude_employee_id IS NULL OR id <> exclude_employee_id)
  );
END;
$function$;

-- [ 10] check_max_resumes_limit()
CREATE OR REPLACE FUNCTION public.check_max_resumes_limit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.candidate_resumes WHERE candidate_id = NEW.candidate_id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'Maximum limit of 5 resumes reached.';
  END IF;
  RETURN NEW;
END;
$function$;

-- [ 11] check_onboarding_resumable(p_email text, p_tenant_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.check_onboarding_resumable(p_email text, p_tenant_id uuid)
 RETURNS TABLE(auth_user_id uuid, status text, employee_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_auth_user_id uuid;
  v_status text;
  v_employee_id uuid;
  v_employee_status text;
BEGIN
  -- Security check: caller must have access to the target tenant
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Get the auth user details by email, strictly scoped to target tenant in metadata
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
    AND (metadata->>'tenant_id')::uuid = p_tenant_id;

  IF v_auth_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Check if employee record already exists in this tenant
  SELECT id, status INTO v_employee_id, v_employee_status
  FROM public.employees
  WHERE user_id = v_auth_user_id
    AND tenant_id = p_tenant_id;

  -- If employee exists and is active, onboarding is complete, NOT resumable.
  IF v_employee_id IS NOT NULL AND v_employee_status = 'active' THEN
    RETURN;
  END IF;

  -- Get onboarding status for this user in this tenant
  SELECT eo.status INTO v_status
  FROM public.employee_onboarding eo
  WHERE eo.auth_user_id = v_auth_user_id
    AND eo.tenant_id = p_tenant_id;

  -- Only return if onboarding status exists and is not 'active'
  IF v_status IS NOT NULL AND v_status != 'active' THEN
    RETURN QUERY SELECT v_auth_user_id, v_status, v_employee_id;
  END IF;
END;
$function$;

-- [ 12] check_primary_resume_ownership()
CREATE OR REPLACE FUNCTION public.check_primary_resume_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.primary_resume_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.candidate_resumes
      WHERE id = NEW.primary_resume_id
      AND candidate_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Primary resume does not belong to the candidate.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- [ 13] check_rate_limit(p_tenant_id uuid, p_user_id uuid, p_endpoint text, p_max_requests integer, p_window_interval interval)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_tenant_id uuid, p_user_id uuid, p_endpoint text, p_max_requests integer, p_window_interval interval)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_time timestamptz := now();
  v_record public.rate_limits%ROWTYPE;
BEGIN
  DELETE FROM public.rate_limits 
  WHERE tenant_id = p_tenant_id 
    AND user_id = p_user_id 
    AND endpoint = p_endpoint
    AND window_start < v_current_time - p_window_interval;

  SELECT * INTO v_record FROM public.rate_limits
  WHERE tenant_id = p_tenant_id 
    AND user_id = p_user_id 
    AND endpoint = p_endpoint;

  IF FOUND THEN
    IF v_record.request_count >= p_max_requests THEN
      RETURN false;
    ELSE
      UPDATE public.rate_limits
      SET request_count = request_count + 1
      WHERE tenant_id = p_tenant_id 
        AND user_id = p_user_id 
        AND endpoint = p_endpoint;
      RETURN true;
    END IF;
  ELSE
    INSERT INTO public.rate_limits (tenant_id, user_id, endpoint, request_count, window_start)
    VALUES (p_tenant_id, p_user_id, p_endpoint, 1, v_current_time);
    RETURN true;
  END IF;
END;
$function$;

-- [ 14] create_draft_employee(p_tenant_id uuid, p_full_name text, p_email text, p_designation text, p_date_of_joining text, p_manager_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.create_draft_employee(p_tenant_id uuid, p_full_name text, p_email text, p_designation text, p_date_of_joining text, p_manager_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_id uuid;
BEGIN
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

-- [ 15] delete_chat_channel(channel_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.delete_chat_channel(channel_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  caller_role text;
BEGIN
  -- Get the role of the calling user from auth.users metadata
  SELECT COALESCE(metadata->>'role', '') INTO caller_role
  FROM auth.users
  WHERE id = auth.uid();

  -- Only HR can delete channels
  IF caller_role != 'hr' THEN
    RAISE EXCEPTION 'Permission denied: only HR can delete channels';
  END IF;

  -- Cannot delete the general channel
  IF EXISTS (SELECT 1 FROM chat_channels WHERE id = channel_id AND name = 'general') THEN
    RAISE EXCEPTION 'Cannot delete the general channel';
  END IF;

  -- Delete the channel (cascade will handle messages and members)
  DELETE FROM chat_channels WHERE id = channel_id;
END;
$function$;

-- [ 16] employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_employee employees%ROWTYPE;
  v_leave_type leave_types%ROWTYPE;
  v_global_notice_days integer := 0;
  v_working_days integer[];
  v_date date;
  v_total_days integer := 0;
  v_balance numeric;
  v_effective_notice integer;
  v_notice_given integer;
  v_notice_days_reason text;
  v_days_since_joining integer;
  v_leave_id uuid;
  v_leave_type_enum text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  SELECT * INTO v_employee
  FROM employees
  WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT * INTO v_leave_type
  FROM leave_types
  WHERE tenant_id = p_tenant_id
    AND id = p_leave_type_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave type not found';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT COALESCE(NULLIF(value, '')::integer, 0)
  INTO v_global_notice_days
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'leave_min_notice_days';
  v_global_notice_days := COALESCE(v_global_notice_days, 0);

  v_effective_notice := GREATEST(COALESCE(v_global_notice_days, 0), COALESCE(v_leave_type.min_notice_days, 0));
  v_notice_given := p_start_date - CURRENT_DATE;
  IF v_notice_given < v_effective_notice THEN
    RAISE EXCEPTION 'This leave requires at least % days notice', v_effective_notice;
  END IF;

  IF COALESCE(v_leave_type.applicable_from_day, 0) > 0 AND v_employee.date_of_joining IS NOT NULL THEN
    v_days_since_joining := CURRENT_DATE - v_employee.date_of_joining;
    IF v_days_since_joining < v_leave_type.applicable_from_day THEN
      RAISE EXCEPTION '% is only available after % days of employment', v_leave_type.name, v_leave_type.applicable_from_day;
    END IF;
  END IF;

  SELECT s.working_days INTO v_working_days
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = p_tenant_id
    AND es.employee_id = v_employee.id
    AND es.effective_from <= p_start_date
    AND (es.effective_to IS NULL OR es.effective_to >= p_start_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_working_days IS NULL THEN
    SELECT working_days INTO v_working_days
    FROM shifts
    WHERE tenant_id = p_tenant_id
      AND is_default = true
      AND is_active IS NOT FALSE
    LIMIT 1;
  END IF;
  v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

  v_date := p_start_date;
  WHILE v_date <= p_end_date LOOP
    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT EXISTS (SELECT 1 FROM holidays WHERE tenant_id = p_tenant_id AND date = v_date) THEN
      v_total_days := v_total_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  IF v_total_days = 0 THEN
    RAISE EXCEPTION 'The selected date range contains no working days';
  END IF;

  IF v_leave_type.max_consecutive_days IS NOT NULL AND v_total_days > v_leave_type.max_consecutive_days THEN
    RAISE EXCEPTION '% allows a maximum of % working days per request', v_leave_type.name, v_leave_type.max_consecutive_days;
  END IF;

  SELECT balance INTO v_balance
  FROM leave_balances
  WHERE tenant_id = p_tenant_id
    AND employee_id = v_employee.id
    AND leave_type_id = p_leave_type_id
    AND year = EXTRACT(YEAR FROM p_start_date)
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Leave balance not found';
  END IF;

  IF v_total_days > v_balance THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, requested: %', v_balance, v_total_days;
  END IF;

  IF EXISTS (
    SELECT 1 FROM leaves
    WHERE tenant_id = p_tenant_id
      AND employee_id = v_employee.id
      AND status IN ('pending', 'approved')
      AND start_date <= p_end_date
      AND end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'An existing pending or approved leave overlaps these dates';
  END IF;

  v_leave_type_enum := CASE upper(v_leave_type.code)
    WHEN 'CL' THEN 'casual'
    WHEN 'SL' THEN 'sick'
    WHEN 'EL' THEN 'earned'
    WHEN 'UL' THEN 'unpaid'
    WHEN 'ML' THEN 'maternity'
    WHEN 'PL' THEN 'paternity'
    ELSE 'other'
  END;

  INSERT INTO leaves (
    tenant_id, employee_id, leave_type_id, leave_type, start_date,
    end_date, total_days, reason, status
  )
  VALUES (
    p_tenant_id, v_employee.id, p_leave_type_id, v_leave_type_enum,
    p_start_date, p_end_date, v_total_days, trim(p_reason), 'pending'
  )
  RETURNING id INTO v_leave_id;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    SELECT p_tenant_id, e.id, 'New Leave Request',
           v_employee.full_name || ' has requested ' || v_leave_type.name || ' from ' || p_start_date || ' to ' || p_end_date || '.',
           'general', v_leave_id
    FROM employees e
    WHERE e.tenant_id = p_tenant_id
      AND e.department = 'operations'
      AND e.status = 'active';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_leave_id;
END;
$function$;

-- [ 17] employee_cancel_pending_leave(p_tenant_id uuid, p_leave_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.employee_cancel_pending_leave(p_tenant_id uuid, p_leave_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
  v_leave leaves%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  SELECT id INTO v_employee_id
  FROM employees
  WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND status = 'active';

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT * INTO v_leave
  FROM leaves
  WHERE tenant_id = p_tenant_id
    AND id = p_leave_id
    AND employee_id = v_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending leave requests can be cancelled by employee';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_leave.start_date, v_leave.end_date);

  DELETE FROM leaves WHERE id = p_leave_id;
END;
$function$;

-- [ 18] end_employee_break(p_attendance_id uuid, p_tenant_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.end_employee_break(p_attendance_id uuid, p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_attendance    attendance%ROWTYPE;
  v_break         attendance_breaks%ROWTYPE;
  v_now           timestamptz := now();
  v_duration      integer;
  v_limit         integer;
  v_over_limit    integer;
BEGIN
  -- Lock attendance row
  SELECT * INTO v_attendance
  FROM attendance
  WHERE id = p_attendance_id
    AND tenant_id = p_tenant_id
    AND session_status = 'open'
    AND punch_out IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTENDANCE_NOT_OPEN'
      USING ERRCODE = 'P0004',
            DETAIL  = 'Attendance session is not open or employee already punched out.';
  END IF;

  -- State validation (not on break)
  IF v_attendance.current_break_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_ON_BREAK'
      USING ERRCODE = 'P0006',
            DETAIL  = 'Employee is not on break currently.';
  END IF;

  -- Select and lock active break
  SELECT * INTO v_break
  FROM public.attendance_breaks
  WHERE id = v_attendance.current_break_id
  FOR UPDATE;

  -- Calculate duration
  v_duration := ROUND(EXTRACT(EPOCH FROM (v_now - v_break.started_at)) / 60.0);

  -- Get limit based on break type
  v_limit := 15; -- Default limit for short breaks
  IF v_break.break_type = 'lunch' THEN
    SELECT lunch_break_minutes INTO v_limit FROM public.tenants WHERE id = p_tenant_id;
  ELSE
    SELECT COALESCE(value::integer, 15) INTO v_limit
    FROM public.tenant_settings
    WHERE tenant_id = p_tenant_id AND key = 'short_break_limit_minutes';
  END IF;

  v_over_limit := GREATEST(0, v_duration - v_limit);

  -- Update break record
  UPDATE public.attendance_breaks
  SET ended_at = v_now,
      duration_minutes = v_duration,
      over_limit_minutes = v_over_limit
  WHERE id = v_break.id;

  -- Update attendance row
  UPDATE public.attendance
  SET current_break_id = NULL,
      current_break_start = NULL,
      total_break_minutes = COALESCE(total_break_minutes, 0) + v_duration
  WHERE id = p_attendance_id;

  -- Log audit action
  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (p_tenant_id, v_attendance.employee_id, 'employee', 'attendance.break_ended',
          'attendance', p_attendance_id,
          jsonb_build_object('break_id', v_break.id, 'break_type', v_break.break_type,
                             'duration_minutes', v_duration, 'over_limit_minutes', v_over_limit));

  RETURN jsonb_build_object(
    'success', true,
    'break_id', v_break.id,
    'duration_minutes', v_duration,
    'over_limit_minutes', v_over_limit
  );
END;
$function$;

-- [ 19] expire_location_exceptions()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.expire_location_exceptions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN 
    UPDATE public.attendance_location_exceptions
    SET status = 'expired',
        updated_at = now()
    WHERE status = 'approved' AND end_date < CURRENT_DATE
    RETURNING id, tenant_id, employee_id
  LOOP
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
    VALUES (v_rec.tenant_id, NULL, 'system', 'attendance.remote_exception_expired', 'attendance_location_exceptions', v_rec.id, jsonb_build_object('employee_id', v_rec.employee_id));
  END LOOP;
END;
$function$;

-- [ 20] fn_accrue_monthly_leaves()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.fn_accrue_monthly_leaves()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_rec RECORD;
    v_target_year integer;
    v_month_start date;
BEGIN
    v_target_year := EXTRACT(YEAR FROM CURRENT_DATE);
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::date;

    FOR v_rec IN
        SELECT lb.id, lt.days_per_year
        FROM public.leave_balances lb
        JOIN public.leave_types lt ON lb.leave_type_id = lt.id
        WHERE lt.accrual_type = 'monthly'
          AND lt.is_active = true
          AND lb.year = v_target_year
          AND (lb.last_accrual_date IS NULL OR lb.last_accrual_date < v_month_start)
    LOOP
        UPDATE public.leave_balances
        SET balance = balance + (v_rec.days_per_year / 12.0),
            last_accrual_date = CURRENT_DATE,
            updated_at = NOW()
        WHERE id = v_rec.id;
    END LOOP;
END;
$function$;

-- [ 21] fn_auto_close_active_break()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.fn_auto_close_active_break()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_now timestamptz := now();
  v_end_time timestamptz;
  v_duration integer;
  v_limit integer;
  v_over_limit integer;
  v_break public.attendance_breaks%ROWTYPE;
BEGIN
  -- Triggered when an active attendance session is punch-completed or closed,
  -- and there is an active break session associated.
  IF (NEW.punch_out IS NOT NULL OR NEW.session_status = 'closed') AND OLD.current_break_id IS NOT NULL THEN
    -- Select the break record to verify if it is active
    SELECT * INTO v_break FROM public.attendance_breaks WHERE id = OLD.current_break_id;
    
    IF FOUND AND v_break.ended_at IS NULL THEN
      -- Use the punch_out time if available, otherwise now
      v_end_time := COALESCE(NEW.punch_out, v_now);
      
      -- Calculate actual duration in minutes, minimum 0
      v_duration := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_end_time - v_break.started_at)) / 60.0));
      
      -- Get limit
      v_limit := 15; -- Default limit for short breaks
      IF v_break.break_type = 'lunch' THEN
        SELECT lunch_break_minutes INTO v_limit FROM public.tenants WHERE id = NEW.tenant_id;
      ELSE
        SELECT COALESCE(value::integer, 15) INTO v_limit
        FROM public.tenant_settings
        WHERE tenant_id = NEW.tenant_id AND key = 'short_break_limit_minutes';
      END IF;
      
      v_over_limit := GREATEST(0, v_duration - v_limit);
      
      -- Update break history record
      UPDATE public.attendance_breaks
      SET ended_at = v_end_time,
          duration_minutes = v_duration,
          over_limit_minutes = v_over_limit
      WHERE id = v_break.id;
      
      -- Update fields on the NEW attendance record directly
      NEW.total_break_minutes := COALESCE(OLD.total_break_minutes, 0) + v_duration;
    END IF;
    
    -- Ensure current break pointers are cleared
    NEW.current_break_id := NULL;
    NEW.current_break_start := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- [ 22] fn_auto_redmark_tasks()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.fn_auto_redmark_tasks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant         RECORD;
  v_tenant_tz      text;
  v_eod_time_str   text;
  v_grace_minutes  integer;
  v_now_in_tz      timestamptz;
  v_cutoff_ts      timestamptz;
  v_affected       integer;
BEGIN
  FOR v_tenant IN SELECT id, COALESCE(timezone, 'UTC') AS tz FROM tenants WHERE status = 'active'
  LOOP
    v_tenant_tz := v_tenant.tz;
    v_now_in_tz := now() AT TIME ZONE v_tenant_tz;

    SELECT value INTO v_eod_time_str
    FROM tenant_settings
    WHERE tenant_id = v_tenant.id AND key = 'task_eod_redmark_time';

    SELECT value INTO v_grace_minutes
    FROM tenant_settings
    WHERE tenant_id = v_tenant.id AND key = 'task_grace_period_minutes';

    v_eod_time_str  := COALESCE(v_eod_time_str, '23:30');
    v_grace_minutes := COALESCE(v_grace_minutes::integer, 0);

    v_cutoff_ts := (date_trunc('day', v_now_in_tz)
                    + v_eod_time_str::interval
                    + (v_grace_minutes || ' minutes')::interval);

    IF v_now_in_tz >= v_cutoff_ts THEN
      UPDATE tasks
      SET status             = 'overdue',
          updated_at         = now(),
          auto_red_marked_at = now()
      WHERE tenant_id = v_tenant.id
        AND status    IN ('assigned', 'submitted', 'rejected')
        AND due_date  <= (v_now_in_tz)::date   -- tenant-local date; no UTC round-trip
        AND (
          due_time IS NULL
          OR ((due_date + due_time)::timestamp AT TIME ZONE v_tenant_tz) + (v_grace_minutes || ' minutes')::interval
             < v_now_in_tz
        );

      GET DIAGNOSTICS v_affected = ROW_COUNT;

      IF v_affected > 0 THEN
        INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, details)
        VALUES (v_tenant.id, NULL, 'system', 'tasks.auto_redmark_run', 'task',
                jsonb_build_object('affected_count', v_affected,
                                   'evaluated_at_tenant_tz', v_now_in_tz,
                                   'cutoff_ts', v_cutoff_ts,
                                   'eod_time', v_eod_time_str,
                                   'grace_minutes', v_grace_minutes));
      END IF;
    END IF;
  END LOOP;
END;
$function$;

-- [ 23] fn_check_insurance_expiries()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.fn_check_insurance_expiries()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_rec RECORD;
    v_hr RECORD;
BEGIN
    FOR v_rec IN
        SELECT ip.id, ip.tenant_id, ip.employee_id, ip.policy_type, ip.insurer_name, ip.expiry_date, e.full_name AS employee_name
        FROM public.insurance_policies ip
        JOIN public.employees e ON ip.employee_id = e.id
        WHERE ip.status = 'Active'
          AND ip.expiry_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
    LOOP
        -- 1. Create notification for the employee
        INSERT INTO public.notifications (tenant_id, employee_id, title, body, type)
        VALUES (
            v_rec.tenant_id,
            v_rec.employee_id,
            'Insurance Expiring Soon',
            'Your ' || v_rec.policy_type || ' insurance with ' || v_rec.insurer_name || ' expires on ' || v_rec.expiry_date || '. Please contact HR.',
            'general'
        );

        -- 2. Create notification for all active HRs of this tenant
        FOR v_hr IN
            SELECT id FROM public.employees
            WHERE tenant_id = v_rec.tenant_id
              AND role = 'hr'
              AND status = 'active'
        LOOP
            INSERT INTO public.notifications (tenant_id, employee_id, title, body, type)
            VALUES (
                v_rec.tenant_id,
                v_hr.id,
                'Employee Insurance Expiring',
                v_rec.employee_name || 's ' || v_rec.policy_type || ' insurance expires on ' || v_rec.expiry_date || '.',
                'general'
            );
        END LOOP;
    END LOOP;
END;
$function$;

-- [ 24] fn_cleanup_expired_onboarding()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.fn_cleanup_expired_onboarding()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    UPDATE public.employee_onboarding eo
    SET status = 'expired',
        expired_at = NOW(),
        updated_at = NOW()
    WHERE eo.status IN ('pending_auth', 'otp_verified', 'password_set')
      AND eo.created_at < NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.user_id = eo.auth_user_id
          AND e.tenant_id = eo.tenant_id
      );
END;
$function$;

-- [ 25] get_auth_user_details_by_email(user_email text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.get_auth_user_details_by_email(user_email text)
 RETURNS TABLE(id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT au.id, au.created_at
  FROM auth.users au
  WHERE au.email = user_email
  LIMIT 1;
END;
$function$;

-- [ 26] get_auth_user_details_by_email_v2(user_email text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.get_auth_user_details_by_email_v2(user_email text)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, tenant_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  RETURN QUERY
  SELECT au.id, au.created_at, NULLIF(au.metadata->>'tenant_id', '')::uuid
  FROM auth.users au
  WHERE lower(au.email) = lower(trim(user_email))
  LIMIT 1;
END;
$function$;

-- [ 27] get_my_platform_role()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.get_my_platform_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT pa.role
  FROM public.platform_admins pa
  WHERE pa.user_id = (SELECT auth.uid())
    AND pa.is_active = true
  LIMIT 1;
$function$;

-- [ 28] get_my_search_path()
CREATE OR REPLACE FUNCTION public.get_my_search_path()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN current_setting('search_path');
END;
$function$;

-- [ 29] get_user_id_by_email(user_email text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(user_email text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT id FROM auth.users WHERE email = lower(trim(user_email)) LIMIT 1;
$function$;

-- [ 30] hr_activate_draft_employee(p_employee_id uuid, p_designation text, p_department text, p_date_of_joining date, p_employee_code text, p_employment_type text, p_grade text, p_work_location text, p_work_mode text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_activate_draft_employee(p_employee_id uuid, p_designation text, p_department text, p_date_of_joining date, p_employee_code text, p_employment_type text, p_grade text DEFAULT NULL::text, p_work_location text DEFAULT NULL::text, p_work_mode text DEFAULT 'office'::text)
 RETURNS void
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

-- [ 31] hr_activate_draft_employee(p_employee_id uuid, p_designation text, p_department text, p_date_of_joining date, p_employee_code text, p_employment_type text, p_grade text, p_work_location text, p_work_mode text, p_user_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_activate_draft_employee(p_employee_id uuid, p_designation text, p_department text, p_date_of_joining date, p_employee_code text, p_employment_type text, p_grade text DEFAULT NULL::text, p_work_location text DEFAULT NULL::text, p_work_mode text DEFAULT 'office'::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
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
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  -- Get tenant from the employee record
  SELECT tenant_id INTO v_tenant_id
  FROM employees WHERE id = p_employee_id;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found';
  END IF;

  -- Verify caller is HR and belongs to the same tenant (Strict Multi-Tenant Safety)
  SELECT 
    metadata->>'role',
    (metadata->>'tenant_id')::uuid
  INTO v_caller_role, v_caller_tenant_id
  FROM auth.users WHERE id = v_caller_uid;

  IF v_caller_role != 'hr' OR v_caller_tenant_id IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'Only HR admins of the same company can activate employees';
  END IF;

  -- Update employee to active and link user_id
  UPDATE employees SET
    status = 'active',
    user_id = COALESCE(p_user_id, user_id),
    designation = p_designation,
    department = p_department,
    date_of_joining = p_date_of_joining,
    employee_code = p_employee_code,
    employment_type = p_employment_type,
    grade = p_grade,
    work_location = p_work_location,
    work_mode = p_work_mode,
    updated_at = NOW()
  WHERE id = p_employee_id
    AND tenant_id = v_tenant_id
    AND status IN ('draft', 'pending_hr_review', 'inactive');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found or not in a reviewable status';
  END IF;
END;
$function$;

-- [ 32] hr_approve_attendance_correction(p_tenant_id uuid, p_correction_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_approve_attendance_correction(p_tenant_id uuid, p_correction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_correction attendance_corrections%ROWTYPE;
  v_attendance attendance%ROWTYPE;
  v_tenant tenants%ROWTYPE;
  v_shift_start time;
  v_effective_in time;
  v_effective_out time;
  v_punch_in timestamptz;
  v_punch_out timestamptz;
  v_raw_hours numeric;
  v_work_hours numeric;
  v_lunch_minutes integer;
  v_grace_minutes integer;
  v_is_late boolean;
  v_before jsonb;
  v_after jsonb;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  SELECT * INTO v_correction
  FROM attendance_corrections
  WHERE tenant_id = p_tenant_id
    AND id = p_correction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction request not found';
  END IF;

  IF v_correction.status <> 'pending' THEN
    RAISE EXCEPTION 'Correction request is already %', v_correction.status;
  END IF;

  IF v_correction.requested_punch_in IS NULL AND v_correction.requested_punch_out IS NULL THEN
    RAISE EXCEPTION 'Cannot approve a correction with no requested punch times';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_correction.attendance_date, v_correction.attendance_date);

  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  v_lunch_minutes := COALESCE(v_tenant.lunch_break_minutes, 0);

  SELECT COALESCE(NULLIF(value, '')::integer, 0) INTO v_grace_minutes
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'late_mark_grace_minutes';
  v_grace_minutes := COALESCE(v_grace_minutes, 0);

  SELECT a.* INTO v_attendance
  FROM attendance a
  WHERE a.tenant_id = p_tenant_id
    AND a.employee_id = v_correction.employee_id
    AND a.date = v_correction.attendance_date
  FOR UPDATE;

  v_before := CASE WHEN v_attendance.id IS NULL THEN NULL ELSE to_jsonb(v_attendance) END;

  SELECT s.start_time INTO v_shift_start
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = p_tenant_id
    AND es.employee_id = v_correction.employee_id
    AND es.effective_from <= v_correction.attendance_date
    AND (es.effective_to IS NULL OR es.effective_to >= v_correction.attendance_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_shift_start IS NULL THEN
    SELECT s.start_time INTO v_shift_start
    FROM shifts s
    WHERE s.tenant_id = p_tenant_id
      AND s.is_default = true
      AND s.is_active IS NOT FALSE
    LIMIT 1;
  END IF;
  v_shift_start := COALESCE(v_shift_start, COALESCE(v_tenant.punch_in_start, '09:00')::time);

  v_effective_in := COALESCE(v_correction.requested_punch_in::time, (v_attendance.punch_in AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC'))::time);
  v_effective_out := COALESCE(v_correction.requested_punch_out::time, (v_attendance.punch_out AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC'))::time);

  IF v_effective_in IS NOT NULL THEN
    v_punch_in := (v_correction.attendance_date + v_effective_in)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
  END IF;

  IF v_effective_out IS NOT NULL THEN
    v_punch_out := (v_correction.attendance_date + v_effective_out)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
    IF v_effective_in IS NOT NULL AND v_effective_out < v_effective_in THEN
      v_punch_out := ((v_correction.attendance_date + 1) + v_effective_out)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
    END IF;
  END IF;

  IF v_punch_in IS NOT NULL AND v_punch_out IS NOT NULL THEN
    v_raw_hours := EXTRACT(EPOCH FROM (v_punch_out - v_punch_in)) / 3600.0;
    IF v_raw_hours > 18 THEN
      RAISE EXCEPTION 'Shift duration exceeds maximum limit of 18 hours';
    END IF;
    v_work_hours := ROUND(GREATEST(0, v_raw_hours - CASE WHEN v_raw_hours >= 5 THEN v_lunch_minutes / 60.0 ELSE 0 END), 2);
  END IF;

  v_is_late := CASE
    WHEN COALESCE(v_attendance.status, 'present') IN ('half_day', 'absent') THEN false
    WHEN v_effective_in IS NULL THEN COALESCE(v_attendance.is_late, false)
    ELSE v_effective_in > (v_shift_start + (v_grace_minutes || ' minutes')::interval)
  END;

  UPDATE attendance_corrections
  SET status = 'approved',
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      rejection_reason = NULL
  WHERE id = p_correction_id;

  IF v_attendance.id IS NULL THEN
    INSERT INTO attendance (
      tenant_id, employee_id, date, punch_in, punch_out, work_hours,
      is_late, status, punch_out_allowed, session_status
    )
    VALUES (
      p_tenant_id, v_correction.employee_id, v_correction.attendance_date,
      v_punch_in, v_punch_out, v_work_hours, v_is_late, 'present', true,
      CASE WHEN v_punch_out IS NULL THEN 'open' ELSE 'closed' END
    )
    RETURNING * INTO v_attendance;
  ELSE
    UPDATE attendance
    SET punch_in = COALESCE(v_punch_in, punch_in),
        punch_out = COALESCE(v_punch_out, punch_out),
        work_hours = COALESCE(v_work_hours, work_hours),
        is_late = v_is_late,
        session_status = CASE WHEN COALESCE(v_punch_out, punch_out) IS NULL THEN session_status ELSE 'closed' END
    WHERE id = v_attendance.id
    RETURNING * INTO v_attendance;
  END IF;

  v_after := to_jsonb(v_attendance);

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'attendance_correction.approved',
    'attendance_corrections', p_correction_id,
    jsonb_build_object(
      'employee_id', v_correction.employee_id,
      'attendance_date', v_correction.attendance_date,
      'before', v_before,
      'after', v_after,
      'reason', v_correction.reason,
      'severity', 'CRITICAL',
      'correlation_id', v_correlation_id
    )
  );

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      p_tenant_id,
      v_correction.employee_id,
      'Attendance Correction Approved',
      'Your attendance correction for ' || v_correction.attendance_date::text || ' has been approved and updated.',
      'general',
      p_correction_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'attendance_id', v_attendance.id,
    'employee_id', v_correction.employee_id,
    'attendance_date', v_correction.attendance_date,
    'work_hours', v_attendance.work_hours
  );
END;
$function$;

-- [ 33] hr_create_remote_exception(p_tenant_id uuid, p_employee_id uuid, p_exception_type text, p_start_date date, p_end_date date, p_reason text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_create_remote_exception(p_tenant_id uuid, p_employee_id uuid, p_exception_type text, p_start_date date, p_end_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_exception_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, p_start_date, p_end_date);

  IF p_exception_type NOT IN ('work_from_home', 'client_visit', 'business_travel', 'field_work', 'other') THEN
    RAISE EXCEPTION 'Invalid exception type';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = p_employee_id
      AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM attendance_location_exceptions
    WHERE tenant_id = p_tenant_id
      AND employee_id = p_employee_id
      AND status = 'approved'
      AND start_date <= p_end_date
      AND end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'An approved remote exception already exists for this employee within the selected date range';
  END IF;

  INSERT INTO attendance_location_exceptions (
    tenant_id, employee_id, exception_type, start_date, end_date,
    reason, status, requested_by, approved_by, approved_at
  )
  VALUES (
    p_tenant_id, p_employee_id, p_exception_type, p_start_date, p_end_date,
    trim(p_reason), 'approved', v_hr_employee_id, v_hr_employee_id, now()
  )
  RETURNING id INTO v_exception_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'attendance.remote_exception_created',
    'attendance_location_exceptions', v_exception_id,
    jsonb_build_object('employee_id', p_employee_id, 'start_date', p_start_date, 'end_date', p_end_date, 'type', p_exception_type, 'correlation_id', v_correlation_id)
  );

  RETURN v_exception_id;
END;
$function$;

-- [ 34] hr_deactivate_shift(p_tenant_id uuid, p_shift_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_deactivate_shift(p_tenant_id uuid, p_shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_shift shifts%ROWTYPE;
  v_other_default_count integer;
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  SELECT * INTO v_shift
  FROM shifts
  WHERE tenant_id = p_tenant_id
    AND id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  IF v_shift.is_default THEN
    SELECT count(*) INTO v_other_default_count
    FROM shifts
    WHERE tenant_id = p_tenant_id
      AND id <> p_shift_id
      AND is_default = true
      AND is_active IS NOT FALSE;

    IF v_other_default_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the only default shift. Set another shift as default first.';
    END IF;
  END IF;

  UPDATE shifts
  SET is_active = false,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND id = p_shift_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.deactivated', 'shifts', p_shift_id,
    jsonb_build_object('shift_name', v_shift.name, 'was_default', v_shift.is_default)
  );
END;
$function$;

-- [ 35] hr_reject_attendance_correction(p_tenant_id uuid, p_correction_id uuid, p_rejection_reason text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_reject_attendance_correction(p_tenant_id uuid, p_correction_id uuid, p_rejection_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_correction attendance_corrections%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_rejection_reason IS NULL OR length(trim(p_rejection_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_correction
  FROM attendance_corrections
  WHERE tenant_id = p_tenant_id
    AND id = p_correction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction request not found';
  END IF;

  IF v_correction.status <> 'pending' THEN
    RAISE EXCEPTION 'Correction request is already %', v_correction.status;
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_correction.attendance_date, v_correction.attendance_date);

  UPDATE attendance_corrections
  SET status = 'rejected',
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      rejection_reason = trim(p_rejection_reason)
  WHERE id = p_correction_id;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      p_tenant_id,
      v_correction.employee_id,
      'Attendance Correction Rejected',
      'Your correction request for ' || v_correction.attendance_date::text || ' was rejected. Reason: ' || trim(p_rejection_reason),
      'general',
      p_correction_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'correction.rejected',
    'attendance_corrections', p_correction_id,
    jsonb_build_object('employee_id', v_correction.employee_id, 'rejection_reason', trim(p_rejection_reason), 'correlation_id', v_correlation_id)
  );
END;
$function$;

-- [ 36] hr_save_shift(p_tenant_id uuid, p_shift_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_working_days integer[], p_half_day_cutoff_override time without time zone, p_punch_in_opens_minutes_before integer, p_late_mark_grace_override integer, p_is_default boolean)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_save_shift(p_tenant_id uuid, p_shift_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_working_days integer[], p_half_day_cutoff_override time without time zone, p_punch_in_opens_minutes_before integer, p_late_mark_grace_override integer, p_is_default boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_shift_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Shift name is required';
  END IF;

  IF p_working_days IS NULL OR array_length(p_working_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one working day';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_working_days) AS day_value WHERE day_value < 0 OR day_value > 6) THEN
    RAISE EXCEPTION 'Working days must be between 0 and 6';
  END IF;

  PERFORM 1 FROM shifts WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF p_is_default THEN
    UPDATE shifts
    SET is_default = false,
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND is_default = true
      AND (p_shift_id IS NULL OR id <> p_shift_id);
  END IF;

  IF p_shift_id IS NULL THEN
    INSERT INTO shifts (
      tenant_id, name, start_time, end_time, working_days,
      half_day_cutoff_override, punch_in_opens_minutes_before,
      late_mark_grace_override, is_default, is_active, created_at, updated_at
    )
    VALUES (
      p_tenant_id, trim(p_name), p_start_time, p_end_time, p_working_days,
      p_half_day_cutoff_override, COALESCE(p_punch_in_opens_minutes_before, 60),
      p_late_mark_grace_override, COALESCE(p_is_default, false), true, now(), now()
    )
    RETURNING id INTO v_shift_id;
  ELSE
    UPDATE shifts
    SET name = trim(p_name),
        start_time = p_start_time,
        end_time = p_end_time,
        working_days = p_working_days,
        half_day_cutoff_override = p_half_day_cutoff_override,
        punch_in_opens_minutes_before = COALESCE(p_punch_in_opens_minutes_before, 60),
        late_mark_grace_override = p_late_mark_grace_override,
        is_default = COALESCE(p_is_default, false),
        is_active = true,
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND id = p_shift_id
    RETURNING id INTO v_shift_id;

    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'Shift not found';
    END IF;
  END IF;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.saved', 'shifts', v_shift_id,
    jsonb_build_object('name', trim(p_name), 'is_default', COALESCE(p_is_default, false), 'correlation_id', v_correlation_id)
  );

  RETURN v_shift_id;
END;
$function$;

-- [ 37] hr_schedule_shift_change(p_tenant_id uuid, p_employee_id uuid, p_shift_id uuid, p_effective_from date)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_schedule_shift_change(p_tenant_id uuid, p_employee_id uuid, p_shift_id uuid, p_effective_from date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_effective_from date := COALESCE(p_effective_from, CURRENT_DATE + 1);
  v_effective_to date;
  v_assignment_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);
  v_effective_to := v_effective_from - 1;

  IF v_effective_from <= CURRENT_DATE THEN
    RAISE EXCEPTION 'Shift changes must be effective in the future';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = p_employee_id
      AND tenant_id = p_tenant_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Employee not found or inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shifts
    WHERE id = p_shift_id
      AND tenant_id = p_tenant_id
      AND is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'Shift not found or inactive';
  END IF;

  PERFORM 1
  FROM employee_shifts
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from <= v_effective_to
    AND (effective_to IS NULL OR effective_to >= v_effective_to)
  FOR UPDATE;

  UPDATE employee_shifts
  SET effective_to = v_effective_to
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from <= v_effective_to
    AND (effective_to IS NULL OR effective_to >= v_effective_to);

  DELETE FROM employee_shifts
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from = v_effective_from;

  INSERT INTO employee_shifts (tenant_id, employee_id, shift_id, effective_from)
  VALUES (p_tenant_id, p_employee_id, p_shift_id, v_effective_from)
  RETURNING id INTO v_assignment_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.assignment', 'employee_shifts', v_assignment_id,
    jsonb_build_object('employee_id', p_employee_id, 'shift_id', p_shift_id, 'effective_from', v_effective_from, 'correlation_id', v_correlation_id)
  );

  RETURN v_assignment_id;
END;
$function$;

-- [ 38] hr_set_overtime_status(p_tenant_id uuid, p_overtime_id uuid, p_approved boolean)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_set_overtime_status(p_tenant_id uuid, p_overtime_id uuid, p_approved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_record overtime_records%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  SELECT * INTO v_record
  FROM overtime_records
  WHERE tenant_id = p_tenant_id
    AND id = p_overtime_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overtime record not found';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_record.date, v_record.date);

  IF p_approved THEN
    UPDATE overtime_records
    SET approved = true,
        approved_by = v_hr_employee_id
    WHERE id = p_overtime_id;
  ELSE
    DELETE FROM overtime_records
    WHERE id = p_overtime_id;
  END IF;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr',
    CASE WHEN p_approved THEN 'overtime.approved' ELSE 'overtime.rejected' END,
    'overtime_records', p_overtime_id,
    jsonb_build_object('employee_id', v_record.employee_id, 'date', v_record.date, 'hours', v_record.overtime_hours, 'correlation_id', v_correlation_id)
  );
END;
$function$;

-- [ 39] hr_update_attendance(p_tenant_id uuid, p_attendance_id uuid, p_employee_id uuid, p_date date, p_punch_in time without time zone, p_punch_out time without time zone, p_status text, p_is_late boolean, p_expected_status text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.hr_update_attendance(p_tenant_id uuid, p_attendance_id uuid, p_employee_id uuid, p_date date, p_punch_in time without time zone, p_punch_out time without time zone, p_status text, p_is_late boolean DEFAULT NULL::boolean, p_expected_status text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_attendance attendance%ROWTYPE;
  v_tenant tenants%ROWTYPE;
  v_punch_in timestamptz;
  v_punch_out timestamptz;
  v_raw_hours numeric;
  v_work_hours numeric;
  v_lunch_minutes integer;
  v_tracking_enabled text;
  v_deduction_mode text;
  v_break_minutes integer := 0;
  v_final_is_late boolean;
  v_attendance_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_status NOT IN ('present', 'absent', 'half_day', 'on_leave') THEN
    RAISE EXCEPTION 'Invalid attendance status: %', p_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE tenant_id = p_tenant_id
      AND id = p_employee_id
  ) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, p_date, p_date);

  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  v_lunch_minutes := COALESCE(v_tenant.lunch_break_minutes, 0);

  IF p_attendance_id IS NOT NULL THEN
    SELECT * INTO v_attendance
    FROM attendance
    WHERE tenant_id = p_tenant_id
      AND id = p_attendance_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attendance record not found';
    END IF;
  ELSE
    SELECT * INTO v_attendance
    FROM attendance
    WHERE tenant_id = p_tenant_id
      AND employee_id = p_employee_id
      AND date = p_date
    FOR UPDATE;
  END IF;

  IF v_attendance.id IS NOT NULL AND p_expected_status IS NOT NULL THEN
    IF v_attendance.status <> p_expected_status THEN
      RAISE EXCEPTION 'CONCURRENCY_ERROR' USING DETAIL = 'Attendance record has been modified by another user.';
    END IF;
  END IF;

  IF p_punch_in IS NOT NULL THEN
    v_punch_in := (p_date + p_punch_in)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
  END IF;

  IF p_punch_out IS NOT NULL THEN
    v_punch_out := (p_date + p_punch_out)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
    IF p_punch_in IS NOT NULL AND p_punch_out < p_punch_in THEN
      v_punch_out := ((p_date + 1) + p_punch_out)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
    END IF;
  END IF;

  IF v_punch_in IS NOT NULL AND v_punch_out IS NOT NULL THEN
    v_raw_hours := EXTRACT(EPOCH FROM (v_punch_out - v_punch_in)) / 3600.0;
    IF v_raw_hours > 18 THEN
      RAISE EXCEPTION 'Shift duration exceeds maximum limit of 18 hours';
    END IF;

    SELECT value INTO v_tracking_enabled
    FROM tenant_settings
    WHERE tenant_id = p_tenant_id
      AND key = 'break_tracking_enabled';

    SELECT value INTO v_deduction_mode
    FROM tenant_settings
    WHERE tenant_id = p_tenant_id
      AND key = 'break_deduction_mode';

    IF v_attendance.id IS NOT NULL THEN
      v_break_minutes := COALESCE(v_attendance.total_break_minutes, 0);
      IF v_attendance.current_break_id IS NOT NULL AND v_attendance.current_break_start IS NOT NULL THEN
        v_break_minutes := v_break_minutes + GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_punch_out - v_attendance.current_break_start)) / 60.0));
      END IF;
    END IF;

    IF COALESCE(v_tracking_enabled, 'false') = 'true'
      AND COALESCE(v_deduction_mode, 'fixed') = 'actual'
      AND v_break_minutes > 0 THEN
      v_work_hours := ROUND(GREATEST(0, v_raw_hours - (v_break_minutes / 60.0)), 2);
    ELSE
      v_work_hours := ROUND(GREATEST(0, v_raw_hours - CASE WHEN v_raw_hours >= 5 THEN v_lunch_minutes / 60.0 ELSE 0 END), 2);
    END IF;
  END IF;

  v_final_is_late := CASE
    WHEN p_status IN ('half_day', 'absent') THEN false
    ELSE COALESCE(p_is_late, v_attendance.is_late, false)
  END;

  IF v_attendance.id IS NULL THEN
    INSERT INTO attendance (
      tenant_id, employee_id, date, punch_in, punch_out, status,
      work_hours, is_late, session_status
    )
    VALUES (
      p_tenant_id, p_employee_id, p_date, v_punch_in, v_punch_out, p_status,
      v_work_hours, v_final_is_late,
      CASE
        WHEN p_status IN ('absent', 'on_leave') THEN 'closed'
        WHEN v_punch_in IS NULL THEN 'closed'
        WHEN v_punch_out IS NULL THEN 'open'
        ELSE 'closed'
      END
    )
    RETURNING id INTO v_attendance_id;
  ELSE
    UPDATE attendance
    SET punch_in = v_punch_in,
        punch_out = v_punch_out,
        status = p_status,
        work_hours = v_work_hours,
        is_late = v_final_is_late,
        session_status = CASE
          WHEN p_status IN ('absent', 'on_leave') THEN 'closed'
          WHEN v_punch_in IS NULL THEN 'closed'
          WHEN v_punch_out IS NULL THEN session_status
          ELSE 'closed'
        END
    WHERE id = v_attendance.id
    RETURNING id INTO v_attendance_id;
  END IF;

  DELETE FROM overtime_records
  WHERE tenant_id = p_tenant_id
    AND attendance_id = v_attendance_id
    AND approved = false;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'attendance.edited', 'attendance', v_attendance_id,
    jsonb_build_object(
      'employee_id', p_employee_id,
      'date', p_date,
      'status', p_status,
      'punch_in', v_punch_in,
      'punch_out', v_punch_out,
      'severity', 'WARNING',
      'correlation_id', v_correlation_id
    )
  );

  RETURN v_attendance_id;
END;
$function$;

-- [ 40] increment_announcement_dismiss(ann_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.increment_announcement_dismiss(ann_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.announcements SET dismiss_count = dismiss_count + 1 WHERE id = ann_id;
END;
$function$;

-- [ 41] increment_announcement_view(ann_id uuid)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.increment_announcement_view(ann_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.announcements SET view_count = view_count + 1 WHERE id = ann_id;
END;
$function$;

-- [ 42] log_application_status_change()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.log_application_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_type TEXT;
BEGIN
  -- Attempt to read from transaction-local config variables, fallback to auth.uid()
  BEGIN
    v_actor_id := NULLIF(current_setting('app.current_actor_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  BEGIN
    v_actor_type := NULLIF(current_setting('app.current_actor_type', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_actor_type := NULL;
  END;

  IF v_actor_id IS NULL THEN
    BEGIN
      v_actor_id := auth.uid()::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_actor_id := NULL;
    END;
  END IF;

  IF v_actor_type IS NULL THEN
    IF v_actor_id IS NOT NULL THEN
      -- Lookup profile role to set actor_type
      SELECT role INTO v_actor_type FROM public.profiles WHERE id = v_actor_id;
      IF v_actor_type IN ('admin', 'super_admin') THEN
        v_actor_type := 'admin';
      ELSIF v_actor_type = 'recruiter' THEN
        v_actor_type := 'recruiter';
      ELSE
        v_actor_type := 'candidate';
      END IF;
    ELSE
      v_actor_type := 'system';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.application_status_history (
      application_id, from_status, to_status, changed_by, actor_type, note
    ) VALUES (
      NEW.id, NULL, NEW.status, v_actor_id, v_actor_type, 'Application submitted'
    );
  ELSIF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.application_status_history (
      application_id, from_status, to_status, changed_by, actor_type, note
    ) VALUES (
      NEW.id, OLD.status, NEW.status, v_actor_id, v_actor_type, 
      CASE 
        WHEN NEW.status = 'withdrawn' THEN 'Application withdrawn by candidate'
        ELSE 'Status updated'
      END
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- [ 43] notify_chat_channel()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.notify_chat_channel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM realtime.publish('chat_channels', TG_OP || '_channel', row_to_json(OLD)::jsonb);
    RETURN OLD;
  ELSE
    PERFORM realtime.publish('chat_channels', TG_OP || '_channel', row_to_json(NEW)::jsonb);
    RETURN NEW;
  END IF;
END;
$function$;

-- [ 44] notify_chat_message()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.notify_chat_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    -- Publish to both the channel-specific topic and the global topic
    PERFORM realtime.publish('chat:' || OLD.channel, 'DELETE_message', row_to_json(OLD)::jsonb);
    PERFORM realtime.publish('chat_messages', 'DELETE', row_to_json(OLD)::jsonb);
    RETURN OLD;
  ELSE
    -- Publish to both the channel-specific topic and the global topic
    PERFORM realtime.publish('chat:' || NEW.channel, TG_OP || '_message', row_to_json(NEW)::jsonb);
    PERFORM realtime.publish('chat_messages', TG_OP, row_to_json(NEW)::jsonb);
    RETURN NEW;
  END IF;
END;
$function$;

-- [ 45] notify_employee_notification()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.notify_employee_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM realtime.publish(
    'notifications:' || NEW.employee_id::text,
    'INSERT_notification',
    row_to_json(NEW)::jsonb
  );
  RETURN NEW;
END;
$function$;

-- [ 46] protect_chat_message_integrity()
CREATE OR REPLACE FUNCTION public.protect_chat_message_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF (
        NEW.channel_id IS DISTINCT FROM OLD.channel_id
        OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
    ) THEN
        RAISE EXCEPTION 'channel_id and sender_id are immutable and cannot be changed';
    END IF;

    RETURN NEW;
END;
$function$;

-- [ 47] punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_lunch_minutes integer, p_overtime_enabled boolean, p_overtime_rate numeric, p_expected_shift_hours numeric)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_lunch_minutes integer, p_overtime_enabled boolean, p_overtime_rate numeric, p_expected_shift_hours numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_attendance        attendance%ROWTYPE;
  v_tenant            tenants%ROWTYPE;
  v_tenant_tz         text;
  v_today_in_tz       date;
  v_unresolved_count  integer;
  v_payroll_lock_date date;
  v_payroll_lock_str  text;
  v_raw_hours         numeric;
  v_lunch_deduction   numeric;
  v_work_hours        numeric;
  v_overtime_hours    numeric;
  v_row_count         integer;
  v_now               timestamptz := now();
  v_tracking_enabled  text;
  v_deduction_mode    text;
BEGIN
  -- ── 1. LOCK ATTENDANCE SESSION ─────────────────────────────────────────────
  SELECT * INTO v_attendance
  FROM attendance
  WHERE id = p_attendance_id
    AND tenant_id = p_tenant_id
    AND session_status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
    VALUES (p_tenant_id, NULL, 'system', 'attendance.corrupted_session_detected',
            'attendance', p_attendance_id,
            jsonb_build_object('errcode', 'P0001', 'severity', 'WARNING'));
    RAISE EXCEPTION 'INVALID_OPEN_SESSION'
      USING ERRCODE = 'P0001',
            DETAIL  = 'Attendance session not found or already closed.';
  END IF;

  -- ── 2. RESOLVE TENANT TIMEZONE ─────────────────────────────────────────────
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  v_tenant_tz     := COALESCE(v_tenant.timezone, 'UTC');
  v_today_in_tz   := (v_now AT TIME ZONE v_tenant_tz)::date;

  -- ── 3. PAYROLL LOCK GUARD ──────────────────────────────────────────────────
  SELECT value INTO v_payroll_lock_str
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id AND key = 'payroll_lock_date';

  IF v_payroll_lock_str IS NOT NULL AND v_payroll_lock_str <> '' THEN
    v_payroll_lock_date := v_payroll_lock_str::date;
    IF v_attendance.date <= v_payroll_lock_date THEN
      INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (p_tenant_id, v_attendance.employee_id, 'employee', 'attendance.punch_out_blocked',
              'attendance', p_attendance_id,
              jsonb_build_object('errcode', 'P0002',
                                 'lock_date', v_payroll_lock_date,
                                 'attendance_date', v_attendance.date));
      RAISE EXCEPTION 'PAYROLL_LOCKED'
        USING ERRCODE = 'P0002',
              DETAIL  = 'This attendance record falls within a locked payroll period.';
    END IF;
  END IF;

  -- ── 4. TASK GATE ENFORCEMENT ───────────────────────────────────────────────
  IF v_tenant.punch_out_gate_enabled THEN
    SELECT COUNT(*) INTO v_unresolved_count
    FROM tasks
    WHERE tenant_id    = p_tenant_id
      AND assigned_to  = v_attendance.employee_id
      AND due_date     <= v_today_in_tz
      AND status       IN ('assigned', 'submitted', 'rejected', 'overdue');

    IF v_unresolved_count > 0 THEN
      INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (p_tenant_id, v_attendance.employee_id, 'employee', 'attendance.punch_out_blocked',
              'attendance', p_attendance_id,
              jsonb_build_object('errcode', 'P0003',
                                 'unresolved_task_count', v_unresolved_count,
                                 'evaluated_date', v_today_in_tz,
                                 'tenant_timezone', v_tenant_tz));
      RAISE EXCEPTION 'TASK_GATE_BLOCKED'
        USING ERRCODE = 'P0003',
              DETAIL  = 'Employee has unresolved tasks that require HR approval before punch-out.';
    END IF;
  END IF;

  -- ── 5. COMPUTE WORK HOURS ──────────────────────────────────────────────────
  -- Note: The trigger `trg_auto_close_active_break` will automatically close any active break
  -- when session_status is updated to 'closed' or punch_out is updated.
  -- This will update v_attendance fields in the DB, but since we have v_attendance in variables,
  -- let's manually replicate the trigger effect to calculate work hours correctly here.
  IF v_attendance.current_break_id IS NOT NULL THEN
    -- Calculate duration
    DECLARE
      v_break_duration integer;
      v_break_limit    integer;
      v_break_over     integer;
      v_break_type     text;
    BEGIN
      SELECT break_type INTO v_break_type FROM public.attendance_breaks WHERE id = v_attendance.current_break_id;
      
      v_break_duration := ROUND(EXTRACT(EPOCH FROM (v_now - v_attendance.current_break_start)) / 60.0);
      
      v_break_limit := 15;
      IF v_break_type = 'lunch' THEN
        v_break_limit := p_lunch_minutes;
      ELSE
        SELECT COALESCE(value::integer, 15) INTO v_break_limit
        FROM tenant_settings
        WHERE tenant_id = p_tenant_id AND key = 'short_break_limit_minutes';
      END IF;
      
      v_break_over := GREATEST(0, v_break_duration - v_break_limit);
      
      UPDATE public.attendance_breaks
      SET ended_at = v_now,
          duration_minutes = v_break_duration,
          over_limit_minutes = v_break_over
      WHERE id = v_attendance.current_break_id;
      
      v_attendance.total_break_minutes := COALESCE(v_attendance.total_break_minutes, 0) + v_break_duration;
      v_attendance.current_break_id := NULL;
      v_attendance.current_break_start := NULL;
    END;
  END IF;

  -- Determine deduction policy
  SELECT value INTO v_tracking_enabled
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id AND key = 'break_tracking_enabled';

  SELECT value INTO v_deduction_mode
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id AND key = 'break_deduction_mode';

  v_raw_hours := EXTRACT(EPOCH FROM (v_now - v_attendance.punch_in)) / 3600.0;

  IF COALESCE(v_tracking_enabled, 'false') = 'true' AND COALESCE(v_deduction_mode, 'fixed') = 'actual' THEN
    -- Deduct actual tracked break minutes (minimum 0)
    -- Fall back to fixed policy lunch minutes if no breaks were tracked at all and raw hours >= 5
    IF COALESCE(v_attendance.total_break_minutes, 0) > 0 THEN
      v_lunch_deduction := v_attendance.total_break_minutes / 60.0;
    ELSIF v_raw_hours >= 5 THEN
      v_lunch_deduction := p_lunch_minutes / 60.0;
    ELSE
      v_lunch_deduction := 0;
    END IF;
  ELSE
    -- Fixed deduction: strictly deduct policy lunch minutes if raw hours >= 5
    IF v_raw_hours >= 5 THEN
      v_lunch_deduction := p_lunch_minutes / 60.0;
    ELSE
      v_lunch_deduction := 0;
    END IF;
  END IF;

  v_work_hours := ROUND(GREATEST(0, v_raw_hours - v_lunch_deduction), 2);

  -- ── 6. WRITE PUNCH-OUT ─────────────────────────────────────────────────────
  UPDATE attendance
  SET punch_out             = v_now,
      work_hours            = v_work_hours,
      session_status        = 'closed',
      punch_out_lat         = p_lat,
      punch_out_lng         = p_lng,
      punch_out_location_accuracy = p_acc,
      punch_out_location_status   = p_loc_status,
      total_break_minutes   = v_attendance.total_break_minutes,
      current_break_id      = NULL,
      current_break_start   = NULL
  WHERE id = p_attendance_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  -- ── 7. OVERTIME ────────────────────────────────────────────────────────────
  v_overtime_hours := 0;
  IF p_overtime_enabled THEN
    v_overtime_hours := ROUND(GREATEST(0, v_work_hours - p_expected_shift_hours), 2);
    IF v_overtime_hours > 0 THEN
      INSERT INTO overtime_records (
        tenant_id, employee_id, attendance_id, date, regular_hours,
        overtime_hours, overtime_rate, overtime_amount, approved
      ) VALUES (
        p_tenant_id, v_attendance.employee_id, p_attendance_id, v_attendance.date,
        p_expected_shift_hours, v_overtime_hours, p_overtime_rate,
        ROUND(v_overtime_hours * p_overtime_rate, 2), false
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'reason',         null,
    'work_hours',     v_work_hours,
    'overtime_hours', v_overtime_hours,
    'updated_row_count', v_row_count
  );

EXCEPTION 
  WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0003' OR SQLSTATE 'P0004' OR SQLSTATE 'P0005' OR SQLSTATE 'P0006' OR SQLSTATE 'P0007' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  SQLERRM,
      'errcode', SQLSTATE
    );
END;
$function$;

-- [ 48] punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_work_hours numeric, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_work_hours numeric, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE attendance
  SET punch_out = now(),
      work_hours = p_work_hours,
      session_status = 'closed',
      punch_out_lat = p_lat,
      punch_out_lng = p_lng,
      punch_out_location_accuracy = p_acc,
      punch_out_location_status = p_loc_status
  WHERE id = p_attendance_id AND tenant_id = p_tenant_id AND session_status = 'open';
END;
$function$;

-- [ 49] reject_task_request(p_task_id uuid, p_hr_employee_id uuid, p_notes text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.reject_task_request(p_task_id uuid, p_hr_employee_id uuid, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_tenant_id UUID;
  v_submission_id UUID;
BEGIN
  -- 1. Fetch and lock task
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  v_tenant_id := v_task.tenant_id;

  -- 2. Update task status
  UPDATE public.tasks
  SET status = 'rejected', updated_at = NOW()
  WHERE id = p_task_id;

  -- 3. Update latest submission
  SELECT id INTO v_submission_id
  FROM public.task_submissions
  WHERE task_id = p_task_id AND tenant_id = v_tenant_id
  ORDER BY submitted_at DESC
  LIMIT 1;

  IF v_submission_id IS NOT NULL THEN
    UPDATE public.task_submissions
    SET status = 'rejected', reviewed_by = p_hr_employee_id, reviewed_at = NOW(), review_notes = p_notes
    WHERE id = v_submission_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- [ 50] reject_task_request(p_task_id uuid, p_notes text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.reject_task_request(p_task_id uuid, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_tenant_id UUID;
  v_submission_id UUID;
  v_caller_uid UUID;
  v_hr_employee_id UUID;
BEGIN
  -- 0. Derive reviewer identity from auth context.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  -- 1. Fetch and lock task
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  v_tenant_id := v_task.tenant_id;

  -- 2. Verify caller is an HR employee of this tenant.
  SELECT id INTO v_hr_employee_id
  FROM public.employees
  WHERE user_id = v_caller_uid
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caller is not an HR employee of this tenant';
  END IF;

  -- Additional role check
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = v_caller_uid
      AND metadata->>'role' = 'hr'
  ) THEN
    RAISE EXCEPTION 'Insufficient role: HR privileges required';
  END IF;

  -- 3. Update task status
  UPDATE public.tasks
  SET status = 'rejected', updated_at = NOW()
  WHERE id = p_task_id;

  -- 4. Update latest submission — reviewer derived from server-side identity
  SELECT id INTO v_submission_id
  FROM public.task_submissions
  WHERE task_id = p_task_id AND tenant_id = v_tenant_id
  ORDER BY submitted_at DESC
  LIMIT 1;

  IF v_submission_id IS NOT NULL THEN
    UPDATE public.task_submissions
    SET status = 'rejected', reviewed_by = v_hr_employee_id, reviewed_at = NOW(), review_notes = p_notes
    WHERE id = v_submission_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- [ 51] set_current_timestamp_updated_at()
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- [ 52] set_hr_user_metadata(user_email text, tenant_uuid uuid, user_name text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.set_hr_user_metadata(user_email text, tenant_uuid uuid, user_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  updated_user_id uuid;
BEGIN
  IF NOT (SELECT public.is_superadmin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE auth.users
  SET email_verified = true,
      metadata = jsonb_build_object('role', 'hr', 'tenant_id', tenant_uuid),
      profile = COALESCE(profile, '{}'::jsonb) || jsonb_build_object('name', COALESCE(user_name, user_email)),
      updated_at = now()
  WHERE email = user_email
  RETURNING id INTO updated_user_id;

  INSERT INTO public.platform_audit_logs (actor_user_id, actor_email, action, target_table, target_id, after_data)
  SELECT (SELECT auth.uid()), u.email, 'CREATE_HR_ADMIN', 'auth.users', updated_user_id,
         jsonb_build_object('email', user_email, 'tenant_id', tenant_uuid)
  FROM auth.users u
  WHERE u.id = (SELECT auth.uid());

  RETURN updated_user_id;
END;
$function$;

-- [ 53] start_employee_break(p_attendance_id uuid, p_tenant_id uuid, p_break_type text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.start_employee_break(p_attendance_id uuid, p_tenant_id uuid, p_break_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_attendance  attendance%ROWTYPE;
  v_break_id    uuid;
  v_now         timestamptz := now();
BEGIN
  -- Lock attendance row
  SELECT * INTO v_attendance
  FROM attendance
  WHERE id = p_attendance_id
    AND tenant_id = p_tenant_id
    AND session_status = 'open'
    AND punch_in IS NOT NULL
    AND punch_out IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTENDANCE_NOT_OPEN'
      USING ERRCODE = 'P0004',
            DETAIL  = 'Attendance session is not open or employee is not punched in.';
  END IF;

  -- Enforce break type value validation
  IF p_break_type NOT IN ('lunch', 'short_break', 'tea_break') THEN
    RAISE EXCEPTION 'INVALID_BREAK_TYPE'
      USING ERRCODE = 'P0007',
            DETAIL  = 'Break type must be lunch, short_break, or tea_break.';
  END IF;

  -- Double-click / concurrent starts protection
  IF v_attendance.current_break_id IS NOT NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_ALREADY_ON_BREAK'
      USING ERRCODE = 'P0005',
            DETAIL  = 'Employee is already on active break.';
  END IF;

  -- Insert break record
  INSERT INTO public.attendance_breaks (
    tenant_id, employee_id, attendance_id, break_type, started_at
  ) VALUES (
    p_tenant_id, v_attendance.employee_id, p_attendance_id, p_break_type, v_now
  ) RETURNING id INTO v_break_id;

  -- Update attendance row
  UPDATE public.attendance
  SET current_break_id = v_break_id,
      current_break_start = v_now
  WHERE id = p_attendance_id;

  -- Log audit action
  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (p_tenant_id, v_attendance.employee_id, 'employee', 'attendance.break_started',
          'attendance', p_attendance_id,
          jsonb_build_object('break_id', v_break_id, 'break_type', p_break_type, 'started_at', v_now));

  RETURN jsonb_build_object(
    'success', true,
    'break_id', v_break_id,
    'started_at', v_now
  );
END;
$function$;

-- [ 54] submit_task_request(p_task_id uuid, p_employee_id uuid, p_notes text, p_attachment_url text, p_attachment_name text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.submit_task_request(p_task_id uuid, p_employee_id uuid, p_notes text, p_attachment_url text, p_attachment_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_tenant_id UUID;
  v_submission_id UUID;
BEGIN
  -- 1. Fetch and lock task
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
    AND assigned_to = p_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or not assigned to this employee';
  END IF;

  v_tenant_id := v_task.tenant_id;

  -- 2. Insert new submission
  INSERT INTO public.task_submissions (
    task_id, tenant_id, employee_id, notes, attachment_url, attachment_name, status, submitted_at
  ) VALUES (
    p_task_id, v_tenant_id, p_employee_id, p_notes, p_attachment_url, p_attachment_name, 'pending', NOW()
  ) RETURNING id INTO v_submission_id;

  -- 3. Update task status
  UPDATE public.tasks
  SET status = 'submitted', updated_at = NOW()
  WHERE id = p_task_id;

  -- 4. Notify HR (handled by frontend for simplicity, or we can do it here. Let's let frontend handle notification for now)

  RETURN jsonb_build_object('success', true, 'submission_id', v_submission_id);
END;
$function$;

-- [ 55] submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text)  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_tenant_id UUID;
  v_submission_id UUID;
  v_caller_uid UUID;
  v_employee_id UUID;
BEGIN
  -- 0. Derive submitter identity from auth context — do NOT trust caller-supplied ID.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  -- 1. Fetch and lock task
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  v_tenant_id := v_task.tenant_id;

  -- 2. Resolve the employee record for this caller within this tenant.
  SELECT id INTO v_employee_id
  FROM public.employees
  WHERE user_id = v_caller_uid
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caller is not an employee of this tenant';
  END IF;

  -- 3. Confirm the task is actually assigned to this employee.
  IF v_task.assigned_to != v_employee_id THEN
    RAISE EXCEPTION 'Task not found or not assigned to this employee';
  END IF;

  -- 4. Insert new submission
  INSERT INTO public.task_submissions (
    task_id, tenant_id, employee_id, notes, attachment_url, attachment_name, status, submitted_at
  ) VALUES (
    p_task_id, v_tenant_id, v_employee_id, p_notes, p_attachment_url, p_attachment_name, 'pending', NOW()
  ) RETURNING id INTO v_submission_id;

  -- 5. Update task status
  UPDATE public.tasks
  SET status = 'submitted', updated_at = NOW()
  WHERE id = p_task_id;

  RETURN jsonb_build_object('success', true, 'submission_id', v_submission_id);
END;
$function$;

-- [ 56] sync_admin_users()  [SECURITY DEFINER]
CREATE OR REPLACE FUNCTION public.sync_admin_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.test_log (msg) VALUES (
    'sync_admin_users: OP=' || TG_OP || 
    ', NEW.role=' || COALESCE(NEW.role, 'NULL') || 
    ', NEW.is_active=' || COALESCE(NEW.is_active::text, 'NULL') || 
    ', NEW.id=' || NEW.id::text
  );

  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.admin_users WHERE user_id = OLD.id;
    RETURN OLD;
  ELSIF (NEW.role IN ('admin', 'super_admin') AND NEW.is_active = true) THEN
    INSERT INTO public.admin_users (user_id) VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    DELETE FROM public.admin_users WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- [ 57] update_updated_at_column()
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
