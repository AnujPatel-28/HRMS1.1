-- Atomic HR workflow hardening.
-- This migration adds transaction-safe RPCs for workflows that were previously
-- split across multiple frontend writes. It is intentionally additive so the
-- application can be rolled back by reverting the frontend changes.

CREATE OR REPLACE FUNCTION public.is_hr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = (SELECT auth.uid())
      AND u.metadata->>'role' = 'hr'
      AND NULLIF(u.metadata->>'tenant_id', '')::uuid = (SELECT public.get_auth_tenant_id())
  );
$$;

CREATE OR REPLACE FUNCTION public.get_auth_employee_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT e.id
  FROM public.employees e
  WHERE e.user_id = (SELECT auth.uid())
    AND e.tenant_id = p_tenant_id
    AND e.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.assert_hr_for_tenant(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  SELECT id INTO v_employee_id
  FROM employees
  WHERE user_id = auth.uid()
    AND tenant_id = p_tenant_id
    AND status = 'active';

  IF v_employee_id IS NULL OR NOT is_hr() THEN
    RAISE EXCEPTION 'HR privileges required';
  END IF;

  RETURN v_employee_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_date_range_unlocked(
  p_tenant_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_payroll_lock_date date;
BEGIN
  SELECT NULLIF(value, '')::date INTO v_payroll_lock_date
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'payroll_lock_date';

  IF v_payroll_lock_date IS NOT NULL AND p_start_date <= v_payroll_lock_date THEN
    RAISE EXCEPTION 'Payroll is locked for this date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payroll_runs
    WHERE tenant_id = p_tenant_id
      AND status IN ('approved', 'paid')
      AND make_date(year, month, 1) <= date_trunc('month', p_end_date)::date
      AND (make_date(year, month, 1) + interval '1 month - 1 day')::date >= date_trunc('month', p_start_date)::date
  ) THEN
    RAISE EXCEPTION 'Payroll run is already approved or paid for this period';
  END IF;
EXCEPTION WHEN undefined_table THEN
  IF v_payroll_lock_date IS NOT NULL AND p_start_date <= v_payroll_lock_date THEN
    RAISE EXCEPTION 'Payroll is locked for this date';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_employee_shifts_effective_from'
  ) THEN
    IF EXISTS (
    SELECT 1
    FROM public.employee_shifts
    GROUP BY tenant_id, employee_id, effective_from
    HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Cannot create uq_employee_shifts_effective_from: duplicate employee shift effective dates exist';
    END IF;

    CREATE UNIQUE INDEX uq_employee_shifts_effective_from
    ON public.employee_shifts(tenant_id, employee_id, effective_from);
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_overtime_attendance'
  ) THEN
    IF EXISTS (
    SELECT 1
    FROM public.overtime_records
    WHERE attendance_id IS NOT NULL
    GROUP BY tenant_id, attendance_id
    HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Cannot create uq_overtime_attendance: duplicate overtime records exist for an attendance row';
    END IF;

    CREATE UNIQUE INDEX uq_overtime_attendance
    ON public.overtime_records(tenant_id, attendance_id)
    WHERE attendance_id IS NOT NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_pending_attendance_correction'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM public.attendance_corrections
      WHERE status = 'pending'
      GROUP BY tenant_id, employee_id, attendance_date
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Cannot create uq_pending_attendance_correction: duplicate pending correction requests exist';
    END IF;

    CREATE UNIQUE INDEX uq_pending_attendance_correction
    ON public.attendance_corrections(tenant_id, employee_id, attendance_date)
    WHERE status = 'pending';
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.hr_save_shift(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_name text,
  p_start_time time,
  p_end_time time,
  p_working_days integer[],
  p_half_day_cutoff_override time,
  p_punch_in_opens_minutes_before integer,
  p_late_mark_grace_override integer,
  p_is_default boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_hr_employee_id uuid;
  v_shift_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Shift name is required';
  END IF;

  IF p_working_days IS NULL OR array_length(p_working_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one working day';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_working_days) AS day_value WHERE day_value < 0 OR day_value > 6) THEN
    RAISE EXCEPTION 'Working days must be between 0 and 6';
  END IF;

  PERFORM 1 FROM shifts WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF p_is_default THEN
    UPDATE shifts
    SET is_default = false,
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND is_default = true
      AND (p_shift_id IS NULL OR id <> p_shift_id);
  END IF;

  IF p_shift_id IS NULL THEN
    INSERT INTO shifts (
      tenant_id, name, start_time, end_time, working_days,
      half_day_cutoff_override, punch_in_opens_minutes_before,
      late_mark_grace_override, is_default, is_active, created_at, updated_at
    )
    VALUES (
      p_tenant_id, trim(p_name), p_start_time, p_end_time, p_working_days,
      p_half_day_cutoff_override, COALESCE(p_punch_in_opens_minutes_before, 60),
      p_late_mark_grace_override, COALESCE(p_is_default, false), true, now(), now()
    )
    RETURNING id INTO v_shift_id;
  ELSE
    UPDATE shifts
    SET name = trim(p_name),
        start_time = p_start_time,
        end_time = p_end_time,
        working_days = p_working_days,
        half_day_cutoff_override = p_half_day_cutoff_override,
        punch_in_opens_minutes_before = COALESCE(p_punch_in_opens_minutes_before, 60),
        late_mark_grace_override = p_late_mark_grace_override,
        is_default = COALESCE(p_is_default, false),
        is_active = true,
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND id = p_shift_id
    RETURNING id INTO v_shift_id;

    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'Shift not found';
    END IF;
  END IF;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.saved', 'shifts', v_shift_id,
    jsonb_build_object('name', trim(p_name), 'is_default', COALESCE(p_is_default, false), 'correlation_id', v_correlation_id)
  );

  RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_deactivate_shift(
  p_tenant_id uuid,
  p_shift_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_hr_employee_id uuid;
  v_shift shifts%ROWTYPE;
  v_other_default_count integer;
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  SELECT * INTO v_shift
  FROM shifts
  WHERE tenant_id = p_tenant_id
    AND id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  IF v_shift.is_default THEN
    SELECT count(*) INTO v_other_default_count
    FROM shifts
    WHERE tenant_id = p_tenant_id
      AND id <> p_shift_id
      AND is_default = true
      AND is_active IS NOT FALSE;

    IF v_other_default_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the only default shift. Set another shift as default first.';
    END IF;
  END IF;

  UPDATE shifts
  SET is_active = false,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND id = p_shift_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.deactivated', 'shifts', p_shift_id,
    jsonb_build_object('shift_name', v_shift.name, 'was_default', v_shift.is_default)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_schedule_shift_change(
  p_tenant_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_effective_from date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_hr_employee_id uuid;
  v_effective_from date := COALESCE(p_effective_from, CURRENT_DATE + 1);
  v_effective_to date;
  v_assignment_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);
  v_effective_to := v_effective_from - 1;

  IF v_effective_from <= CURRENT_DATE THEN
    RAISE EXCEPTION 'Shift changes must be effective in the future';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = p_employee_id
      AND tenant_id = p_tenant_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Employee not found or inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shifts
    WHERE id = p_shift_id
      AND tenant_id = p_tenant_id
      AND is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'Shift not found or inactive';
  END IF;

  PERFORM 1
  FROM employee_shifts
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from <= v_effective_to
    AND (effective_to IS NULL OR effective_to >= v_effective_to)
  FOR UPDATE;

  UPDATE employee_shifts
  SET effective_to = v_effective_to
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from <= v_effective_to
    AND (effective_to IS NULL OR effective_to >= v_effective_to);

  DELETE FROM employee_shifts
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from = v_effective_from;

  INSERT INTO employee_shifts (tenant_id, employee_id, shift_id, effective_from)
  VALUES (p_tenant_id, p_employee_id, p_shift_id, v_effective_from)
  RETURNING id INTO v_assignment_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.assignment', 'employee_shifts', v_assignment_id,
    jsonb_build_object('employee_id', p_employee_id, 'shift_id', p_shift_id, 'effective_from', v_effective_from, 'correlation_id', v_correlation_id)
  );

  RETURN v_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_set_overtime_status(
  p_tenant_id uuid,
  p_overtime_id uuid,
  p_approved boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_hr_employee_id uuid;
  v_record overtime_records%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  SELECT * INTO v_record
  FROM overtime_records
  WHERE tenant_id = p_tenant_id
    AND id = p_overtime_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overtime record not found';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_record.date, v_record.date);

  IF p_approved THEN
    UPDATE overtime_records
    SET approved = true,
        approved_by = v_hr_employee_id
    WHERE id = p_overtime_id;
  ELSE
    DELETE FROM overtime_records
    WHERE id = p_overtime_id;
  END IF;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr',
    CASE WHEN p_approved THEN 'overtime.approved' ELSE 'overtime.rejected' END,
    'overtime_records', p_overtime_id,
    jsonb_build_object('employee_id', v_record.employee_id, 'date', v_record.date, 'hours', v_record.overtime_hours, 'correlation_id', v_correlation_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_create_remote_exception(
  p_tenant_id uuid,
  p_employee_id uuid,
  p_exception_type text,
  p_start_date date,
  p_end_date date,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_hr_employee_id uuid;
  v_exception_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, p_start_date, p_end_date);

  IF p_exception_type NOT IN ('work_from_home', 'client_visit', 'business_travel', 'field_work', 'other') THEN
    RAISE EXCEPTION 'Invalid exception type';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = p_employee_id
      AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM attendance_location_exceptions
    WHERE tenant_id = p_tenant_id
      AND employee_id = p_employee_id
      AND status = 'approved'
      AND start_date <= p_end_date
      AND end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'An approved remote exception already exists for this employee within the selected date range';
  END IF;

  INSERT INTO attendance_location_exceptions (
    tenant_id, employee_id, exception_type, start_date, end_date,
    reason, status, requested_by, approved_by, approved_at
  )
  VALUES (
    p_tenant_id, p_employee_id, p_exception_type, p_start_date, p_end_date,
    trim(p_reason), 'approved', v_hr_employee_id, v_hr_employee_id, now()
  )
  RETURNING id INTO v_exception_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'attendance.remote_exception_created',
    'attendance_location_exceptions', v_exception_id,
    jsonb_build_object('employee_id', p_employee_id, 'start_date', p_start_date, 'end_date', p_end_date, 'type', p_exception_type, 'correlation_id', v_correlation_id)
  );

  RETURN v_exception_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_approve_attendance_correction(
  p_tenant_id uuid,
  p_correction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_hr_employee_id uuid;
  v_correction attendance_corrections%ROWTYPE;
  v_attendance attendance%ROWTYPE;
  v_tenant tenants%ROWTYPE;
  v_shift_start time;
  v_effective_in time;
  v_effective_out time;
  v_punch_in timestamptz;
  v_punch_out timestamptz;
  v_raw_hours numeric;
  v_work_hours numeric;
  v_lunch_minutes integer;
  v_grace_minutes integer;
  v_is_late boolean;
  v_before jsonb;
  v_after jsonb;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  SELECT * INTO v_correction
  FROM attendance_corrections
  WHERE tenant_id = p_tenant_id
    AND id = p_correction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction request not found';
  END IF;

  IF v_correction.status <> 'pending' THEN
    RAISE EXCEPTION 'Correction request is already %', v_correction.status;
  END IF;

  IF v_correction.requested_punch_in IS NULL AND v_correction.requested_punch_out IS NULL THEN
    RAISE EXCEPTION 'Cannot approve a correction with no requested punch times';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_correction.attendance_date, v_correction.attendance_date);

  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  v_lunch_minutes := COALESCE(v_tenant.lunch_break_minutes, 0);

  SELECT COALESCE(NULLIF(value, '')::integer, 0) INTO v_grace_minutes
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'late_mark_grace_minutes';
  v_grace_minutes := COALESCE(v_grace_minutes, 0);

  SELECT a.* INTO v_attendance
  FROM attendance a
  WHERE a.tenant_id = p_tenant_id
    AND a.employee_id = v_correction.employee_id
    AND a.date = v_correction.attendance_date
  FOR UPDATE;

  v_before := CASE WHEN v_attendance.id IS NULL THEN NULL ELSE to_jsonb(v_attendance) END;

  SELECT s.start_time INTO v_shift_start
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = p_tenant_id
    AND es.employee_id = v_correction.employee_id
    AND es.effective_from <= v_correction.attendance_date
    AND (es.effective_to IS NULL OR es.effective_to >= v_correction.attendance_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_shift_start IS NULL THEN
    SELECT s.start_time INTO v_shift_start
    FROM shifts s
    WHERE s.tenant_id = p_tenant_id
      AND s.is_default = true
      AND s.is_active IS NOT FALSE
    LIMIT 1;
  END IF;
  v_shift_start := COALESCE(v_shift_start, COALESCE(v_tenant.punch_in_start, '09:00')::time);

  v_effective_in := COALESCE(v_correction.requested_punch_in::time, (v_attendance.punch_in AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC'))::time);
  v_effective_out := COALESCE(v_correction.requested_punch_out::time, (v_attendance.punch_out AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC'))::time);

  IF v_effective_in IS NOT NULL THEN
    v_punch_in := (v_correction.attendance_date + v_effective_in)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
  END IF;

  IF v_effective_out IS NOT NULL THEN
    v_punch_out := (v_correction.attendance_date + v_effective_out)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
    IF v_effective_in IS NOT NULL AND v_effective_out < v_effective_in THEN
      v_punch_out := ((v_correction.attendance_date + 1) + v_effective_out)::timestamp AT TIME ZONE COALESCE(v_tenant.timezone, 'UTC');
    END IF;
  END IF;

  IF v_punch_in IS NOT NULL AND v_punch_out IS NOT NULL THEN
    v_raw_hours := EXTRACT(EPOCH FROM (v_punch_out - v_punch_in)) / 3600.0;
    IF v_raw_hours > 18 THEN
      RAISE EXCEPTION 'Shift duration exceeds maximum limit of 18 hours';
    END IF;
    v_work_hours := ROUND(GREATEST(0, v_raw_hours - CASE WHEN v_raw_hours >= 5 THEN v_lunch_minutes / 60.0 ELSE 0 END), 2);
  END IF;

  v_is_late := CASE
    WHEN COALESCE(v_attendance.status, 'present') IN ('half_day', 'absent') THEN false
    WHEN v_effective_in IS NULL THEN COALESCE(v_attendance.is_late, false)
    ELSE v_effective_in > (v_shift_start + (v_grace_minutes || ' minutes')::interval)
  END;

  UPDATE attendance_corrections
  SET status = 'approved',
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      rejection_reason = NULL
  WHERE id = p_correction_id;

  IF v_attendance.id IS NULL THEN
    INSERT INTO attendance (
      tenant_id, employee_id, date, punch_in, punch_out, work_hours,
      is_late, status, punch_out_allowed, session_status
    )
    VALUES (
      p_tenant_id, v_correction.employee_id, v_correction.attendance_date,
      v_punch_in, v_punch_out, v_work_hours, v_is_late, 'present', true,
      CASE WHEN v_punch_out IS NULL THEN 'open' ELSE 'closed' END
    )
    RETURNING * INTO v_attendance;
  ELSE
    UPDATE attendance
    SET punch_in = COALESCE(v_punch_in, punch_in),
        punch_out = COALESCE(v_punch_out, punch_out),
        work_hours = COALESCE(v_work_hours, work_hours),
        is_late = v_is_late,
        session_status = CASE WHEN COALESCE(v_punch_out, punch_out) IS NULL THEN session_status ELSE 'closed' END
    WHERE id = v_attendance.id
    RETURNING * INTO v_attendance;
  END IF;

  v_after := to_jsonb(v_attendance);

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'attendance_correction.approved',
    'attendance_corrections', p_correction_id,
    jsonb_build_object(
      'employee_id', v_correction.employee_id,
      'attendance_date', v_correction.attendance_date,
      'before', v_before,
      'after', v_after,
      'reason', v_correction.reason,
      'severity', 'CRITICAL',
      'correlation_id', v_correlation_id
    )
  );

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      p_tenant_id,
      v_correction.employee_id,
      'Attendance Correction Approved',
      'Your attendance correction for ' || v_correction.attendance_date::text || ' has been approved and updated.',
      'general',
      p_correction_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'attendance_id', v_attendance.id,
    'employee_id', v_correction.employee_id,
    'attendance_date', v_correction.attendance_date,
    'work_hours', v_attendance.work_hours
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_reject_attendance_correction(
  p_tenant_id uuid,
  p_correction_id uuid,
  p_rejection_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_hr_employee_id uuid;
  v_correction attendance_corrections%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_rejection_reason IS NULL OR length(trim(p_rejection_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_correction
  FROM attendance_corrections
  WHERE tenant_id = p_tenant_id
    AND id = p_correction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction request not found';
  END IF;

  IF v_correction.status <> 'pending' THEN
    RAISE EXCEPTION 'Correction request is already %', v_correction.status;
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_correction.attendance_date, v_correction.attendance_date);

  UPDATE attendance_corrections
  SET status = 'rejected',
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      rejection_reason = trim(p_rejection_reason)
  WHERE id = p_correction_id;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      p_tenant_id,
      v_correction.employee_id,
      'Attendance Correction Rejected',
      'Your correction request for ' || v_correction.attendance_date::text || ' was rejected. Reason: ' || trim(p_rejection_reason),
      'general',
      p_correction_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'correction.rejected',
    'attendance_corrections', p_correction_id,
    jsonb_build_object('employee_id', v_correction.employee_id, 'rejection_reason', trim(p_rejection_reason), 'correlation_id', v_correlation_id)
  );
END;
$$;

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

CREATE OR REPLACE FUNCTION public.employee_apply_leave_request(
  p_tenant_id uuid,
  p_leave_type_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_employee employees%ROWTYPE;
  v_leave_type leave_types%ROWTYPE;
  v_global_notice_days integer := 0;
  v_working_days integer[];
  v_date date;
  v_total_days integer := 0;
  v_balance numeric;
  v_effective_notice integer;
  v_notice_given integer;
  v_days_since_joining integer;
  v_leave_id uuid;
  v_leave_type_enum text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  SELECT * INTO v_employee
  FROM employees
  WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT * INTO v_leave_type
  FROM leave_types
  WHERE tenant_id = p_tenant_id
    AND id = p_leave_type_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave type not found';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT COALESCE(NULLIF(value, '')::integer, 0)
  INTO v_global_notice_days
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'leave_min_notice_days';
  v_global_notice_days := COALESCE(v_global_notice_days, 0);

  v_effective_notice := GREATEST(COALESCE(v_global_notice_days, 0), COALESCE(v_leave_type.min_notice_days, 0));
  v_notice_given := p_start_date - CURRENT_DATE;
  IF v_notice_given < v_effective_notice THEN
    RAISE EXCEPTION 'This leave requires at least % days notice', v_effective_notice;
  END IF;

  IF COALESCE(v_leave_type.applicable_from_day, 0) > 0 AND v_employee.date_of_joining IS NOT NULL THEN
    v_days_since_joining := CURRENT_DATE - v_employee.date_of_joining;
    IF v_days_since_joining < v_leave_type.applicable_from_day THEN
      RAISE EXCEPTION '% is only available after % days of employment', v_leave_type.name, v_leave_type.applicable_from_day;
    END IF;
  END IF;

  SELECT s.working_days INTO v_working_days
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = p_tenant_id
    AND es.employee_id = v_employee.id
    AND es.effective_from <= p_start_date
    AND (es.effective_to IS NULL OR es.effective_to >= p_start_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_working_days IS NULL THEN
    SELECT working_days INTO v_working_days
    FROM shifts
    WHERE tenant_id = p_tenant_id
      AND is_default = true
      AND is_active IS NOT FALSE
    LIMIT 1;
  END IF;
  v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

  v_date := p_start_date;
  WHILE v_date <= p_end_date LOOP
    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT EXISTS (SELECT 1 FROM holidays WHERE tenant_id = p_tenant_id AND date = v_date) THEN
      v_total_days := v_total_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  IF v_total_days = 0 THEN
    RAISE EXCEPTION 'The selected date range contains no working days';
  END IF;

  IF v_leave_type.max_consecutive_days IS NOT NULL AND v_total_days > v_leave_type.max_consecutive_days THEN
    RAISE EXCEPTION '% allows a maximum of % working days per request', v_leave_type.name, v_leave_type.max_consecutive_days;
  END IF;

  SELECT balance INTO v_balance
  FROM leave_balances
  WHERE tenant_id = p_tenant_id
    AND employee_id = v_employee.id
    AND leave_type_id = p_leave_type_id
    AND year = EXTRACT(YEAR FROM p_start_date)
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Leave balance not found';
  END IF;

  IF v_total_days > v_balance THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, requested: %', v_balance, v_total_days;
  END IF;

  IF EXISTS (
    SELECT 1 FROM leaves
    WHERE tenant_id = p_tenant_id
      AND employee_id = v_employee.id
      AND status IN ('pending', 'approved')
      AND start_date <= p_end_date
      AND end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'An existing pending or approved leave overlaps these dates';
  END IF;

  v_leave_type_enum := CASE upper(v_leave_type.code)
    WHEN 'CL' THEN 'casual'
    WHEN 'SL' THEN 'sick'
    WHEN 'EL' THEN 'earned'
    WHEN 'UL' THEN 'unpaid'
    WHEN 'ML' THEN 'maternity'
    WHEN 'PL' THEN 'paternity'
    ELSE 'other'
  END;

  INSERT INTO leaves (
    tenant_id, employee_id, leave_type_id, leave_type, start_date,
    end_date, total_days, reason, status
  )
  VALUES (
    p_tenant_id, v_employee.id, p_leave_type_id, v_leave_type_enum,
    p_start_date, p_end_date, v_total_days, trim(p_reason), 'pending'
  )
  RETURNING id INTO v_leave_id;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    SELECT p_tenant_id, e.id, 'New Leave Request',
           v_employee.full_name || ' has requested ' || v_leave_type.name || ' from ' || p_start_date || ' to ' || p_end_date || '.',
           'general', v_leave_id
    FROM employees e
    WHERE e.tenant_id = p_tenant_id
      AND e.department = 'operations'
      AND e.status = 'active';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_leave_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_cancel_pending_leave(
  p_tenant_id uuid,
  p_leave_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_employee_id uuid;
  v_leave leaves%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  SELECT id INTO v_employee_id
  FROM employees
  WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND status = 'active';

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT * INTO v_leave
  FROM leaves
  WHERE tenant_id = p_tenant_id
    AND id = p_leave_id
    AND employee_id = v_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending leave requests can be cancelled by employee';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_leave.start_date, v_leave.end_date);

  DELETE FROM leaves WHERE id = p_leave_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_leave_request(
  p_leave_id uuid,
  p_working_dates date[] DEFAULT NULL,
  p_approved_business_days integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_leave leaves%ROWTYPE;
  v_balance_row leave_balances%ROWTYPE;
  v_date date;
  v_caller_uid uuid;
  v_hr_employee_id uuid;
  v_working_days integer[];
  v_working_dates date[] := ARRAY[]::date[];
  v_approved_business_days integer := 0;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  SELECT * INTO v_leave
  FROM leaves
  WHERE id = p_leave_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status <> 'pending' THEN
    RAISE EXCEPTION 'Leave request is no longer pending (current status: %)', v_leave.status;
  END IF;

  v_hr_employee_id := assert_hr_for_tenant(v_leave.tenant_id);

  PERFORM assert_date_range_unlocked(v_leave.tenant_id, v_leave.start_date, v_leave.end_date);

  SELECT s.working_days INTO v_working_days
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = v_leave.tenant_id
    AND es.employee_id = v_leave.employee_id
    AND es.effective_from <= v_leave.start_date
    AND (es.effective_to IS NULL OR es.effective_to >= v_leave.start_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_working_days IS NULL THEN
    SELECT working_days INTO v_working_days
    FROM shifts
    WHERE tenant_id = v_leave.tenant_id
      AND is_default = true
      AND is_active IS NOT FALSE
    LIMIT 1;
  END IF;
  v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

  v_date := v_leave.start_date;
  WHILE v_date <= v_leave.end_date LOOP
    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT EXISTS (SELECT 1 FROM holidays WHERE tenant_id = v_leave.tenant_id AND date = v_date) THEN
      v_working_dates := array_append(v_working_dates, v_date);
      v_approved_business_days := v_approved_business_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  IF v_approved_business_days = 0 THEN
    RAISE EXCEPTION 'The selected leave range contains no working days';
  END IF;

  IF v_leave.leave_type_id IS NOT NULL THEN
    SELECT * INTO v_balance_row
    FROM leave_balances
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND leave_type_id = v_leave.leave_type_id
      AND year = EXTRACT(YEAR FROM v_leave.start_date)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Leave balance not found for this employee and type';
    END IF;

    IF v_balance_row.balance < v_approved_business_days THEN
      RAISE EXCEPTION 'Insufficient leave balance (available: %, requested: %)', v_balance_row.balance, v_approved_business_days;
    END IF;

    UPDATE leave_balances
    SET used_days = used_days + v_approved_business_days,
        balance = balance - v_approved_business_days,
        updated_at = now()
    WHERE id = v_balance_row.id;
  END IF;

  UPDATE leaves
  SET status = 'approved',
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      approved_business_days = v_approved_business_days,
      total_days = v_approved_business_days
  WHERE id = p_leave_id;

  FOREACH v_date IN ARRAY v_working_dates LOOP
    INSERT INTO attendance (tenant_id, employee_id, date, punch_in, status, punch_out_allowed, session_status)
    VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, NULL, 'on_leave', true, 'closed')
    ON CONFLICT (employee_id, date)
    DO UPDATE SET status = 'on_leave', punch_in = NULL, punch_out_allowed = true, session_status = 'closed';
  END LOOP;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      v_leave.tenant_id,
      v_leave.employee_id,
      'Leave Approved',
      'Your leave from ' || v_leave.start_date::text || ' to ' || v_leave.end_date::text || ' has been approved.',
      'leave_approved',
      p_leave_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    v_leave.tenant_id, v_hr_employee_id, 'hr', 'leave.approved', 'leave', p_leave_id,
    jsonb_build_object('approved_business_days', v_approved_business_days, 'working_dates', v_working_dates, 'correlation_id', v_correlation_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_leave_request(
  p_leave_id uuid,
  p_rejection_reason text,
  p_new_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_leave leaves%ROWTYPE;
  v_balance_row leave_balances%ROWTYPE;
  v_hr_employee_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF p_new_status NOT IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid leave status: %', p_new_status;
  END IF;

  SELECT * INTO v_leave
  FROM leaves
  WHERE id = p_leave_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Leave request is already %', v_leave.status;
  END IF;

  v_hr_employee_id := assert_hr_for_tenant(v_leave.tenant_id);

  PERFORM assert_date_range_unlocked(v_leave.tenant_id, v_leave.start_date, v_leave.end_date);

  IF v_leave.status = 'approved' THEN
    IF v_leave.leave_type_id IS NOT NULL AND v_leave.approved_business_days IS NOT NULL THEN
      SELECT * INTO v_balance_row
      FROM leave_balances
      WHERE tenant_id = v_leave.tenant_id
        AND employee_id = v_leave.employee_id
        AND leave_type_id = v_leave.leave_type_id
        AND year = EXTRACT(YEAR FROM v_leave.start_date)
      FOR UPDATE;

      IF FOUND THEN
        UPDATE leave_balances
        SET used_days = GREATEST(0, used_days - v_leave.approved_business_days),
            balance = balance + v_leave.approved_business_days,
            updated_at = now()
        WHERE id = v_balance_row.id;
      END IF;
    END IF;

    DELETE FROM attendance
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND date >= v_leave.start_date
      AND date <= v_leave.end_date
      AND status = 'on_leave'
      AND punch_in IS NULL;
  END IF;

  UPDATE leaves
  SET status = p_new_status,
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      rejection_reason = COALESCE(p_rejection_reason, rejection_reason)
  WHERE id = p_leave_id;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      v_leave.tenant_id,
      v_leave.employee_id,
      CASE WHEN p_new_status = 'cancelled' THEN 'Leave Cancelled' ELSE 'Leave Rejected' END,
      CASE
        WHEN p_new_status = 'cancelled'
          THEN 'Your leave from ' || v_leave.start_date::text || ' to ' || v_leave.end_date::text || ' has been cancelled.'
        ELSE 'Your leave request was rejected.' || CASE WHEN p_rejection_reason IS NULL OR p_rejection_reason = '' THEN '' ELSE ' Reason: ' || p_rejection_reason END
      END,
      CASE WHEN p_new_status = 'cancelled' THEN 'general' ELSE 'leave_rejected' END,
      p_leave_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    v_leave.tenant_id, v_hr_employee_id, 'hr',
    CASE WHEN p_new_status = 'cancelled' THEN 'leave.cancelled' ELSE 'leave.rejected' END,
    'leave', p_leave_id,
    jsonb_build_object('reason', p_rejection_reason, 'previous_status', v_leave.status, 'correlation_id', v_correlation_id)
  );
END;
$$;
