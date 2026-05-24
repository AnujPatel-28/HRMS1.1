ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS attendance_lock_date DATE;

-- submit_task_request
CREATE OR REPLACE FUNCTION public.submit_task_request(
  p_task_id UUID,
  p_employee_id UUID,
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
$$;

-- approve_task_request
CREATE OR REPLACE FUNCTION public.approve_task_request(
  p_task_id UUID,
  p_hr_employee_id UUID
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
$$;

-- reject_task_request
CREATE OR REPLACE FUNCTION public.reject_task_request(
  p_task_id UUID,
  p_hr_employee_id UUID,
  p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;
