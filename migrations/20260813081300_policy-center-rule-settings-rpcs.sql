-- Migration: Policy Center Release P2 - Transactional Attendance and Task Rule Settings RPCs
-- Created: 2026-07-06T20:00:00Z
-- Creates save_attendance_policy_transaction and save_task_policy_transaction RPCs.
-- These replace the multi-step client writes in PolicyCenter.tsx with atomic DB transactions.

-- ==========================================
-- RPC 1: save_attendance_policy_transaction
-- ==========================================
CREATE OR REPLACE FUNCTION public.save_attendance_policy_transaction(
  p_tenant_id uuid,
  p_expected_tenant_updated_at timestamptz,
  p_expected_setting_versions jsonb,
  p_policy jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_tenant_updated_at timestamptz;
  v_new_tenant_updated_at timestamptz;
  v_now timestamptz := now();
  v_setting_versions jsonb := '{}'::jsonb;
  v_setting_key text;
  v_setting_existing_updated_at timestamptz;
  v_geofence_enabled boolean;
  v_office_lat text;
  v_office_lng text;
  v_geofence_radius text;
  v_geofence_mode text;

  -- Attendance settings keys to upsert
  v_attendance_setting_keys text[] := ARRAY[
    'late_mark_enabled',
    'late_mark_grace_minutes',
    'late_mark_threshold',
    'late_mark_deduction_hours',
    'overtime_enabled',
    'overtime_rate',
    'geofence_enabled',
    'office_lat',
    'office_lng',
    'geofence_radius_meters',
    'geofence_mode',
    'regularization_enabled',
    'regularization_window_days',
    'payroll_lock_date',
    'break_tracking_enabled',
    'break_deduction_mode',
    'short_break_limit_minutes',
    'remote_work_handling',
    'gps_verification_mode',
    'attendance_selfie_mode',
    'selfie_retention_days',
    'high_confidence_max',
    'medium_confidence_max',
    'low_confidence_max'
  ];
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can update attendance policy';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL OR v_auth_tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope mismatch';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Lock tenant row and check for stale write
  SELECT t.updated_at INTO v_tenant_updated_at
  FROM public.tenants t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Tenant not found';
  END IF;

  IF p_expected_tenant_updated_at IS NOT NULL
     AND v_tenant_updated_at IS DISTINCT FROM p_expected_tenant_updated_at THEN
    RAISE EXCEPTION 'STALE_WRITE: Tenant was modified by another session. Please refresh.';
  END IF;

  -- 5. Validate required settings values
  v_geofence_enabled := (p_policy->>'geofence_enabled')::boolean;
  v_office_lat := coalesce(p_policy->>'office_lat', '');
  v_office_lng := coalesce(p_policy->>'office_lng', '');
  v_geofence_radius := coalesce(p_policy->>'geofence_radius_meters', '500');
  v_geofence_mode := coalesce(p_policy->>'geofence_mode', 'warn');

  IF v_geofence_enabled THEN
    IF trim(v_office_lat) = '' OR trim(v_office_lng) = '' THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: Geofence is enabled but office lat/lng are missing';
    END IF;
    BEGIN
      PERFORM v_office_lat::numeric;
      PERFORM v_office_lng::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: office_lat and office_lng must be valid numbers';
    END;
  END IF;

  IF v_geofence_mode NOT IN ('warn', 'strict') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: geofence_mode must be warn or strict';
  END IF;

  -- Validate enum: remote_work_handling
  IF coalesce(p_policy->>'remote_work_handling', 'hr_approved_exceptions')
     NOT IN ('disabled', 'hr_approved_exceptions', 'always_allowed') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: remote_work_handling has invalid value';
  END IF;

  -- Validate enum: gps_verification_mode
  IF coalesce(p_policy->>'gps_verification_mode', 'warn')
     NOT IN ('disabled', 'warn', 'strict') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: gps_verification_mode has invalid value';
  END IF;

  -- Validate enum: attendance_selfie_mode
  IF coalesce(p_policy->>'attendance_selfie_mode', 'disabled')
     NOT IN ('disabled', 'punch_in', 'punch_out', 'both') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: attendance_selfie_mode has invalid value';
  END IF;

  -- Validate enum: break_deduction_mode
  IF coalesce(p_policy->>'break_deduction_mode', 'fixed')
     NOT IN ('fixed', 'actual') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: break_deduction_mode has invalid value';
  END IF;

  -- 6. Check stale setting versions provided by client
  IF p_expected_setting_versions IS NOT NULL THEN
    FOR v_setting_key IN SELECT jsonb_object_keys(p_expected_setting_versions)
    LOOP
      SELECT ts.updated_at INTO v_setting_existing_updated_at
      FROM public.tenant_settings ts
      WHERE ts.tenant_id = p_tenant_id
        AND ts.key = v_setting_key;

      IF FOUND AND v_setting_existing_updated_at IS DISTINCT FROM
         (p_expected_setting_versions->>v_setting_key)::timestamptz THEN
        RAISE EXCEPTION 'STALE_WRITE: Setting "%" was modified by another session. Please refresh.', v_setting_key;
      END IF;
    END LOOP;
  END IF;

  -- 7. Update tenant row (punch times, work hours)
  UPDATE public.tenants
  SET
    punch_in_start = coalesce(p_policy->>'punch_in_start', punch_in_start::text)::time,
    punch_in_cutoff = coalesce(p_policy->>'punch_in_cutoff', punch_in_cutoff::text)::time,
    work_hours_per_day = coalesce((p_policy->>'work_hours_per_day')::numeric, work_hours_per_day),
    lunch_break_minutes = coalesce((p_policy->>'lunch_break_minutes')::integer, lunch_break_minutes),
    updated_at = v_now
  WHERE id = p_tenant_id
  RETURNING updated_at INTO v_new_tenant_updated_at;

  -- 8. Upsert all attendance setting keys
  FOR v_setting_key IN SELECT unnest(v_attendance_setting_keys)
  LOOP
    INSERT INTO public.tenant_settings (tenant_id, key, value, updated_at)
    VALUES (
      p_tenant_id,
      v_setting_key,
      coalesce(p_policy->>v_setting_key, ''),
      v_now
    )
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at;

    v_setting_versions := jsonb_set(
      v_setting_versions,
      ARRAY[v_setting_key],
      to_jsonb(v_now::text)
    );
  END LOOP;

  -- 9. Write audit log
  INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
  VALUES (
    p_tenant_id,
    v_actor_id,
    'hr',
    'settings.updated',
    'tenant',
    p_tenant_id,
    jsonb_build_object('section', 'attendance-policy'),
    'success'
  );

  -- 10. Return updated version tokens
  RETURN jsonb_build_object(
    'tenant_updated_at', v_new_tenant_updated_at,
    'setting_versions', v_setting_versions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_attendance_policy_transaction(uuid, timestamptz, jsonb, jsonb) TO authenticated;

-- ==========================================
-- RPC 2: save_task_policy_transaction
-- ==========================================
CREATE OR REPLACE FUNCTION public.save_task_policy_transaction(
  p_tenant_id uuid,
  p_expected_tenant_updated_at timestamptz,
  p_expected_setting_versions jsonb,
  p_policy jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_tenant_updated_at timestamptz;
  v_new_tenant_updated_at timestamptz;
  v_now timestamptz := now();
  v_setting_versions jsonb := '{}'::jsonb;
  v_setting_key text;
  v_setting_existing_updated_at timestamptz;
  v_eod_time text;
  v_grace_minutes text;

  v_task_setting_keys text[] := ARRAY[
    'task_eod_redmark_time',
    'task_grace_period_minutes'
  ];
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can update task policy';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL OR v_auth_tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope mismatch';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Lock tenant row and stale-write check
  SELECT t.updated_at INTO v_tenant_updated_at
  FROM public.tenants t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Tenant not found';
  END IF;

  IF p_expected_tenant_updated_at IS NOT NULL
     AND v_tenant_updated_at IS DISTINCT FROM p_expected_tenant_updated_at THEN
    RAISE EXCEPTION 'STALE_WRITE: Tenant was modified by another session. Please refresh.';
  END IF;

  -- 5. Validate task settings values
  v_eod_time := coalesce(p_policy->>'task_eod_redmark_time', '23:30');
  v_grace_minutes := coalesce(p_policy->>'task_grace_period_minutes', '0');

  -- Validate time format HH:MM
  IF v_eod_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: task_eod_redmark_time must be in HH:MM format';
  END IF;

  -- Validate grace minutes is a non-negative integer
  BEGIN
    IF v_grace_minutes::integer < 0 THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: task_grace_period_minutes must be non-negative';
    END IF;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: task_grace_period_minutes must be a valid integer';
  END;

  -- 6. Check stale setting versions
  IF p_expected_setting_versions IS NOT NULL THEN
    FOR v_setting_key IN SELECT jsonb_object_keys(p_expected_setting_versions)
    LOOP
      SELECT ts.updated_at INTO v_setting_existing_updated_at
      FROM public.tenant_settings ts
      WHERE ts.tenant_id = p_tenant_id
        AND ts.key = v_setting_key;

      IF FOUND AND v_setting_existing_updated_at IS DISTINCT FROM
         (p_expected_setting_versions->>v_setting_key)::timestamptz THEN
        RAISE EXCEPTION 'STALE_WRITE: Setting "%" was modified by another session. Please refresh.', v_setting_key;
      END IF;
    END LOOP;
  END IF;

  -- 7. Update tenants.punch_out_gate_enabled atomically
  UPDATE public.tenants
  SET
    punch_out_gate_enabled = coalesce((p_policy->>'punch_out_gate_enabled')::boolean, punch_out_gate_enabled),
    updated_at = v_now
  WHERE id = p_tenant_id
  RETURNING updated_at INTO v_new_tenant_updated_at;

  -- 8. Upsert task settings
  FOR v_setting_key IN SELECT unnest(v_task_setting_keys)
  LOOP
    INSERT INTO public.tenant_settings (tenant_id, key, value, updated_at)
    VALUES (
      p_tenant_id,
      v_setting_key,
      coalesce(p_policy->>v_setting_key, ''),
      v_now
    )
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at;

    v_setting_versions := jsonb_set(
      v_setting_versions,
      ARRAY[v_setting_key],
      to_jsonb(v_now::text)
    );
  END LOOP;

  -- 9. Write audit log
  INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
  VALUES (
    p_tenant_id,
    v_actor_id,
    'hr',
    'settings.updated',
    'tenant',
    p_tenant_id,
    jsonb_build_object('section', 'task-policy'),
    'success'
  );

  -- 10. Return updated version tokens
  RETURN jsonb_build_object(
    'tenant_updated_at', v_new_tenant_updated_at,
    'setting_versions', v_setting_versions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_task_policy_transaction(uuid, timestamptz, jsonb, jsonb) TO authenticated;
