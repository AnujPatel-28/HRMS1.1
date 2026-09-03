-- Group B, item 2 -- part 2 of 2: wire the evaluator into the punch paths.
-- Requires 20260903105835 (attendance_evaluate_location + the device_verified status).
--
-- WHAT CHANGES BEHAVIOURALLY
--   punch_in_attendance / punch_out_attendance now CALL attendance_evaluate_location() and RAISE
--   'GEOFENCE_BLOCKED' (P0012) when it denies the punch. Previously the browser decided and the
--   server stored whatever it was told, so a kiosk, a script or a modified bundle skipped the
--   check entirely.
--
--   p_loc_status, p_confidence and p_remote_exception_id become ADVISORY. They stay in both
--   signatures on purpose -- changing a punch RPC signature without a simultaneous frontend deploy
--   broke punch-in in production for four days -- but the values persisted are the server's.
--   p_lat / p_lng / p_acc are still taken from the caller: they are raw sensor facts, not policy.
--
--   save_attendance_policy_transaction stops demanding office_lat/office_lng and instead requires
--   at least one ACTIVE office_locations row before the geofence can be enabled. That is the
--   precondition that makes the runtime fail-open safe.
--
-- NOT IN SCOPE, deliberately: device_ingest_punch writes an attendance EVENT and derivation
-- creates the row, so labelling device punches 'device_verified' belongs in attendance_derive_pass1,
-- not here. Device punches remain gated by the shift's allowed_punch_sources, which is the correct
-- control for a terminal that has no GPS to fence.
--
-- All three bodies are derived from pg_get_functiondef() with targeted textual edits; every other
-- statement -- punch_out's break reconciliation and payroll lock especially -- is byte-identical.

