-- 1. Add idempotency/audit marker for auto red-mark
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS auto_red_marked_at timestamptz;

-- 2. Rewrite punch_out_attendance RPC
CREATE OR REPLACE FUNCTION public.punch_out_attendance(
  p_attendance_id uuid,
  p_tenant_id     uuid,
  p_lat           numeric,
  p_lng           numeric,
  p_acc           numeric,
  p_loc_status    text,
  p_lunch_minutes integer,
  p_overtime_enabled  boolean,
  p_overtime_rate     numeric,
  p_expected_shift_hours numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  v_raw_hours       := EXTRACT(EPOCH FROM (v_now - v_attendance.punch_in)) / 3600.0;
  v_lunch_deduction := CASE WHEN v_raw_hours >= 5 THEN p_lunch_minutes / 60.0 ELSE 0 END;
  v_work_hours      := ROUND(GREATEST(0, v_raw_hours - v_lunch_deduction), 2);

  -- ── 6. WRITE PUNCH-OUT ─────────────────────────────────────────────────────
  UPDATE attendance
  SET punch_out             = v_now,
      work_hours            = v_work_hours,
      session_status        = 'closed',
      punch_out_lat         = p_lat,
      punch_out_lng         = p_lng,
      punch_out_location_accuracy = p_acc,
      punch_out_location_status   = p_loc_status
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
  WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0003' OR SQLSTATE 'P0004' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  SQLERRM,
      'errcode', SQLSTATE
    );
END;
$$;

-- 3. Create auto red-mark function
CREATE OR REPLACE FUNCTION public.fn_auto_redmark_tasks()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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

    -- Read per-tenant EOD redmark time and grace period
    SELECT value INTO v_eod_time_str
    FROM tenant_settings
    WHERE tenant_id = v_tenant.id AND key = 'task_eod_redmark_time';

    SELECT value INTO v_grace_minutes
    FROM tenant_settings
    WHERE tenant_id = v_tenant.id AND key = 'task_grace_period_minutes';

    v_eod_time_str  := COALESCE(v_eod_time_str, '23:30');
    v_grace_minutes := COALESCE(v_grace_minutes::integer, 0);

    -- Construct the cutoff timestamp in tenant timezone for today
    v_cutoff_ts := (date_trunc('day', v_now_in_tz)
                    + v_eod_time_str::interval
                    + (v_grace_minutes || ' minutes')::interval);

    -- Only mark tasks if we are past the cutoff time
    IF v_now_in_tz >= v_cutoff_ts THEN
      UPDATE tasks
      SET status             = 'overdue',
          updated_at         = now(),
          auto_red_marked_at = now()
      WHERE tenant_id = v_tenant.id
        AND status    IN ('assigned', 'submitted', 'rejected')
        AND due_date  <= (v_now_in_tz)::date
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
$$;

-- 4. Register pg_cron (with idempotency wrapper)
-- Try to unschedule first to prevent duplicates if script runs multiple times
DO $$
BEGIN
  PERFORM cron.unschedule('task-auto-redmark');
EXCEPTION WHEN OTHERS THEN
  -- ignore if not found
END $$;

SELECT cron.schedule('task-auto-redmark', '* * * * *', $$SELECT public.fn_auto_redmark_tasks()$$);
