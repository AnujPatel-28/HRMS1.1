-- migration: harden SECURITY DEFINER functions against cross-tenant / IDOR calls
-- Source: doc/audit_2026-09-04_module_security_flow.md (DEFINER fence sweep, §2.6).
-- Two mechanisms, chosen per how each function is legitimately reached:
--   1) REVOKE EXECUTE FROM authenticated for functions ONLY called by the service role (edge
--      functions via the admin key = project_admin) or PERFORMed internally by other DEFINER
--      functions -- verified no frontend .rpc() caller. Bodies are untouched.
--   2) CREATE OR REPLACE with an added guard for functions genuinely called by logged-in users.
--      Each body below is the exact live pg_get_functiondef() output with ONLY the marked guard
--      inserted (verified by diff); no other statement was changed.
-- No BEGIN/COMMIT here: the CLI wraps each migration in its own transaction.

-- ============================================================================
-- 1. REVOKE EXECUTE (no legitimate authenticated caller; project_admin retained)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, uuid, text, integer, interval) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.check_employee_exists_by_email(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.check_employee_exists_by_email(text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_check_impossible_travel(uuid, uuid, numeric, numeric, timestamptz) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_event_ingest(uuid, uuid, timestamptz, text, text, text, uuid, numeric, numeric, numeric, text, uuid, jsonb, text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_location_exceptions() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_cleanup_expired_onboarding() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_auto_redmark_tasks() FROM authenticated;

-- ============================================================================
-- 2. Tenant/owner guards (derived bodies, guard-only inserts)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_confidence text DEFAULT NULL::text, p_remote_exception_id uuid DEFAULT NULL::uuid, p_verification_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_travel            jsonb;
  v_loc               record;
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
  -- Derived server-side by B2. Formerly supplied by the browser (finding C1).
  v_lunch_minutes        integer;
  v_overtime_enabled     boolean;
  v_overtime_rate        numeric;
  v_expected_shift_hours numeric;
  v_ot_enabled_txt       text;
  v_ot_rate_txt          text;
  v_shift_start          time;
  v_shift_end            time;
  v_shift_minutes        numeric;
  v_caller_employee      uuid;
BEGIN
  -- SECURITY (2026-09-04 audit): explicit tenant fence. SECURITY DEFINER bypasses RLS and
  -- is_hr() only proves HR in the CALLER's own tenant, so p_tenant_id must be checked.
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible' USING ERRCODE = '42501';
  END IF;
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

  -- ── 1b. OWNERSHIP (finding C3) ─────────────────────────────────────────────
  -- The lock above scopes by tenant but never checked WHOSE session this is, so any
  -- authenticated user in the tenant could close a colleague's day. HR is allowed —
  -- closing a forgotten punch-out is a real HR task. A session-less caller is
  -- project_admin (migration/cron/service role) and is likewise allowed.
  IF (SELECT auth.uid()) IS NOT NULL THEN
    SELECT id INTO v_caller_employee FROM public.employees
     WHERE user_id = (SELECT auth.uid()) AND tenant_id = p_tenant_id;
    IF v_attendance.employee_id IS DISTINCT FROM v_caller_employee
       AND NOT (SELECT public.is_hr()) THEN
      RAISE EXCEPTION 'NOT_YOUR_ATTENDANCE'
        USING ERRCODE = 'P0004',
              DETAIL  = 'This attendance session belongs to another employee.';
    END IF;
  END IF;

  -- ── 1c. DERIVE POLICY SERVER-SIDE (finding C1) ─────────────────────────────
  -- Same sources the client read; the client simply no longer gets to alter them.
  v_lunch_minutes := COALESCE(v_tenant.lunch_break_minutes, 60);

  SELECT value INTO v_ot_enabled_txt FROM tenant_settings
   WHERE tenant_id = p_tenant_id AND key = 'overtime_enabled';
  v_overtime_enabled := COALESCE(v_ot_enabled_txt, 'false') = 'true';

  SELECT value INTO v_ot_rate_txt FROM tenant_settings
   WHERE tenant_id = p_tenant_id AND key = 'overtime_rate';
  v_overtime_rate := COALESCE(NULLIF(v_ot_rate_txt, '')::numeric, 1.5);

  -- The shift in force ON THE ATTENDANCE DATE, not today: a punch-out completed after a

  -- roster change must be measured against the shift actually worked.
  SELECT s.start_time, s.end_time INTO v_shift_start, v_shift_end
    FROM public.employee_shifts es
    JOIN public.shifts s ON s.id = es.shift_id
   WHERE es.tenant_id = p_tenant_id
     AND es.employee_id = v_attendance.employee_id
     AND es.effective_from <= v_attendance.date
     AND (es.effective_to IS NULL OR es.effective_to >= v_attendance.date)
   ORDER BY es.effective_from DESC LIMIT 1;

  IF v_shift_start IS NOT NULL THEN
    -- Cross-midnight mirrors the client formula (24*60 - startMin) + endMin exactly.
    v_shift_minutes := CASE
      WHEN v_shift_end >= v_shift_start
        THEN EXTRACT(EPOCH FROM (v_shift_end - v_shift_start)) / 60.0
      ELSE 1440 - (EXTRACT(EPOCH FROM (v_shift_start - v_shift_end)) / 60.0)
    END;
    v_expected_shift_hours := ROUND((v_shift_minutes - v_lunch_minutes) / 60.0, 2);
  ELSE
    v_expected_shift_hours := COALESCE(v_tenant.work_hours_per_day, 8);
  END IF;
  v_tenant_tz     := COALESCE(v_tenant.timezone, 'UTC');
  v_today_in_tz   := (v_now AT TIME ZONE v_tenant_tz)::date;

  -- ── 3. PAYROLL LOCK GUARD ──────────────────────────────────────────────────
  -- MODULE INDEPENDENCE: gated behind the payroll module, mirroring punch_in_attendance.
  -- Ungated, an attendance-only tenant with a stray payroll_lock_date in tenant_settings could
  -- punch IN but never punch OUT -- payroll policy silently blocking an attendance-only tenant.
  IF public.tenant_has_module_for(p_tenant_id, 'payroll') THEN
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
  END IF;

  -- ── 4. TASK GATE ENFORCEMENT ───────────────────────────────────────────────
  IF v_tenant.punch_out_gate_enabled AND public.tenant_has_module_for(p_tenant_id, 'tasks') THEN
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
        v_break_limit := v_lunch_minutes;
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
      v_lunch_deduction := v_lunch_minutes / 60.0;
    ELSE
      v_lunch_deduction := 0;
    END IF;
  ELSE
    -- Fixed deduction: strictly deduct policy lunch minutes if raw hours >= 5
    IF v_raw_hours >= 5 THEN
      v_lunch_deduction := v_lunch_minutes / 60.0;
    ELSE
      v_lunch_deduction := 0;
    END IF;
  END IF;

  v_work_hours := ROUND(GREATEST(0, v_raw_hours - v_lunch_deduction), 2);

  -- ── 6. WRITE PUNCH-OUT ─────────────────────────────────────────────────────
  -- Five columns added here vs the deployed body (finding closed by this migration):
  -- location_accuracy / location_status reuse the pre-existing p_acc / p_loc_status
  -- parameters (they were already received and already written into the punch_out_-prefixed
  -- columns below; this just also writes the generic columns, mirroring what
  -- punch_in_attendance (20260829110000) already does for punch-in). location_confidence,
  -- remote_exception_id and verification_snapshot reuse the three new trailing parameters.
  -- ── SERVER-SIDE LOCATION POLICY (Group B) ───────────────────────────────────────────────
  -- Geofence / GPS mode / confidence banding / remote-work handling used to be decided in
  -- PunchInOut.tsx and merely STORED here. p_loc_status, p_confidence and p_remote_exception_id
  -- are now ADVISORY ONLY: they stay in the signature so an older bundle keeps working (a
  -- signature change without a matching frontend deploy broke punch-in for four days once), but
  -- the values written below are the server's, never the caller's.
  SELECT * INTO v_loc FROM public.attendance_evaluate_location(
    p_tenant_id, v_attendance.employee_id, p_lat, p_lng, p_acc, v_attendance.date
  );

  IF NOT v_loc.allowed THEN
    RAISE EXCEPTION 'GEOFENCE_BLOCKED'
      USING ERRCODE = 'P0012',
            DETAIL  = coalesce(v_loc.block_reason, 'This punch is outside the permitted location.');
  END IF;


  -- Anti-spoof, advisory: merged into the stored evidence, never a block (see 20260903121818).
  v_travel := public.attendance_check_impossible_travel(p_tenant_id, v_attendance.employee_id, p_lat, p_lng, v_now);

  UPDATE attendance
  SET punch_out             = v_now,
      work_hours            = v_work_hours,
      session_status        = 'closed',
      punch_out_lat         = p_lat,
      punch_out_lng         = p_lng,
      punch_out_location_accuracy = p_acc,
      punch_out_location_status   = CASE WHEN p_loc_status = 'selfie_missing' THEN 'selfie_missing' ELSE v_loc.loc_status END,
      location_accuracy     = p_acc,
      location_status       = CASE WHEN p_loc_status = 'selfie_missing' THEN 'selfie_missing' ELSE v_loc.loc_status END,
      location_confidence   = v_loc.confidence,
      remote_exception_id   = coalesce(v_loc.remote_exception_id, p_remote_exception_id),
      verification_snapshot = coalesce(p_verification_snapshot, '{}'::jsonb) || jsonb_build_object('server_travel_check', v_travel),
      total_break_minutes   = v_attendance.total_break_minutes,
      current_break_id      = NULL,
      current_break_start   = NULL
  WHERE id = p_attendance_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  -- ── 7. OVERTIME ────────────────────────────────────────────────────────────
  v_overtime_hours := 0;
  IF v_overtime_enabled THEN
    v_overtime_hours := ROUND(GREATEST(0, v_work_hours - v_expected_shift_hours), 2);
    IF v_overtime_hours > 0 THEN
      INSERT INTO overtime_records (
        tenant_id, employee_id, attendance_id, date, regular_hours,
        overtime_hours, overtime_rate, overtime_amount, approved
      ) VALUES (
        p_tenant_id, v_attendance.employee_id, p_attendance_id, v_attendance.date,
        v_expected_shift_hours, v_overtime_hours, v_overtime_rate,
        ROUND(v_overtime_hours * v_overtime_rate, 2), false
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
$function$;

CREATE OR REPLACE FUNCTION public.start_employee_break(p_attendance_id uuid, p_tenant_id uuid, p_break_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_attendance  attendance%ROWTYPE;
  v_break_id    uuid;
  v_now         timestamptz := now();
BEGIN
  -- SECURITY (2026-09-04 audit): explicit tenant fence. SECURITY DEFINER bypasses RLS and
  -- is_hr() only proves HR in the CALLER's own tenant, so p_tenant_id must be checked.
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible' USING ERRCODE = '42501';
  END IF;
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
  -- SECURITY (2026-09-04 audit): a caller may only manage their OWN break, unless HR of this
  -- tenant. Closes the IDOR where any employee could alter a colleague's break (and be logged
  -- as them in audit_logs).
  IF v_attendance.employee_id IS DISTINCT FROM (SELECT public.get_auth_employee_id(p_tenant_id))
     AND NOT (SELECT public.is_hr()) THEN
    RAISE EXCEPTION 'forbidden: not your attendance' USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.end_employee_break(p_attendance_id uuid, p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_attendance    attendance%ROWTYPE;
  v_break         attendance_breaks%ROWTYPE;
  v_now           timestamptz := now();
  v_duration      integer;
  v_limit         integer;
  v_over_limit    integer;
BEGIN
  -- SECURITY (2026-09-04 audit): explicit tenant fence. SECURITY DEFINER bypasses RLS and
  -- is_hr() only proves HR in the CALLER's own tenant, so p_tenant_id must be checked.
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible' USING ERRCODE = '42501';
  END IF;
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
  -- SECURITY (2026-09-04 audit): a caller may only manage their OWN break, unless HR of this
  -- tenant. Closes the IDOR where any employee could alter a colleague's break (and be logged
  -- as them in audit_logs).
  IF v_attendance.employee_id IS DISTINCT FROM (SELECT public.get_auth_employee_id(p_tenant_id))
     AND NOT (SELECT public.is_hr()) THEN
    RAISE EXCEPTION 'forbidden: not your attendance' USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_chat_channel(channel_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  caller_role text;
BEGIN
  -- Get the role of the calling user from auth.users metadata
  SELECT COALESCE(metadata->>'role', '') INTO caller_role
  FROM auth.users
  WHERE id = auth.uid();

  -- Only HR can delete channels
  IF caller_role != 'hr' THEN
    RAISE EXCEPTION 'Permission denied: only HR can delete channels';
  END IF;

  -- Cannot delete the general channel
  IF EXISTS (SELECT 1 FROM chat_channels WHERE id = channel_id AND name = 'general') THEN
    RAISE EXCEPTION 'Cannot delete the general channel';
  END IF;

  -- Delete the channel (cascade will handle messages and members)
  -- SECURITY (2026-09-04 audit): scope the delete to the caller's tenant; previously any HR
  -- user could delete another tenant's channel by id.
  DELETE FROM chat_channels WHERE id = channel_id AND tenant_id = (SELECT public.get_auth_tenant_id());
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_employee_password_by_hr(target_email text, target_password_hash text, tenant_uuid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  actor_role text;
  actor_tenant_id uuid;
  updated_user_id uuid;
  target_user_id uuid;
  target_user_tenant_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF target_email IS NULL OR length(trim(target_email)) = 0 THEN
    RAISE EXCEPTION 'Employee email is required';
  END IF;

  IF target_password_hash IS NULL OR length(trim(target_password_hash)) = 0 THEN
    RAISE EXCEPTION 'Password hash is required';
  END IF;

  SELECT
    u.metadata->>'role',
    NULLIF(u.metadata->>'tenant_id', '')::uuid
  INTO actor_role, actor_tenant_id
  FROM auth.users u
  WHERE u.id = (SELECT auth.uid());

  IF actor_role <> 'hr' OR actor_tenant_id IS DISTINCT FROM tenant_uuid THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Get the target user ID and their current tenant ID (if any)
  SELECT 
    u.id, 
    NULLIF(u.metadata->>'tenant_id', '')::uuid
  INTO target_user_id, target_user_tenant_id
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(target_email));

  IF target_user_id IS NULL THEN
     RAISE EXCEPTION 'Auth user not found';
  END IF;

  -- If the user already belongs to a DIFFERENT tenant, block it. 
  -- If it's NULL (not set yet), we allow claiming it.
  IF target_user_tenant_id IS NOT NULL AND target_user_tenant_id IS DISTINCT FROM tenant_uuid THEN
    RAISE EXCEPTION 'Employee not found for this tenant';
  END IF;

  -- SECURITY (2026-09-04 audit): refuse to claim a target that currently holds a platform/HR
  -- role. Without this, any HR user could set the password of an unclaimed superadmin account
  -- (2 such accounts existed at audit time) and, via the metadata rebuild below, DEMOTE it to
  -- 'employee' -- an account takeover + privilege downgrade. This guard is unconditional and
  -- cannot affect legitimate employee onboarding (which never targets a privileged account).
  -- NOTE: claiming a NON-privileged orphan auth account (role-less, no employee row) is still
  -- possible and is a separate, lower-severity follow-up -- closing it needs an
  -- EXISTS-employee-row check whose safety depends on onboarding ordering not yet confirmed.
  IF EXISTS (SELECT 1 FROM auth.users u
             WHERE u.id = target_user_id
               AND (u.metadata->>'role') IN ('superadmin','admin','hr','hr_admin')) THEN
    RAISE EXCEPTION 'Forbidden: cannot set password for a privileged account';
  END IF;

  UPDATE auth.users
  SET password = target_password_hash,
      email_verified = true,
      metadata = jsonb_build_object('role', 'employee', 'tenant_id', tenant_uuid),
      updated_at = now()
  WHERE id = target_user_id
  RETURNING id INTO updated_user_id;

  IF updated_user_id IS NULL THEN
    RAISE EXCEPTION 'Auth user not found during update';
  END IF;

  -- Update public.employees if they exist (they won't exist yet during initial onboarding)
  UPDATE public.employees
  SET user_id = updated_user_id
  WHERE tenant_id = tenant_uuid
    AND lower(email) = lower(trim(target_email));

  RETURN updated_user_id;
END;
$function$;

