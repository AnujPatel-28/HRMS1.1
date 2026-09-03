-- Fixes a regression introduced by 20260903110429, found while simplifying PunchInOut.tsx.
--
-- That migration made the server's location verdict authoritative and stopped persisting the
-- caller's p_loc_status. Correct for a LOCATION verdict -- a client must not be able to assert
-- 'office_verified'. But `selfie_missing` is not a location verdict; it shares the column. The
-- client sets it when a REQUIRED selfie was never captured, and the server's evaluator knows
-- nothing about selfies, so it was overwriting the flag with 'office_verified'.
--
-- (The other selfie path still worked: mark_attendance_selfie_missing is called separately when a
-- selfie UPLOAD fails after the punch. Only the never-captured case was being lost.)
--
-- Rule: the server's verdict wins, EXCEPT that the caller may flag 'selfie_missing'. That
-- asymmetry is safe by construction -- the flag can only ever make the record worse, never claim
-- a verification that did not happen, which is the property that made trusting p_loc_status
-- unacceptable in the first place.

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
    p_lat, p_lng, p_acc, CASE WHEN p_loc_status = 'selfie_missing' THEN 'selfie_missing' ELSE v_loc.loc_status END,
    p_acc, CASE WHEN p_loc_status = 'selfie_missing' THEN 'selfie_missing' ELSE v_loc.loc_status END, v_tenant_tz,
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
      punch_out_location_status   = CASE WHEN p_loc_status = 'selfie_missing' THEN 'selfie_missing' ELSE v_loc.loc_status END,
      location_accuracy     = p_acc,
      location_status       = CASE WHEN p_loc_status = 'selfie_missing' THEN 'selfie_missing' ELSE v_loc.loc_status END,
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

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  v_in text; v_out text;
BEGIN
  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_in  FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='punch_in_attendance';
  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_out FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='punch_out_attendance';

  IF v_in !~ 'WHEN p_loc_status = ''selfie_missing''' THEN
    RAISE EXCEPTION 'assertion: punch_in no longer preserves the selfie_missing flag';
  END IF;
  IF v_out !~ 'WHEN p_loc_status = ''selfie_missing''' THEN
    RAISE EXCEPTION 'assertion: punch_out no longer preserves the selfie_missing flag';
  END IF;

  -- the server must still be authoritative for every OTHER status
  IF v_in !~ 'attendance_evaluate_location' OR v_out !~ 'attendance_evaluate_location' THEN
    RAISE EXCEPTION 'assertion: a punch path stopped evaluating location server-side';
  END IF;
  IF v_in !~ 'GEOFENCE_BLOCKED' OR v_out !~ 'GEOFENCE_BLOCKED' THEN
    RAISE EXCEPTION 'assertion: a punch path stopped enforcing the evaluation';
  END IF;
END;
$assert$;
