-- Release 7: Structured Exit Interview
-- Adds exit_interview_data jsonb + completed_at/by columns to exit_requests.
-- Creates update_exit_interview_transaction RPC.
-- Backfills legacy rows.
-- Updates complete_exit_transaction to require structured interview data.

-- ─────────────────────────────────────────────────────────────
-- Step 1: Add structured interview columns
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.exit_requests
  ADD COLUMN IF NOT EXISTS exit_interview_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.exit_requests
  ADD COLUMN IF NOT EXISTS exit_interview_completed_at timestamptz;

ALTER TABLE public.exit_requests
  ADD COLUMN IF NOT EXISTS exit_interview_completed_by uuid;

-- FK to employees (consistent with existing FK patterns in exit_requests)
ALTER TABLE public.exit_requests
  DROP CONSTRAINT IF EXISTS exit_requests_exit_interview_completed_by_fkey;

ALTER TABLE public.exit_requests
  ADD CONSTRAINT exit_requests_exit_interview_completed_by_fkey
  FOREIGN KEY (exit_interview_completed_by)
  REFERENCES public.employees(id);

-- ─────────────────────────────────────────────────────────────
-- Step 2: Backfill legacy rows that have exit_feedback but empty exit_interview_data
-- This ensures complete_exit_transaction does not break existing completed/done rows.
-- ─────────────────────────────────────────────────────────────

UPDATE public.exit_requests
SET exit_interview_data = jsonb_build_object(
  'legacy_feedback', exit_feedback,
  'migration_source', 'exit_feedback'
)
WHERE exit_interview_done = true
  AND exit_feedback IS NOT NULL
  AND trim(exit_feedback) <> ''
  AND (exit_interview_data IS NULL OR exit_interview_data = '{}'::jsonb);

-- ─────────────────────────────────────────────────────────────
-- Step 3: Create update_exit_interview_transaction RPC
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_exit_interview_transaction(
  p_request_id uuid,
  p_exit_interview_data jsonb,
  p_exit_feedback text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.exit_requests%ROWTYPE;
  v_actor_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can submit exit interviews';
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

  IF v_request.status IN ('completed', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'Cannot update exit interview: request status is %', v_request.status;
  END IF;

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_request.tenant_id
  LIMIT 1;

  UPDATE public.exit_requests
  SET exit_interview_data       = p_exit_interview_data,
      exit_feedback             = p_exit_feedback,
      exit_interview_done       = true,
      exit_interview_completed_at = now(),
      exit_interview_completed_by = v_actor_employee_id,
      updated_at                = now()
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
    'offboarding.exit_interview_completed',
    'exit_requests',
    p_request_id,
    jsonb_build_object(
      'employee_id', v_request.employee_id,
      'primary_reason', p_exit_interview_data ->> 'primary_reason',
      'risk_level', p_exit_interview_data ->> 'risk_level',
      'rehire_eligible', p_exit_interview_data -> 'rehire_eligible'
    ),
    'success'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_exit_interview_transaction(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_exit_interview_transaction(uuid, jsonb, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Step 4: Update complete_exit_transaction to require structured exit interview data
-- Builds on Release 6A version (required clearance check preserved).
-- Old rows with exit_interview_done=true and exit_feedback (now backfilled) are compatible.
-- ─────────────────────────────────────────────────────────────

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
  v_blocking_clearance_count integer;
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

  -- Block on required, non-cancelled clearance rows (from Release 6A)
  SELECT COUNT(*)
  INTO v_blocking_clearance_count
  FROM public.exit_clearances
  WHERE exit_request_id = p_request_id
    AND is_required = true
    AND status NOT IN ('approved', 'cancelled');

  IF v_blocking_clearance_count > 0 THEN
    RAISE EXCEPTION 'Cannot complete exit: % required clearance item(s) are still pending or rejected', v_blocking_clearance_count;
  END IF;

  -- Block on exit interview: require structured data to be present
  -- Old rows backfilled from exit_feedback are compatible.
  IF NOT (
    v_request.exit_interview_done = true
    AND coalesce(v_request.exit_interview_data, '{}'::jsonb) <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Cannot complete exit: exit interview must be completed before final offboarding';
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
      'warning', CASE
        WHEN v_employee_status = 'terminated'
        THEN 'Employee was already terminated before offboarding completion; exit request was completed for workflow reconciliation.'
        ELSE NULL
      END
    ),
    'success'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_exit_transaction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_exit_transaction(uuid) TO authenticated;
