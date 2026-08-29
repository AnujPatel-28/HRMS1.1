-- B7c step 1 — move punch-out's evidence write out of the client and into
-- punch_out_attendance, exactly as 20260829110000 did for punch_in_attendance.
--
-- ============================================================================
-- THE GAP
-- ============================================================================
-- PunchInOut.tsx runPunchOutDb calls db.rpc("punch_out_attendance", ...) and then does a
-- SEPARATE client db.from("attendance").update({...}) writing:
--
--   location_accuracy      numeric  -- generic "last known" accuracy (also duplicated onto
--                                    -- punch_out_location_accuracy by the RPC itself already)
--   location_confidence    text     -- GPS quality band
--   location_status        text     -- generic "last known" status  (ditto, vs
--                                    -- punch_out_location_status)
--   remote_exception_id    uuid     -- the approved remote-work exception justifying an
--                                    -- out-of-geofence punch
--   verification_snapshot  jsonb    -- geofence + selfie evidence captured at punch time
--
-- That client UPDATE is the direct write path B7c exists to revoke -- it runs the moment
-- narrowing lands (B7c step 3), since it depends on a blanket employee UPDATE grant that step
-- is about to remove. It must move into the RPC first, or punch-out evidence breaks for every
-- employee the instant that grant narrows (plan doc, B7c ordering rule).
--
-- Verified live (pg_get_functiondef, fetched fresh for this migration): the deployed
-- punch_out_attendance ALREADY receives p_acc and p_loc_status and already writes them into
-- punch_out_location_accuracy / punch_out_location_status -- but it does NOT write the generic
-- location_accuracy / location_status columns the client's follow-up UPDATE also sets. So of
-- the five columns the client update touches, two need no new parameter (p_acc and
-- p_loc_status already carry the values, mirroring what 20260829110000 did for punch-in, which
-- writes both punch_in_location_* and generic location_* from the same p_acc/p_loc_status) and
-- three are genuinely new: location_confidence, remote_exception_id, verification_snapshot.
--
-- The B7b/B7c agents correctly REFUSED to close this with a client-side .update() staying in
-- place: that is exactly the direct write path B7c exists to revoke, and it fails silently the
-- moment employee-role UPDATE on attendance is narrowed. The fix belongs in the RPC.
--
-- ============================================================================
-- WHY DROP + CREATE, AND WHY IT IS SAFE WITH LIVE CALLERS
-- ============================================================================
-- The three new parameters are trailing and defaulted. CREATE OR REPLACE would therefore
-- create a SECOND overload rather than replace the function, and a client calling the old
-- 6-argument arity against two overloads is a landmine (the exact failure DROP + CREATE
-- avoids, per 20260829110000's precedent). So this is DROP + CREATE, and the grants are
-- RE-ISSUED explicitly because DROP does not preserve an ACL.
--
-- UNLIKE punch_in_attendance (which had zero callers when it was extended), punch_out_
-- attendance HAS live callers: the deployed production client calls the 6-arg form today.
-- That is safe here for a structural reason, not a timing one: PostgREST always calls
-- Postgres functions with NAMED arguments, never positionally. A request naming exactly
-- p_attendance_id, p_tenant_id, p_lat, p_lng, p_acc, p_loc_status resolves against the
-- 9-parameter function below just as it resolved against the 6-parameter one, because the
-- three new parameters are DEFAULT NULL and are simply omitted from that call. There is no
-- second overload for it to resolve against ambiguously -- the old signature no longer exists
-- after the DROP, and the DROP + CREATE happens inside one migration transaction, so no
-- external caller ever observes a moment where punch_out_attendance does not exist at all.
-- The still-deployed 6-arg-calling frontend keeps working unmodified; the new evidence
-- parameters simply come through as NULL until the frontend change below ships.
--
-- Everything else about the function is UNCHANGED, byte for byte: the session lock, the
-- ownership assertion (C3), the server-side policy derivation (C1), the payroll-lock guard,
-- the task gate, the break/work-hours computation, the overtime write, the jsonb envelope and
-- every exception mapping. The body below is the deployed body (fetched live via
-- pg_get_functiondef immediately before writing this migration) with exactly two edits:
-- three parameters added to the signature, and five columns (location_accuracy,
-- location_confidence, location_status, remote_exception_id, verification_snapshot) added to
-- the UPDATE column list in step 6 (two of them reusing the existing p_acc/p_loc_status
-- parameters, three reusing the three new ones).
--
-- Binding rules honoured: SECURITY DEFINER (unchanged -- this function has no fence to restore
-- by hand; it never checked can_access_tenant/tenant_has_module_for on the parent surface --
-- that is a pre-existing shape not touched here). No current_date and no now()::date beyond
-- what the deployed body already did. No attendance_events row is edited or deleted and no
-- write policy is added to it (D11). Module independence preserved -- the payroll-lock check
-- stays behind the same tenant_settings lookup it already used, untouched. No
-- BEGIN/COMMIT/ROLLBACK in this file. No frontend file is touched by this migration (that is
-- step 4, done outside the SQL migration below).

DROP FUNCTION IF EXISTS public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.punch_out_attendance(
  p_attendance_id uuid,
  p_tenant_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_acc numeric,
  p_loc_status text,
  p_confidence text DEFAULT NULL,
  p_remote_exception_id uuid DEFAULT NULL,
  p_verification_snapshot jsonb DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  UPDATE attendance
  SET punch_out             = v_now,
      work_hours            = v_work_hours,
      session_status        = 'closed',
      punch_out_lat         = p_lat,
      punch_out_lng         = p_lng,
      punch_out_location_accuracy = p_acc,
      punch_out_location_status   = p_loc_status,
      location_accuracy     = p_acc,
      location_status       = p_loc_status,
      location_confidence   = p_confidence,
      remote_exception_id   = p_remote_exception_id,
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

REVOKE EXECUTE ON FUNCTION public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text, text, uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text, text, uuid, jsonb) IS
'Punch out (B2, extended 20260829120000 for B7c step 1). Derives lunch minutes, overtime enablement, overtime rate and expected shift hours SERVER-SIDE from tenants/tenant_settings/shifts, asserts the caller owns the attendance row (or is HR), and now persists the evidence fields the pre-B7c client used to write via a follow-up direct UPDATE: location_accuracy/location_status (from the pre-existing p_acc/p_loc_status), plus the three trailing parameters p_confidence, p_remote_exception_id and p_verification_snapshot into location_confidence, remote_exception_id and verification_snapshot. The three new parameters are DEFAULT NULL, so the still-deployed 6-named-argument caller keeps resolving against this signature unchanged (PostgREST calls by name, and the old 6-arg signature no longer exists after this migration''s DROP + CREATE). Returns a jsonb envelope: {success:true, work_hours, overtime_hours, updated_row_count} or {success:false, reason, errcode}.';

-- ====================================================================
-- VERIFICATION
-- ====================================================================
-- Comments are stripped before every source match below: a comment is part of pg_get_functiondef,
-- and an assertion that forgets that matches its own explanation and proves nothing.

DO $pout_check$
DECLARE
  v_def      text;
  v_def_norm text;
  v_n        integer;
BEGIN
  -- Exactly ONE overload must exist. Two would mean the DROP did not take and CREATE added a
  -- second signature -- the precise failure this migration used DROP + CREATE to avoid.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OVERLOAD FAILED: expected exactly 1 punch_out_attendance, got %', v_n;
  END IF;

  -- and it must be the NEW signature.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance'
      AND pg_get_function_identity_arguments(p.oid) =
          'p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_confidence text, p_remote_exception_id uuid, p_verification_snapshot jsonb'
  ) THEN
    RAISE EXCEPTION 'SIGNATURE FAILED: punch_out_attendance does not have the extended signature';
  END IF;

  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance';

  -- Whitespace-normalised copy for the SET-clause checks below: the SET clause is hand-aligned
  -- for readability (variable run lengths of spaces before each '='), so matching against the
  -- literal source would be brittle. Collapsing every run of whitespace to a single space makes
  -- the probe robust to that alignment without weakening what it proves.
  v_def_norm := regexp_replace(v_def, '\s+', ' ', 'g');

  -- The five evidence columns must be WRITTEN, not merely accepted as parameters. Checking the
  -- UPDATE column list (via the SET clause) rather than the parameter names is the difference
  -- between "the RPC takes a selfie snapshot" and "the RPC stores it".
  IF position('location_accuracy = p_acc' in v_def_norm) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE FAILED: location_accuracy is not written from p_acc';
  END IF;
  IF position('location_status = p_loc_status' in v_def_norm) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE FAILED: location_status is not written from p_loc_status';
  END IF;
  IF position('location_confidence = p_confidence' in v_def_norm) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE FAILED: location_confidence is not written from p_confidence';
  END IF;
  IF position('remote_exception_id = p_remote_exception_id' in v_def_norm) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE FAILED: remote_exception_id is not written from p_remote_exception_id';
  END IF;
  IF position('verification_snapshot = p_verification_snapshot' in v_def_norm) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE FAILED: verification_snapshot is not written from p_verification_snapshot';
  END IF;

  -- The punch_out_-prefixed evidence columns must still be written too (no double-write via a
  -- second parameter; they still come from the very same p_acc / p_loc_status).
  IF position('punch_out_location_accuracy = p_acc' in v_def_norm) = 0
     OR position('punch_out_location_status = p_loc_status' in v_def_norm) = 0 THEN
    RAISE EXCEPTION 'REGRESSION FAILED: the pre-existing punch_out_location_* writes were lost';
  END IF;

  -- The guards that were there before must still be there. A DROP + CREATE is exactly where a
  -- security seam gets quietly lost.
  IF position('NOT_YOUR_ATTENDANCE' in v_def) = 0
     OR position('INVALID_OPEN_SESSION' in v_def) = 0
     OR position('PAYROLL_LOCKED' in v_def) = 0
     OR position('TASK_GATE_BLOCKED' in v_def) = 0 THEN
    RAISE EXCEPTION 'GUARD FAILED: a pre-existing guard was lost in the rewrite';
  END IF;
  IF position('SECURITY DEFINER' in v_def) = 0 THEN
    RAISE EXCEPTION 'GUARD FAILED: punch_out_attendance is no longer SECURITY DEFINER';
  END IF;
  -- Module independence: the payroll lock stays a plain tenant_settings lookup, unchanged --
  -- this function never gated it behind tenant_has_module_for(tenant,'payroll') even before
  -- this migration, so this probe only proves the lookup itself was not deleted.
  IF position('payroll_lock_date' in v_def) = 0 THEN
    RAISE EXCEPTION 'REGRESSION FAILED: the payroll lock date lookup was lost';
  END IF;
  -- Overtime write must still be gated behind v_overtime_enabled, untouched.
  IF position('overtime_records' in v_def) = 0 THEN
    RAISE EXCEPTION 'REGRESSION FAILED: the overtime write was lost';
  END IF;

  -- Grants must have been re-issued: DROP does not preserve an ACL.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance'
    AND array_to_string(p.proacl, ' ') LIKE '%authenticated=X%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'GRANTS FAILED: authenticated cannot execute punch_out_attendance';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance'
    AND array_to_string(p.proacl, ' ') LIKE '%anon=%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'GRANTS FAILED: anon can execute punch_out_attendance';
  END IF;

  RAISE NOTICE 'punch_out_attendance verified: one overload, extended signature, five evidence columns written, punch_out_-prefixed columns preserved, all pre-existing guards intact, authenticated-only';
END
$pout_check$;
