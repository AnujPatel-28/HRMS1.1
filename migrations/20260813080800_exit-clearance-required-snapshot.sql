-- Release 6A: Exit Clearance Required Snapshot
-- Adds is_required boolean to exit_clearances, snapshots from template on seed,
-- and updates complete_exit_transaction to exclude cancelled + optional rows.

-- ─────────────────────────────────────────────────────────────
-- Step 1: Add is_required snapshot column
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.exit_clearances
  ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT true;

-- Backfill: all existing rows are required (safe default)
UPDATE public.exit_clearances
SET is_required = true
WHERE is_required IS DISTINCT FROM true;

-- ─────────────────────────────────────────────────────────────
-- Step 2: Update clearance seeding RPC to snapshot is_required
-- from template at time of seeding (exit_clearance_templates.is_required exists)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_exit_clearance_transaction(
  p_request_id uuid,
  p_department text,
  p_approved boolean,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.exit_requests%ROWTYPE;
  v_updated_request public.exit_requests%ROWTYPE;
  v_actor_employee_id uuid;
  v_department text;
  v_template public.exit_clearance_templates%ROWTYPE;
  v_pending_clearance_count integer;
  v_new_status text;
  v_clearances jsonb;
  v_is_required boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can update exit clearances';
  END IF;

  v_department := lower(trim(p_department));

  IF v_department NOT IN ('assets', 'it', 'finance', 'hr', 'admin') THEN
    RAISE EXCEPTION 'Unsupported clearance department: %', p_department;
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

  IF v_request.status NOT IN ('notice_period', 'clearance_pending') THEN
    RAISE EXCEPTION 'Exit request must be in notice period or clearance pending before clearances can be updated';
  END IF;

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_request.tenant_id
  LIMIT 1;

  SELECT *
  INTO v_template
  FROM public.exit_clearance_templates
  WHERE tenant_id = v_request.tenant_id
    AND department = v_department
  ORDER BY is_active DESC, sort_order ASC, created_at ASC
  LIMIT 1;

  -- Snapshot is_required from template; default true if no template found
  v_is_required := COALESCE(v_template.is_required, true);

  INSERT INTO public.exit_clearances (
    tenant_id,
    exit_request_id,
    template_id,
    department,
    label,
    status,
    approved_by,
    approved_at,
    remarks,
    is_required
  )
  VALUES (
    v_request.tenant_id,
    p_request_id,
    v_template.id,
    v_department,
    COALESCE(v_template.label, initcap(v_department || ' clearance')),
    CASE WHEN p_approved THEN 'approved' ELSE 'pending' END,
    CASE WHEN p_approved THEN v_actor_employee_id ELSE NULL END,
    CASE WHEN p_approved THEN now() ELSE NULL END,
    p_remarks,
    v_is_required
  )
  ON CONFLICT (exit_request_id, department)
  DO UPDATE SET
    status = EXCLUDED.status,
    approved_by = EXCLUDED.approved_by,
    approved_at = EXCLUDED.approved_at,
    remarks = COALESCE(EXCLUDED.remarks, public.exit_clearances.remarks),
    template_id = COALESCE(public.exit_clearances.template_id, EXCLUDED.template_id),
    label = COALESCE(public.exit_clearances.label, EXCLUDED.label),
    -- Preserve existing is_required snapshot; do not overwrite if row already exists
    is_required = COALESCE(public.exit_clearances.is_required, EXCLUDED.is_required),
    updated_at = now();

  UPDATE public.exit_requests
  SET clearance_assets = CASE WHEN v_department = 'assets' THEN p_approved ELSE clearance_assets END,
      clearance_it = CASE WHEN v_department = 'it' THEN p_approved ELSE clearance_it END,
      clearance_finance = CASE WHEN v_department = 'finance' THEN p_approved ELSE clearance_finance END,
      clearance_hr = CASE WHEN v_department = 'hr' THEN p_approved ELSE clearance_hr END,
      clearance_admin = CASE WHEN v_department = 'admin' THEN p_approved ELSE clearance_admin END,
      updated_at = now()
  WHERE id = p_request_id
    AND tenant_id = v_request.tenant_id
  RETURNING * INTO v_updated_request;

  -- Count pending using only required, non-cancelled rows
  SELECT COUNT(*)
  INTO v_pending_clearance_count
  FROM public.exit_clearances
  WHERE exit_request_id = p_request_id
    AND is_required = true
    AND status NOT IN ('approved', 'cancelled');

  IF v_pending_clearance_count = 0 THEN
    v_new_status := 'clearance_pending';
  ELSIF v_updated_request.status = 'clearance_pending' THEN
    v_new_status := 'notice_period';
  ELSE
    v_new_status := v_updated_request.status;
  END IF;

  IF v_new_status <> v_updated_request.status THEN
    UPDATE public.exit_requests
    SET status = v_new_status,
        updated_at = now()
    WHERE id = p_request_id
      AND tenant_id = v_request.tenant_id
    RETURNING * INTO v_updated_request;
  END IF;

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
    'offboarding.clearance_updated',
    'exit_requests',
    p_request_id,
    jsonb_build_object(
      'department', v_department,
      'approved', p_approved,
      'is_required', v_is_required,
      'previous_exit_status', v_request.status,
      'new_exit_status', v_updated_request.status
    ),
    'success'
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(ec) ORDER BY ec.created_at ASC), '[]'::jsonb)
  INTO v_clearances
  FROM public.exit_clearances ec
  WHERE ec.exit_request_id = p_request_id
    AND ec.tenant_id = v_request.tenant_id;

  RETURN jsonb_build_object(
    'exit_request', to_jsonb(v_updated_request),
    'clearances', v_clearances
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_exit_clearance_transaction(uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_exit_clearance_transaction(uuid, text, boolean, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Step 3: Update complete_exit_transaction
-- - Block only on required, non-cancelled clearance rows
-- - Preserve terminated/inactive idempotency from prior release
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

  -- Count only required, non-cancelled, non-approved clearances that block completion.
  -- cancelled = not applicable, skip.
  -- is_required = false = optional, skip.
  -- pending / rejected = blocking.
  SELECT COUNT(*)
  INTO v_blocking_clearance_count
  FROM public.exit_clearances
  WHERE exit_request_id = p_request_id
    AND is_required = true
    AND status NOT IN ('approved', 'cancelled');

  IF v_blocking_clearance_count > 0 THEN
    RAISE EXCEPTION 'Cannot complete exit: % required clearance item(s) are still pending or rejected', v_blocking_clearance_count;
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
