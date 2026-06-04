-- 1. Create break history table
CREATE TABLE IF NOT EXISTS public.attendance_breaks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_id     uuid NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  break_type        text NOT NULL CHECK (break_type IN ('lunch', 'short_break', 'tea_break')),
  started_at        timestamp with time zone NOT NULL DEFAULT now(),
  ended_at          timestamp with time zone DEFAULT NULL,
  duration_minutes  integer DEFAULT NULL,
  over_limit_minutes integer DEFAULT 0,
  created_at        timestamp with time zone NOT NULL DEFAULT now()
);

-- 2. Create indexes for quick queries & active break constraint
CREATE INDEX IF NOT EXISTS idx_attendance_breaks_session ON public.attendance_breaks(attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_breaks_active ON public.attendance_breaks(tenant_id, ended_at) WHERE (ended_at IS NULL);

-- Unique index ensuring an employee can only have ONE active break at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_break_per_employee 
ON public.attendance_breaks(employee_id) 
WHERE (ended_at IS NULL);

-- 3. Enable RLS and add policies
ALTER TABLE public.attendance_breaks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_breaks' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON public.attendance_breaks
      FOR ALL TO authenticated
      USING (tenant_id = get_auth_tenant_id())
      WITH CHECK (tenant_id = get_auth_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_breaks' AND policyname = 'breaks_self_read') THEN
    CREATE POLICY breaks_self_read ON public.attendance_breaks
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = employee_id AND e.user_id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_breaks' AND policyname = 'breaks_hr_all') THEN
    CREATE POLICY breaks_hr_all ON public.attendance_breaks
      FOR ALL TO authenticated
      USING (is_hr())
      WITH CHECK (is_hr());
  END IF;
END $$;

-- 4. Alter attendance table to add break tracking columns
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS total_break_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS current_break_id uuid REFERENCES public.attendance_breaks(id) ON DELETE SET NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS current_break_start timestamp with time zone DEFAULT NULL;

-- 5. Create Auto-close break trigger for punch-out / HR edits / corrections
CREATE OR REPLACE FUNCTION public.fn_auto_close_active_break()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_now timestamptz := now();
  v_end_time timestamptz;
  v_duration integer;
  v_limit integer;
  v_over_limit integer;
  v_break public.attendance_breaks%ROWTYPE;
BEGIN
  -- Triggered when an active attendance session is punch-completed or closed,
  -- and there is an active break session associated.
  IF (NEW.punch_out IS NOT NULL OR NEW.session_status = 'closed') AND OLD.current_break_id IS NOT NULL THEN
    -- Select the break record to verify if it is active
    SELECT * INTO v_break FROM public.attendance_breaks WHERE id = OLD.current_break_id;
    
    IF FOUND AND v_break.ended_at IS NULL THEN
      -- Use the punch_out time if available, otherwise now
      v_end_time := COALESCE(NEW.punch_out, v_now);
      
      -- Calculate actual duration in minutes, minimum 0
      v_duration := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_end_time - v_break.started_at)) / 60.0));
      
      -- Get limit
      v_limit := 15; -- Default limit for short breaks
      IF v_break.break_type = 'lunch' THEN
        SELECT lunch_break_minutes INTO v_limit FROM public.tenants WHERE id = NEW.tenant_id;
      ELSE
        SELECT COALESCE(value::integer, 15) INTO v_limit
        FROM public.tenant_settings
        WHERE tenant_id = NEW.tenant_id AND key = 'short_break_limit_minutes';
      END IF;
      
      v_over_limit := GREATEST(0, v_duration - v_limit);
      
      -- Update break history record
      UPDATE public.attendance_breaks
      SET ended_at = v_end_time,
          duration_minutes = v_duration,
          over_limit_minutes = v_over_limit
      WHERE id = v_break.id;
      
      -- Update fields on the NEW attendance record directly
      NEW.total_break_minutes := COALESCE(OLD.total_break_minutes, 0) + v_duration;
    END IF;
    
    -- Ensure current break pointers are cleared
    NEW.current_break_id := NULL;
    NEW.current_break_start := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_close_active_break ON public.attendance;
CREATE TRIGGER trg_auto_close_active_break
BEFORE UPDATE ON public.attendance
FOR EACH ROW
EXECUTE FUNCTION public.fn_auto_close_active_break();

