-- Migration: Terminated Employee Exit Completion Handling
-- This migration updates the complete_exit_transaction function to handle already terminated employees gracefully,
-- completing the exit request while keeping the employee status as 'terminated' and logging a warning.

CREATE OR REPLACE FUNCTION public.complete_exit_transaction(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.exit_requests%ROWTYPE;
  v_actor_employee_id uuid;
  v_pending_clearance_count integer;
  v_employee_status text;
  v_new_employee_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can complete offboarding';
  END IF;

  SELECT *
  INTO v_request
  FROM public.exit_requests
  WHERE id = p_request_id
    AND tenant_id = public.get_auth_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exit request not found';
  END IF;

  IF v_request.status = 'completed' THEN
    RAISE EXCEPTION 'Exit request is already completed';
  END IF;

  IF v_request.status NOT IN ('notice_period', 'clearance_pending') THEN
    RAISE EXCEPTION 'Exit request must be in notice period or clearance pending before completion';
  END IF;

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_request.tenant_id
  LIMIT 1;

  SELECT COUNT(*)
  INTO v_pending_clearance_count
  FROM public.exit_clearances
  WHERE exit_request_id = p_request_id
    AND status <> 'approved';

  IF v_pending_clearance_count = 0 THEN
    NULL;
  ELSIF NOT (
    COALESCE(v_request.clearance_assets, false)
    AND COALESCE(v_request.clearance_it, false)
    AND COALESCE(v_request.clearance_finance, false)
    AND COALESCE(v_request.clearance_hr, false)
    AND COALESCE(v_request.clearance_admin, false)
  ) THEN
    RAISE EXCEPTION 'Cannot complete exit: % clearance item(s) are still pending', v_pending_clearance_count;
  END IF;

  -- Check employee's current status and update
  SELECT status INTO v_employee_status
  FROM public.employees
  WHERE id = v_request.employee_id
    AND tenant_id = v_request.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee record not found';
  END IF;

  v_new_employee_status := v_employee_status;

  IF v_employee_status = 'active' THEN
    UPDATE public.employees
    SET status = 'inactive',
        updated_at = now()
    WHERE id = v_request.employee_id
      AND tenant_id = v_request.tenant_id;
    v_new_employee_status := 'inactive';
  END IF;

  UPDATE public.exit_requests
  SET status = 'completed',
      updated_at = now()
  WHERE id = p_request_id
    AND tenant_id = v_request.tenant_id;

  INSERT INTO public.audit_logs (
    tenant_id,
    actor_id,
    actor_role,
    action,
    target_type,
    target_id,
    details,
    status
  )
  VALUES (
    v_request.tenant_id,
    v_actor_employee_id,
    'hr',
    'offboarding.completed',
    'exit_requests',
    p_request_id,
    jsonb_build_object(
      'employee_id', v_request.employee_id,
      'previous_exit_status', v_request.status,
      'previous_employee_status', v_employee_status,
      'new_employee_status', v_new_employee_status,
      'employee_already_inactive', (v_employee_status = 'inactive'),
      'employee_already_terminated', (v_employee_status = 'terminated'),
      'warning', CASE WHEN v_employee_status = 'terminated' THEN 'Employee was already terminated before offboarding completion; exit request was completed for workflow reconciliation.' ELSE NULL END
    ),
    'success'
  );
END;
$$;
