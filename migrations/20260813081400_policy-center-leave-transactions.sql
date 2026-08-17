-- Migration: Policy Center Release P3 - Transactional Leave Policy and Balances RPCs
-- Created: 2026-07-06T21:00:00Z

-- ==========================================
-- Proration Helper Function
-- ==========================================
CREATE OR REPLACE FUNCTION public.compute_initial_leave_balance(
  p_days_per_year numeric,
  p_accrual_type text,
  p_target_year integer,
  p_timezone text
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_year integer;
  v_elapsed_months integer;
BEGIN
  v_current_year := extract(year from timezone(p_timezone, now()))::integer;
  IF p_accrual_type = 'monthly' THEN
    IF p_target_year = v_current_year THEN
      v_elapsed_months := extract(month from timezone(p_timezone, now()))::integer;
      RETURN round(((p_days_per_year / 12.0) * v_elapsed_months), 2);
    ELSIF p_target_year > v_current_year THEN
      RETURN 0.00;
    END IF;
  END IF;
  RETURN p_days_per_year;
END;
$$;

-- ==========================================
-- RPC 1: save_leave_type_transaction
-- ==========================================
CREATE OR REPLACE FUNCTION public.save_leave_type_transaction(
  p_leave_type_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_now timestamptz := now();
  v_old_updated_at timestamptz;
  v_old_days_per_year numeric;
  v_old_accrual_type text;
  v_new_id uuid;
  v_new_updated_at timestamptz;
  
  v_name text;
  v_code text;
  v_days_per_year numeric;
  v_accrual_type text;
  v_carry_forward_enabled boolean;
  v_carry_forward_max_days numeric;
  v_encashment_enabled boolean;
  v_applicable_from_day integer;
  v_probation_restricted boolean;
  v_requires_document boolean;
  v_min_notice_days integer;
  v_max_consecutive_days integer;
  v_is_active boolean;
  v_is_paid boolean;
  
  v_timezone text;
  v_target_year integer;
  v_prorated_balance numeric;
  v_balances_created integer := 0;
  v_balances_updated integer := 0;
  
  v_emp_row record;
  v_bal_row record;
  v_new_balance numeric;
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can save leave types';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Get tenant timezone
  SELECT timezone INTO v_timezone
  FROM public.tenants
  WHERE id = v_auth_tenant_id;

  v_target_year := extract(year from timezone(v_timezone, now()))::integer;

  -- 5. Extract and Validate payload fields
  v_name := trim(p_payload->>'name');
  v_code := upper(trim(p_payload->>'code'));
  v_days_per_year := (p_payload->>'days_per_year')::numeric;
  v_accrual_type := p_payload->>'accrual_type';
  v_carry_forward_enabled := (p_payload->>'carry_forward_enabled')::boolean;
  v_carry_forward_max_days := coalesce((p_payload->>'carry_forward_max_days')::numeric, 0);
  v_encashment_enabled := (p_payload->>'encashment_enabled')::boolean;
  v_applicable_from_day := coalesce((p_payload->>'applicable_from_day')::integer, 0);
  v_probation_restricted := (p_payload->>'probation_restricted')::boolean;
  v_requires_document := (p_payload->>'requires_document')::boolean;
  v_min_notice_days := coalesce((p_payload->>'min_notice_days')::integer, 0);
  v_max_consecutive_days := (p_payload->>'max_consecutive_days')::integer;
  v_is_active := (p_payload->>'is_active')::boolean;
  v_is_paid := (p_payload->>'is_paid')::boolean;

  IF v_name = '' THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Name cannot be empty';
  END IF;

  IF v_code = '' OR length(v_code) > 5 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Code must be non-empty and max 5 characters';
  END IF;

  IF v_days_per_year < 0 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Days per year must be non-negative';
  END IF;

  IF v_accrual_type NOT IN ('lump_sum', 'monthly') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Accrual type must be lump_sum or monthly';
  END IF;

  IF v_applicable_from_day < 0 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Applicable after days must be non-negative';
  END IF;

  IF v_min_notice_days < 0 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Minimum notice days must be non-negative';
  END IF;

  IF v_carry_forward_max_days < 0 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Carry forward max days must be non-negative';
  END IF;

  -- Enforce active duplicate name/code check
  IF v_is_active THEN
    IF EXISTS (
      SELECT 1 FROM public.leave_types
      WHERE tenant_id = v_auth_tenant_id
        AND is_active = true
        AND (lower(name) = lower(v_name) OR lower(code) = lower(v_code))
        AND (p_leave_type_id IS NULL OR id <> p_leave_type_id)
    ) THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: An active leave type with this name or code already exists';
    END IF;
  END IF;

  -- 6. Lock row and check stale versions if editing
  IF p_leave_type_id IS NOT NULL THEN
    SELECT updated_at, days_per_year, accrual_type 
    INTO v_old_updated_at, v_old_days_per_year, v_old_accrual_type
    FROM public.leave_types
    WHERE id = p_leave_type_id AND tenant_id = v_auth_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: Leave type not found';
    END IF;

    IF p_expected_updated_at IS NOT NULL AND v_old_updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'STALE_WRITE: Leave type was modified by another session. Please refresh.';
    END IF;
  END IF;

  -- 7. Insert or Update leave type
  IF p_leave_type_id IS NULL THEN
    INSERT INTO public.leave_types (
      tenant_id, name, code, days_per_year, accrual_type,
      carry_forward_enabled, carry_forward_max_days, encashment_enabled,
      applicable_from_day, probation_restricted, requires_document,
      min_notice_days, max_consecutive_days, is_active, is_paid, sort_order, updated_at
    ) VALUES (
      v_auth_tenant_id,
      v_name,
      v_code,
      v_days_per_year,
      v_accrual_type,
      v_carry_forward_enabled,
      v_carry_forward_max_days,
      v_encashment_enabled,
      v_applicable_from_day,
      v_probation_restricted,
      v_requires_document,
      v_min_notice_days,
      v_max_consecutive_days,
      v_is_active,
      v_is_paid,
      coalesce((SELECT max(sort_order) FROM public.leave_types WHERE tenant_id = v_auth_tenant_id), 0) + 1,
      v_now
    ) RETURNING id, updated_at INTO v_new_id, v_new_updated_at;

    -- If creating an active leave type, auto-initialize balances
    IF v_is_active THEN
      v_prorated_balance := public.compute_initial_leave_balance(v_days_per_year, v_accrual_type, v_target_year, v_timezone);
      
      FOR v_emp_row IN 
        SELECT id FROM public.employees 
        WHERE tenant_id = v_auth_tenant_id AND status = 'active'
      LOOP
        INSERT INTO public.leave_balances (
          tenant_id, employee_id, leave_type_id, year,
          total_allocated, carried_forward, used_days, pending_days, balance, updated_at
        ) VALUES (
          v_auth_tenant_id,
          v_emp_row.id,
          v_new_id,
          v_target_year,
          v_days_per_year,
          0.00,
          0.00,
          0.00,
          v_prorated_balance,
          v_now
        ) ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO NOTHING;
        
        IF FOUND THEN
          v_balances_created := v_balances_created + 1;
        END IF;
      END LOOP;
    END IF;

    -- Write Audit Log
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
    VALUES (
      v_auth_tenant_id,
      v_actor_id,
      'hr',
      'leave_type.created',
      'leave_type',
      v_new_id,
      jsonb_build_object('name', v_name),
      'success'
    );

  ELSE
    UPDATE public.leave_types
    SET
      name = v_name,
      code = v_code,
      days_per_year = v_days_per_year,
      accrual_type = v_accrual_type,
      carry_forward_enabled = v_carry_forward_enabled,
      carry_forward_max_days = v_carry_forward_max_days,
      encashment_enabled = v_encashment_enabled,
      applicable_from_day = v_applicable_from_day,
      probation_restricted = v_probation_restricted,
      requires_document = v_requires_document,
      min_notice_days = v_min_notice_days,
      max_consecutive_days = v_max_consecutive_days,
      is_active = v_is_active,
      is_paid = v_is_paid,
      updated_at = v_now
    WHERE id = p_leave_type_id AND tenant_id = v_auth_tenant_id
    RETURNING id, updated_at INTO v_new_id, v_new_updated_at;

    -- If editing days_per_year or accrual_type, recalculate current year balances
    IF v_old_days_per_year IS DISTINCT FROM v_days_per_year OR v_old_accrual_type IS DISTINCT FROM v_accrual_type THEN
      v_prorated_balance := public.compute_initial_leave_balance(v_days_per_year, v_accrual_type, v_target_year, v_timezone);
      
      FOR v_bal_row IN
        SELECT id, used_days, pending_days, carried_forward
        FROM public.leave_balances
        WHERE tenant_id = v_auth_tenant_id
          AND leave_type_id = p_leave_type_id
          AND year = v_target_year
      LOOP
        v_new_balance := greatest(0.00, round((v_prorated_balance - coalesce(v_bal_row.used_days, 0) - coalesce(v_bal_row.pending_days, 0) + coalesce(v_bal_row.carried_forward, 0)), 2));
        
        UPDATE public.leave_balances
        SET
          total_allocated = v_days_per_year,
          balance = v_new_balance,
          updated_at = v_now
        WHERE id = v_bal_row.id;
        
        v_balances_updated := v_balances_updated + 1;
      END LOOP;
    END IF;

    -- Write Audit Log
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
    VALUES (
      v_auth_tenant_id,
      v_actor_id,
      'hr',
      'leave_type.updated',
      'leave_type',
      p_leave_type_id,
      jsonb_build_object('name', v_name),
      'success'
    );
  END IF;

  RETURN jsonb_build_object(
    'leave_type_id', v_new_id,
    'updated_at', v_new_updated_at,
    'balances_created', v_balances_created,
    'balances_updated', v_balances_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_leave_type_transaction(uuid, timestamptz, jsonb) TO authenticated;

-- ==========================================
-- RPC 2: initialize_leave_balances_transaction
-- ==========================================
CREATE OR REPLACE FUNCTION public.initialize_leave_balances_transaction(
  p_year integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_now timestamptz := now();
  v_timezone text;
  v_balances_created integer := 0;
  
  v_emp_row record;
  v_lt_row record;
  v_prorated_balance numeric;
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can initialize leave balances';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Get tenant timezone
  SELECT timezone INTO v_timezone
  FROM public.tenants
  WHERE id = v_auth_tenant_id;

  -- 5. Seed missing combinations
  FOR v_lt_row IN
    SELECT id, days_per_year, accrual_type
    FROM public.leave_types
    WHERE tenant_id = v_auth_tenant_id AND is_active = true
  LOOP
    v_prorated_balance := public.compute_initial_leave_balance(v_lt_row.days_per_year, v_lt_row.accrual_type, p_year, v_timezone);
    
    FOR v_emp_row IN
      SELECT id FROM public.employees
      WHERE tenant_id = v_auth_tenant_id AND status = 'active'
    LOOP
      -- Check if balance already exists
      IF NOT EXISTS (
        SELECT 1 FROM public.leave_balances
        WHERE tenant_id = v_auth_tenant_id
          AND employee_id = v_emp_row.id
          AND leave_type_id = v_lt_row.id
          AND year = p_year
      ) THEN
        INSERT INTO public.leave_balances (
          tenant_id, employee_id, leave_type_id, year,
          total_allocated, carried_forward, used_days, pending_days, balance, updated_at
        ) VALUES (
          v_auth_tenant_id,
          v_emp_row.id,
          v_lt_row.id,
          p_year,
          v_lt_row.days_per_year,
          0.00,
          0.00,
          0.00,
          v_prorated_balance,
          v_now
        );
        v_balances_created := v_balances_created + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- Write Audit Log
  INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
  VALUES (
    v_auth_tenant_id,
    v_actor_id,
    'hr',
    'leave_balances.initialized',
    'tenant',
    v_auth_tenant_id,
    jsonb_build_object('year', p_year, 'balances_created', v_balances_created),
    'success'
  );

  RETURN jsonb_build_object(
    'balances_created', v_balances_created
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.initialize_leave_balances_transaction(integer) TO authenticated;

-- ==========================================
-- RPC 3: deactivate_leave_type_transaction
-- ==========================================
CREATE OR REPLACE FUNCTION public.deactivate_leave_type_transaction(
  p_leave_type_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_now timestamptz := now();
  v_existing_updated_at timestamptz;
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can deactivate leave types';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Lock row and stale check
  SELECT updated_at INTO v_existing_updated_at
  FROM public.leave_types
  WHERE id = p_leave_type_id AND tenant_id = v_auth_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Leave type not found';
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_existing_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_WRITE: Leave type was modified by another session. Please refresh.';
  END IF;

  -- 5. Update leave type
  UPDATE public.leave_types
  SET is_active = false,
      updated_at = v_now
  WHERE id = p_leave_type_id AND tenant_id = v_auth_tenant_id;

  -- Write Audit Log
  INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
  VALUES (
    v_auth_tenant_id,
    v_actor_id,
    'hr',
    'leave_type.deactivated',
    'leave_type',
    p_leave_type_id,
    jsonb_build_object('id', p_leave_type_id),
    'success'
  );

  RETURN jsonb_build_object(
    'leave_type_id', p_leave_type_id,
    'updated_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_leave_type_transaction(uuid, timestamptz) TO authenticated;