-- 6. Create RPC start_employee_break
CREATE OR REPLACE FUNCTION public.start_employee_break(
  p_attendance_id uuid,
  p_tenant_id     uuid,
  p_break_type    text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_attendance  attendance%ROWTYPE;
  v_break_id    uuid;
  v_now         timestamptz := now();
BEGIN
  -- Lock attendance row
  SELECT * INTO v_attendance
  FROM attendance
  WHERE id = p_attendance_id
    AND tenant_id = p_tenant_id
    AND session_status = 'open'
    AND punch_in IS NOT NULL
    AND punch_out IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTENDANCE_NOT_OPEN'
      USING ERRCODE = 'P0004',
            DETAIL  = 'Attendance session is not open or employee is not punched in.';
  END IF;

  -- Enforce break type value validation
  IF p_break_type NOT IN ('lunch', 'short_break', 'tea_break') THEN
    RAISE EXCEPTION 'INVALID_BREAK_TYPE'
      USING ERRCODE = 'P0007',
            DETAIL  = 'Break type must be lunch, short_break, or tea_break.';
  END IF;

  -- Double-click / concurrent starts protection
  IF v_attendance.current_break_id IS NOT NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_ALREADY_ON_BREAK'
      USING ERRCODE = 'P0005',
            DETAIL  = 'Employee is already on active break.';
  END IF;

  -- Insert break record
  INSERT INTO public.attendance_breaks (
    tenant_id, employee_id, attendance_id, break_type, started_at
  ) VALUES (
    p_tenant_id, v_attendance.employee_id, p_attendance_id, p_break_type, v_now
  ) RETURNING id INTO v_break_id;

  -- Update attendance row
  UPDATE public.attendance
  SET current_break_id = v_break_id,
      current_break_start = v_now
  WHERE id = p_attendance_id;

  -- Log audit action
  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (p_tenant_id, v_attendance.employee_id, 'employee', 'attendance.break_started',
          'attendance', p_attendance_id,
          jsonb_build_object('break_id', v_break_id, 'break_type', p_break_type, 'started_at', v_now));

  RETURN jsonb_build_object(
    'success', true,
    'break_id', v_break_id,
    'started_at', v_now
  );
END;
$$;

-- 7. Create RPC end_employee_break
CREATE OR REPLACE FUNCTION public.end_employee_break(
  p_attendance_id uuid,
  p_tenant_id     uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_attendance    attendance%ROWTYPE;
  v_break         attendance_breaks%ROWTYPE;
  v_now           timestamptz := now();
  v_duration      integer;
  v_limit         integer;
  v_over_limit    integer;
BEGIN
  -- Lock attendance row
  SELECT * INTO v_attendance
  FROM attendance
  WHERE id = p_attendance_id
    AND tenant_id = p_tenant_id
    AND session_status = 'open'
    AND punch_out IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTENDANCE_NOT_OPEN'
      USING ERRCODE = 'P0004',
            DETAIL  = 'Attendance session is not open or employee already punched out.';
  END IF;

  -- State validation (not on break)
  IF v_attendance.current_break_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_ON_BREAK'
      USING ERRCODE = 'P0006',
            DETAIL  = 'Employee is not on break currently.';
  END IF;

  -- Select and lock active break
  SELECT * INTO v_break
  FROM public.attendance_breaks
  WHERE id = v_attendance.current_break_id
  FOR UPDATE;

  -- Calculate duration
  v_duration := ROUND(EXTRACT(EPOCH FROM (v_now - v_break.started_at)) / 60.0);

  -- Get limit based on break type
  v_limit := 15; -- Default limit for short breaks
  IF v_break.break_type = 'lunch' THEN
    SELECT lunch_break_minutes INTO v_limit FROM public.tenants WHERE id = p_tenant_id;
  ELSE
    SELECT COALESCE(value::integer, 15) INTO v_limit
    FROM public.tenant_settings
    WHERE tenant_id = p_tenant_id AND key = 'short_break_limit_minutes';
  END IF;

  v_over_limit := GREATEST(0, v_duration - v_limit);

  -- Update break record
  UPDATE public.attendance_breaks
  SET ended_at = v_now,
      duration_minutes = v_duration,
      over_limit_minutes = v_over_limit
  WHERE id = v_break.id;

  -- Update attendance row
  UPDATE public.attendance
  SET current_break_id = NULL,
      current_break_start = NULL,
      total_break_minutes = COALESCE(total_break_minutes, 0) + v_duration
  WHERE id = p_attendance_id;

  -- Log audit action
  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (p_tenant_id, v_attendance.employee_id, 'employee', 'attendance.break_ended',
          'attendance', p_attendance_id,
          jsonb_build_object('break_id', v_break.id, 'break_type', v_break.break_type,
                             'duration_minutes', v_duration, 'over_limit_minutes', v_over_limit));

  RETURN jsonb_build_object(
    'success', true,
    'break_id', v_break.id,
    'duration_minutes', v_duration,
    'over_limit_minutes', v_over_limit
  );
END;
$$;

-- 8. Rewrite punch_out_attendance RPC to enforce deduction modes
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
  v_tracking_enabled  text;
  v_deduction_mode    text;
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
  -- Note: The trigger `trg_auto_close_active_break` will automatically close any active break
  -- when session_status is updated to 'closed' or punch_out is updated.
  -- This will update v_attendance fields in the DB, but since we have v_attendance in variables,
  -- let's manually replicate the trigger effect to calculate work hours correctly here.
  IF v_attendance.current_break_id IS NOT NULL THEN
    -- Calculate duration
    DECLARE
      v_break_duration integer;
      v_break_limit    integer;
      v_break_over     integer;
      v_break_type     text;
    BEGIN
      SELECT break_type INTO v_break_type FROM public.attendance_breaks WHERE id = v_attendance.current_break_id;
      
      v_break_duration := ROUND(EXTRACT(EPOCH FROM (v_now - v_attendance.current_break_start)) / 60.0);
      
      v_break_limit := 15;
      IF v_break_type = 'lunch' THEN
        v_break_limit := p_lunch_minutes;
      ELSE
        SELECT COALESCE(value::integer, 15) INTO v_break_limit
        FROM tenant_settings
        WHERE tenant_id = p_tenant_id AND key = 'short_break_limit_minutes';
      END IF;
      
      v_break_over := GREATEST(0, v_break_duration - v_break_limit);
      
      UPDATE public.attendance_breaks
      SET ended_at = v_now,
          duration_minutes = v_break_duration,
          over_limit_minutes = v_break_over
      WHERE id = v_attendance.current_break_id;
      
      v_attendance.total_break_minutes := COALESCE(v_attendance.total_break_minutes, 0) + v_break_duration;
      v_attendance.current_break_id := NULL;
      v_attendance.current_break_start := NULL;
    END;
  END IF;

  -- Determine deduction policy
  SELECT value INTO v_tracking_enabled
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id AND key = 'break_tracking_enabled';

  SELECT value INTO v_deduction_mode
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id AND key = 'break_deduction_mode';

  v_raw_hours := EXTRACT(EPOCH FROM (v_now - v_attendance.punch_in)) / 3600.0;

  IF COALESCE(v_tracking_enabled, 'false') = 'true' AND COALESCE(v_deduction_mode, 'fixed') = 'actual' THEN
    -- Deduct actual tracked break minutes (minimum 0)
    -- Fall back to fixed policy lunch minutes if no breaks were tracked at all and raw hours >= 5
    IF COALESCE(v_attendance.total_break_minutes, 0) > 0 THEN
      v_lunch_deduction := v_attendance.total_break_minutes / 60.0;
    ELSIF v_raw_hours >= 5 THEN
      v_lunch_deduction := p_lunch_minutes / 60.0;
    ELSE
      v_lunch_deduction := 0;
    END IF;
  ELSE
    -- Fixed deduction: strictly deduct policy lunch minutes if raw hours >= 5
    IF v_raw_hours >= 5 THEN
      v_lunch_deduction := p_lunch_minutes / 60.0;
    ELSE
      v_lunch_deduction := 0;
    END IF;
  END IF;

  v_work_hours := ROUND(GREATEST(0, v_raw_hours - v_lunch_deduction), 2);

  -- ── 6. WRITE PUNCH-OUT ─────────────────────────────────────────────────────
  UPDATE attendance
  SET punch_out             = v_now,
      work_hours            = v_work_hours,
      session_status        = 'closed',
      punch_out_lat         = p_lat,
      punch_out_lng         = p_lng,
      punch_out_location_accuracy = p_acc,
      punch_out_location_status   = p_loc_status,
      total_break_minutes   = v_attendance.total_break_minutes,
      current_break_id      = NULL,
      current_break_start   = NULL
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
  WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0003' OR SQLSTATE 'P0004' OR SQLSTATE 'P0005' OR SQLSTATE 'P0006' OR SQLSTATE 'P0007' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  SQLERRM,
      'errcode', SQLSTATE
    );
END;
$$;
