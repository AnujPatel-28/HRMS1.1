ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS attendance_lock_date DATE;

-- submit_task_request
-- SECURITY HARDENING: p_employee_id removed. The submitting employee is now
-- derived server-side from auth.uid() to prevent impersonation attacks.
CREATE OR REPLACE FUNCTION public.submit_task_request(
  p_task_id UUID,
  p_notes TEXT,
  p_attachment_url TEXT,
  p_attachment_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- approve_task_request
-- SECURITY HARDENING: p_hr_employee_id removed. The approving HR user is now
-- derived server-side from auth.uid() to prevent privilege escalation attacks.
CREATE OR REPLACE FUNCTION public.approve_task_request(
  p_task_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- reject_task_request
-- SECURITY HARDENING: p_hr_employee_id removed. The rejecting HR user is now
-- derived server-side from auth.uid() to prevent privilege escalation attacks.
CREATE OR REPLACE FUNCTION public.reject_task_request(
  p_task_id UUID,
  p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;
