-- Migration: People Suite Hardening (Conservative Release)
-- This migration introduces the safe public employee directory view, transactional manager updates with cycle detection, and makes offboarding completion idempotent.

-- 1. Create a public view for safe employee directory queries
CREATE OR REPLACE VIEW public.employee_directory_public AS
SELECT
  e.id,
  e.tenant_id,
  e.full_name,
  e.email,
  e.profile_photo_url,
  e.department,
  e.designation,
  e.org_unit_id,
  e.job_title_id,
  e.location_id,
  e.employment_type_id,
  e.work_location,
  e.work_mode,
  e.manager_id,
  e.secondary_manager_id,
  mgr.full_name AS manager_name,
  sec_mgr.full_name AS secondary_manager_name,
  e.grade,
  e.status,
  e.role,
  e.user_id
FROM public.employees e
LEFT JOIN public.employees mgr ON mgr.id = e.manager_id
LEFT JOIN public.employees sec_mgr ON sec_mgr.id = e.secondary_manager_id
WHERE e.tenant_id = public.get_auth_tenant_id();

GRANT SELECT ON public.employee_directory_public TO authenticated;

-- 2. Create the transactional manager update RPC
CREATE OR REPLACE FUNCTION public.update_employee_reporting_relationship(
  p_employee_id uuid,
  p_primary_manager_id uuid,
  p_secondary_manager_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_employee_id uuid;
  v_tenant_id uuid;
  v_old_primary_manager_id uuid;
  v_old_secondary_manager_id uuid;
  v_today date := CURRENT_DATE;
BEGIN
  -- Security check: user must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Security check: user must be HR
  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can update reporting relationships';
  END IF;

  -- Resolve tenant ID and check matching tenant scope
  SELECT tenant_id, manager_id, secondary_manager_id
  INTO v_tenant_id, v_old_primary_manager_id, v_old_secondary_manager_id
  FROM public.employees
  WHERE id = p_employee_id
    AND tenant_id = public.get_auth_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Get active employee ID of the actor (HR specialist)
  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_tenant_id
  LIMIT 1;

  -- Basic self-reports validations:
  IF p_primary_manager_id = p_employee_id THEN
    RAISE EXCEPTION 'An employee cannot be their own primary manager';
  END IF;

  IF p_secondary_manager_id = p_employee_id THEN
    RAISE EXCEPTION 'An employee cannot be their own secondary manager';
  END IF;

  IF p_primary_manager_id IS NOT NULL AND p_secondary_manager_id IS NOT NULL AND p_primary_manager_id = p_secondary_manager_id THEN
    RAISE EXCEPTION 'Primary and secondary managers cannot be the same person';
  END IF;

  -- Verify manager tenants
  IF p_primary_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_primary_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Primary manager must belong to the same tenant';
    END IF;
  END IF;

  IF p_secondary_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_secondary_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Secondary manager must belong to the same tenant';
    END IF;
  END IF;

  -- Cycle check for primary manager
  IF p_primary_manager_id IS NOT NULL THEN
    DECLARE
      current_id uuid := p_primary_manager_id;
      visited uuid[] := ARRAY[p_employee_id];
      mgr_id uuid;
    BEGIN
      WHILE current_id IS NOT NULL LOOP
        IF current_id = p_employee_id THEN
          RAISE EXCEPTION 'Circular reporting line detected for primary manager';
        END IF;

        IF current_id = any(visited) THEN
          EXIT;
        END IF;

        visited := array_append(visited, current_id);

        SELECT manager_id INTO mgr_id
        FROM public.employees
        WHERE id = current_id;

        current_id := mgr_id;
      END LOOP;
    END;
  END IF;

  -- Cycle check for secondary manager
  IF p_secondary_manager_id IS NOT NULL THEN
    DECLARE
      current_id uuid := p_secondary_manager_id;
      visited uuid[] := ARRAY[p_employee_id];
      mgr_id uuid;
    BEGIN
      WHILE current_id IS NOT NULL LOOP
        IF current_id = p_employee_id THEN
          RAISE EXCEPTION 'Circular reporting line detected for secondary manager';
        END IF;

        IF current_id = any(visited) THEN
          EXIT;
        END IF;

        visited := array_append(visited, current_id);

        SELECT manager_id INTO mgr_id
        FROM public.employees
        WHERE id = current_id;

        current_id := mgr_id;
      END LOOP;
    END;
  END IF;

  -- Perform update on employees table
  UPDATE public.employees
  SET manager_id = p_primary_manager_id,
      secondary_manager_id = p_secondary_manager_id,
      updated_at = now()
  WHERE id = p_employee_id;

  -- Sync primary relationships in employee_reporting_relationships
  IF COALESCE(p_primary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(v_old_primary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    IF v_old_primary_manager_id IS NOT NULL THEN
      UPDATE public.employee_reporting_relationships
      SET is_active = false,
          effective_to = v_today,
          updated_at = now()
      WHERE employee_id = p_employee_id
        AND manager_id = v_old_primary_manager_id
        AND relationship_type = 'primary'
        AND is_active = true;
    END IF;

    IF p_primary_manager_id IS NOT NULL THEN
      INSERT INTO public.employee_reporting_relationships (
        tenant_id,
        employee_id,
        manager_id,
        relationship_type,
        effective_from,
        is_active
      )
      VALUES (
        v_tenant_id,
        p_employee_id,
        p_primary_manager_id,
        'primary',
        v_today,
        true
      );
    END IF;

    INSERT INTO public.audit_logs (
      tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
    )
    VALUES (
      v_tenant_id,
      v_actor_employee_id,
      'hr',
      'employee.manager_changed',
      'employees',
      p_employee_id,
      jsonb_build_object(
        'from', v_old_primary_manager_id,
        'to', p_primary_manager_id,
        'relationship_type', 'primary'
      ),
      'success'
    );
  END IF;

  -- Sync secondary relationships in employee_reporting_relationships
  IF COALESCE(p_secondary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(v_old_secondary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    IF v_old_secondary_manager_id IS NOT NULL THEN
      UPDATE public.employee_reporting_relationships
      SET is_active = false,
          effective_to = v_today,
          updated_at = now()
      WHERE employee_id = p_employee_id
        AND manager_id = v_old_secondary_manager_id
        AND relationship_type = 'secondary'
        AND is_active = true;
    END IF;

    IF p_secondary_manager_id IS NOT NULL THEN
      INSERT INTO public.employee_reporting_relationships (
        tenant_id,
        employee_id,
        manager_id,
        relationship_type,
        effective_from,
        is_active
      )
      VALUES (
        v_tenant_id,
        p_employee_id,
        p_secondary_manager_id,
        'secondary',
        v_today,
        true
      );
    END IF;

    INSERT INTO public.audit_logs (
      tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
    )
    VALUES (
      v_tenant_id,
      v_actor_employee_id,
      'hr',
      'employee.manager_changed',
      'employees',
      p_employee_id,
      jsonb_build_object(
        'from', v_old_secondary_manager_id,
        'to', p_secondary_manager_id,
        'relationship_type', 'secondary'
      ),
      'success'
    );
  END IF;

END;
$$;

REVOKE ALL ON FUNCTION public.update_employee_reporting_relationship(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_employee_reporting_relationship(uuid, uuid, uuid) TO authenticated;

-- 3. Update the exit completion function to be idempotent around employee status
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

  IF v_employee_status = 'terminated' THEN
    RAISE EXCEPTION 'Employee has already been terminated';
  ELSIF v_employee_status = 'active' THEN
    UPDATE public.employees
    SET status = 'inactive',
        updated_at = now()
    WHERE id = v_request.employee_id
      AND tenant_id = v_request.tenant_id;
  END IF;
  -- If status is already 'inactive', we proceed silently.

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
      'new_employee_status', 'inactive',
      'employee_already_inactive', (v_employee_status = 'inactive')
    ),
    'success'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_exit_transaction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_exit_transaction(uuid) TO authenticated;
