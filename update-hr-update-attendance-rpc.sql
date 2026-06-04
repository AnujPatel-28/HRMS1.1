-- Update hr_update_attendance to explicitly set session_status = 'closed'
-- when the status is 'absent' or 'on_leave', or if punch_in is NULL.
-- This avoids unique constraint violations or check constraint violations
-- (attendance_open_session_check) when inserting/updating attendance records
-- with no punch_in times.

CREATE OR REPLACE FUNCTION public.hr_update_attendance(
  p_tenant_id uuid,
  p_attendance_id uuid,
  p_employee_id uuid,
  p_date date,
  p_punch_in time,
  p_punch_out time,
  p_status text,
  p_is_late boolean DEFAULT NULL,
  p_expected_status text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
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
$$;