CREATE OR REPLACE FUNCTION public.punch_in_attendance(p_tenant_id uuid, p_employee_id uuid DEFAULT NULL::uuid, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_acc numeric DEFAULT NULL::numeric, p_loc_status text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_confidence text DEFAULT NULL::text, p_remote_exception_id uuid DEFAULT NULL::uuid, p_verification_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_loc               record;
  v_tenant           public.tenants%ROWTYPE;
  v_tenant_tz        text;
  v_caller_employee  uuid;
  v_employee_id      uuid;
  v_business_date    date;
  v_now              timestamptz := now();
  v_payroll_lock_str text;
  v_payroll_lock_date date;
  v_attendance_id    uuid;
BEGIN
  -- ── 1. TENANT FENCE ─────────────────────────────────────────────────────────────────────
  -- Binding rule 1: SECURITY DEFINER bypasses RLS entirely (owner exemption). Restored by
  -- hand, copying attendance_derive_pass1's shape: the fence is SKIPPED only for a session-
  -- less caller (migration/service-role, already trusted); a real authenticated caller must
  -- pass can_access_tenant.
  IF (SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'TENANT_FORBIDDEN'
      USING ERRCODE = 'P0006',
            DETAIL  = 'This tenant is not accessible to the caller.';
  END IF;

  -- Module gate is UNCONDITIONAL (unlike the fence above) -- a business invariant, not a
  -- security check, so it applies even to a session-less caller. Matches attendance_derive_
  -- pass1 exactly.
  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'MODULE_DISABLED'
      USING ERRCODE = 'P0007',
            DETAIL  = 'The attendance module is not enabled for this tenant.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND'
      USING ERRCODE = 'P0008',
            DETAIL  = 'Unknown tenant.';
  END IF;

  -- ── 2. OWNERSHIP (C3, mirroring punch_out_attendance's shape) ──────────────────────────────
  SELECT id INTO v_caller_employee FROM public.employees
   WHERE user_id = (SELECT auth.uid()) AND tenant_id = p_tenant_id;

  v_employee_id := COALESCE(p_employee_id, v_caller_employee);

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_RESOLVED'
      USING ERRCODE = 'P0009',
            DETAIL  = 'No employee context: the caller has no employee row in this tenant and none was supplied.';
  END IF;

  -- Session-less caller (migration/service-role) is trusted, same as punch_out_attendance.
  -- A real authenticated caller may only punch themselves in, unless they are HR.
  IF (SELECT auth.uid()) IS NOT NULL THEN
    IF v_employee_id IS DISTINCT FROM v_caller_employee
       AND NOT (SELECT public.is_hr()) THEN
      RAISE EXCEPTION 'NOT_YOUR_ATTENDANCE'
        USING ERRCODE = 'P0010',
              DETAIL  = 'You may only punch in your own attendance.';
    END IF;
  END IF;

  -- ── 3. BUSINESS DATE, SERVER-SIDE, TENANT TIMEZONE (D9 / kills C6 / F2 for this path) ─────
  -- No current_date, no now()::date -- the instant is v_now (server clock), converted through
  -- the TENANT's own timezone, never the caller's. The client supplies no date at all.
  v_tenant_tz     := COALESCE(v_tenant.timezone, 'UTC');
  v_business_date := (v_now AT TIME ZONE v_tenant_tz)::date;

  -- ── 4. PAYROLL LOCK GUARD -- module-independence (standing constraint) ─────────────────────
  -- A payroll lock is a legitimate payroll-to-attendance fact (punch_out_attendance already
  -- enforces one), so mirroring it here is correct -- but ONLY when the payroll module is
  -- actually enabled for this tenant. A tenant running attendance without payroll must never
  -- read a payroll-flavoured setting at all; if payroll is off, there is no lock and punch-in
  -- proceeds unconditionally.
  IF (SELECT public.tenant_has_module_for(p_tenant_id, 'payroll')) THEN
    SELECT value INTO v_payroll_lock_str
    FROM public.tenant_settings
    WHERE tenant_id = p_tenant_id AND key = 'payroll_lock_date';

    IF v_payroll_lock_str IS NOT NULL AND v_payroll_lock_str <> '' THEN
      v_payroll_lock_date := v_payroll_lock_str::date;
      IF v_business_date <= v_payroll_lock_date THEN
        RAISE EXCEPTION 'PAYROLL_LOCKED'
          USING ERRCODE = 'P0011',
                DETAIL  = 'This attendance date falls within a locked payroll period.';
      END IF;
    END IF;
  END IF;

  -- ── 5. OPEN-SESSION GUARD (idx_single_open_session) -- fail cleanly ────────────────────────
  -- A friendly pre-check for the common (single-session) case; idx_single_open_session is the
  -- real guarantee under concurrency, and a race that slips past this check still fails
  -- cleanly via the unique_violation arm of the exception handler below, never as a raw
  -- constraint-violation message.
  PERFORM 1 FROM public.attendance
   WHERE tenant_id = p_tenant_id AND employee_id = v_employee_id AND session_status = 'open'
   FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'ALREADY_PUNCHED_IN'
      USING ERRCODE = 'P0005',
            DETAIL  = 'An open attendance session already exists for this employee.';
  END IF;

  -- ── SERVER-SIDE LOCATION POLICY (Group B) ───────────────────────────────────────────────
  -- Geofence / GPS mode / confidence banding / remote-work handling used to be decided in
  -- PunchInOut.tsx and merely STORED here. p_loc_status, p_confidence and p_remote_exception_id
  -- are now ADVISORY ONLY: they stay in the signature so an older bundle keeps working (a
  -- signature change without a matching frontend deploy broke punch-in for four days once), but
  -- the values written below are the server's, never the caller's.
  SELECT * INTO v_loc FROM public.attendance_evaluate_location(
    p_tenant_id, v_employee_id, p_lat, p_lng, p_acc, v_business_date
  );

  IF NOT v_loc.allowed THEN
    RAISE EXCEPTION 'GEOFENCE_BLOCKED'
      USING ERRCODE = 'P0012',
            DETAIL  = coalesce(v_loc.block_reason, 'This punch is outside the permitted location.');
  END IF;

  -- ── 6. WRITE THE ROW ────────────────────────────────────────────────────────────────────
  -- Same shape as the existing direct-insert path (PunchInOut.tsx:742), minus the client-
  -- computed policy (is_late / half-day status -- see the header's stated gap; D12 forbids
  -- inventing a third copy of that threshold logic here) and minus IP/confidence/snapshot
  -- fields the existing punch_out_attendance precedent also leaves to a client follow-up
  -- update. punch_in = v_now (not left to the column DEFAULT) so trg_attendance_dual_write_
  -- event's `NEW.punch_in IS NOT NULL` branch fires deterministically and logs exactly one
  -- 'in' event -- the same mechanism the direct-insert path already relies on today.
  -- punch_out_allowed is explicitly true -- see header: write-only column, this is the value
  -- every other writer of it (including the direct-insert common case) already uses.
  INSERT INTO public.attendance (
    tenant_id, employee_id, date, punch_in, session_status, punch_out_allowed,
    punch_in_lat, punch_in_lng, punch_in_location_accuracy, punch_in_location_status,
    location_accuracy, location_status, business_date_tz,
    punch_in_ip, location_confidence, remote_exception_id, verification_snapshot
  ) VALUES (
    p_tenant_id, v_employee_id, v_business_date, v_now, 'open', true,
    p_lat, p_lng, p_acc, v_loc.loc_status,
    p_acc, v_loc.loc_status, v_tenant_tz,
    p_ip, v_loc.confidence, coalesce(v_loc.remote_exception_id, p_remote_exception_id), p_verification_snapshot
  )
  RETURNING id INTO v_attendance_id;

  RETURN jsonb_build_object(
    'success',       true,
    'reason',        null,
    'attendance_id', v_attendance_id,
    'date',          v_business_date
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ALREADY_PUNCHED_IN', 'errcode', '23505');
  WHEN SQLSTATE 'P0005' OR SQLSTATE 'P0006' OR SQLSTATE 'P0007'
    OR SQLSTATE 'P0008' OR SQLSTATE 'P0009' OR SQLSTATE 'P0010' OR SQLSTATE 'P0011' THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM, 'errcode', SQLSTATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_confidence text DEFAULT NULL::text, p_remote_exception_id uuid DEFAULT NULL::uuid, p_verification_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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

  UPDATE attendance
  SET punch_out             = v_now,
      work_hours            = v_work_hours,
      session_status        = 'closed',
      punch_out_lat         = p_lat,
      punch_out_lng         = p_lng,
      punch_out_location_accuracy = p_acc,
      punch_out_location_status   = v_loc.loc_status,
      location_accuracy     = p_acc,
      location_status       = v_loc.loc_status,
      location_confidence   = v_loc.confidence,
      remote_exception_id   = coalesce(v_loc.remote_exception_id, p_remote_exception_id),
      verification_snapshot = p_verification_snapshot,
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

CREATE OR REPLACE FUNCTION public.save_attendance_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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

  -- The fence is multi-branch: it is every active public.office_locations row, each with its own
  -- radius. The old single office_lat/office_lng pair is no longer the fence, so requiring it here
  -- would block a correctly configured tenant. Guard the real precondition instead -- at least one
  -- active branch -- which is what lets attendance_evaluate_location() fail OPEN at punch time
  -- rather than locking a company out.
  IF v_geofence_enabled THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.office_locations o
      WHERE o.tenant_id = p_tenant_id AND o.is_active
    ) THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: Geofence is enabled but no active office location is configured. Add one in Office Locations first.';
    END IF;
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
$function$;


-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  v_in text; v_out text; v_save text;
BEGIN
  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_in   FROM pg_proc WHERE proname='punch_in_attendance'  AND pronamespace='public'::regnamespace;
  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_out  FROM pg_proc WHERE proname='punch_out_attendance' AND pronamespace='public'::regnamespace;
  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_save FROM pg_proc WHERE proname='save_attendance_policy_transaction' AND pronamespace='public'::regnamespace;

  IF v_in !~ 'attendance_evaluate_location' OR v_out !~ 'attendance_evaluate_location' THEN
    RAISE EXCEPTION 'assertion: a punch path does not evaluate location server-side';
  END IF;
  IF v_in !~ 'GEOFENCE_BLOCKED' OR v_out !~ 'GEOFENCE_BLOCKED' THEN
    RAISE EXCEPTION 'assertion: a punch path does not enforce the evaluation';
  END IF;

  -- the caller's status/confidence must no longer be persisted
  IF v_in ~ 'location_status\) VALUES' AND v_in ~ 'p_loc_status, p_acc' THEN
    RAISE EXCEPTION 'assertion: punch_in still persists the client location_status';
  END IF;
  IF v_out ~ 'location_status = p_loc_status' THEN
    RAISE EXCEPTION 'assertion: punch_out still persists the client location_status';
  END IF;
  IF v_out ~ 'location_confidence = p_confidence' THEN
    RAISE EXCEPTION 'assertion: punch_out still persists the client confidence';
  END IF;

  -- statements this migration must not have disturbed
  IF v_out !~ 'short_break_limit_minutes' OR v_out !~ 'break_deduction_mode' THEN
    RAISE EXCEPTION 'assertion: punch_out break handling was lost';
  END IF;
  IF v_out !~ 'PAYROLL_LOCKED' OR v_in !~ 'PAYROLL_LOCKED' THEN
    RAISE EXCEPTION 'assertion: a payroll lock guard was lost';
  END IF;
  IF v_in !~ 'ALREADY_PUNCHED_IN' THEN
    RAISE EXCEPTION 'assertion: punch_in open-session guard was lost';
  END IF;

  IF v_save !~ 'no active office location is configured' THEN
    RAISE EXCEPTION 'assertion: the geofence config guard was not repointed at office_locations';
  END IF;
  IF v_save ~ 'office lat/lng are missing' THEN
    RAISE EXCEPTION 'assertion: the old single-point geofence guard is still present';
  END IF;
END;
$assert$;
