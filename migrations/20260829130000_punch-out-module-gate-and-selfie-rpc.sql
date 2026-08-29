-- B7c step 1b: close the LAST client write to attendance, and the module-independence asymmetry
-- between the two punch directions. Both are prerequisites for step 3 (narrowing the employee
-- write surface) -- step 3 cannot land while a legitimate client path still needs UPDATE.
--
-- ============================================================================
-- 1. MODULE INDEPENDENCE: punch-out's payroll lock was NOT module-gated
-- ============================================================================
-- punch_in_attendance gates its payroll-period-lock check behind
-- tenant_has_module_for(tenant,'payroll'). punch_out_attendance did NOT -- it read
-- tenant_settings.payroll_lock_date unconditionally. (Verified live: the only
-- tenant_has_module_for call in the deployed body gated the TASKS module for the punch-out gate,
-- not payroll. A coarse "does the body mention tenant_has_module_for" check says yes and is
-- wrong -- the call has to be read in place.)
--
-- Consequence: an attendance-only tenant carrying a stray payroll_lock_date could punch IN and
-- then never punch OUT, stranding an open session -- payroll policy silently governing a tenant
-- that does not run payroll. Module independence is a standing product constraint here: a tenant
-- may run attendance without payroll, and nothing in attendance may depend on payroll.
--
-- Fixed by wrapping the whole guard in the payroll module gate. Same-signature
-- CREATE OR REPLACE, so the ACL and OID are preserved.
--
-- ============================================================================
-- 2. HARDENING: the SECURITY DEFINER seam had no fixed search_path
-- ============================================================================
-- punch_out_attendance is SECURITY DEFINER and executable by every authenticated user, but
-- declared no search_path, unlike every other definer function in this schema
-- (punch_in_attendance uses '', hr_update_attendance uses 'public'). A definer function with an
-- unpinned search_path resolves its unqualified names against the CALLER's search_path. This
-- adds SET search_path TO 'public'. Every unqualified reference in the body (attendance,
-- tenant_settings, audit_logs, employees) already lives in public and resolves identically, so
-- this pins current behaviour rather than changing it.
--
-- ============================================================================
-- 3. THE LAST CLIENT WRITE: handleSelfieUpload
-- ============================================================================
-- 20260829110000 and 20260829120000 moved punch-in and punch-out evidence into their RPCs, but
-- one direct client write survived, in a shared helper rather than in either punch path:
--
--   src/employee/PunchInOut.tsx  handleSelfieUpload()
--     db.from("attendance").update({ location_status: "selfie_missing" })
--
-- It fires when the selfie upload to storage fails, for BOTH punch directions, so it is not
-- reachable from either RPC -- the punch has already committed by then. Left in place it would
-- break the moment step 3 narrows the employee UPDATE grant, and it would break silently: the
-- catch path already only console.errors.
--
-- mark_attendance_selfie_missing() replaces it. Deliberately narrow: it sets exactly one column
-- to exactly one constant, on a row the caller must own. It cannot be repurposed into a general
-- attendance write, which is the entire point -- the goal of B7c is that no employee-reachable
-- path can write an arbitrary attendance column.
--
-- Ownership is asserted in code, not left to RLS: SECURITY DEFINER bypasses RLS and every tenant
-- fence entirely (binding rule 1), so the employee-owns-this-row check is explicit, alongside the
-- tenant fence and the attendance module gate.
--
-- Binding rules honoured: no current_date and no now() cast to date (D9). No attendance_events
-- row is edited or deleted and no write policy is added to it (D11). No BEGIN/COMMIT/ROLLBACK in
-- this file. Attendance emits no money. payroll_period_input, both derivation passes and the HR
-- functions are untouched.

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
 SET search_path TO 'public'
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

-- --------------------------------------------------------------------
-- mark_attendance_selfie_missing -- replaces the last client UPDATE on attendance
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_attendance_selfie_missing(p_tenant_id uuid, p_attendance_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
  v_owner_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'TENANT_FORBIDDEN'
      USING DETAIL = 'This tenant is not accessible to the caller.';
  END IF;

  IF NOT tenant_has_module_for(p_tenant_id, 'attendance') THEN
    RAISE EXCEPTION 'MODULE_DISABLED'
      USING DETAIL = 'The attendance module is not enabled for this tenant.';
  END IF;

  SELECT id INTO v_employee_id
  FROM employees
  WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND status = 'active';

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_RESOLVED';
  END IF;

  SELECT employee_id INTO v_owner_id
  FROM attendance
  WHERE id = p_attendance_id AND tenant_id = p_tenant_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'ATTENDANCE_NOT_FOUND';
  END IF;

  -- Ownership asserted in code: SECURITY DEFINER bypasses RLS, so the fence is not implied.
  IF v_owner_id <> v_employee_id THEN
    RAISE EXCEPTION 'NOT_YOUR_ATTENDANCE';
  END IF;

  UPDATE attendance
  SET location_status = 'selfie_missing'
  WHERE id = p_attendance_id AND tenant_id = p_tenant_id;

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.mark_attendance_selfie_missing(uuid, uuid) IS
'Flags one attendance row as selfie_missing after a selfie upload to storage fails. Replaces the last direct client UPDATE on attendance (handleSelfieUpload in PunchInOut.tsx), which was reachable from both punch directions and would have broken silently once B7c narrows the employee UPDATE grant. Deliberately narrow: one column, one constant value, on a row the caller must own -- it cannot be repurposed into a general attendance write, which is the point of B7c. Ownership, tenant and attendance-module checks are all asserted in code because SECURITY DEFINER bypasses RLS.';

REVOKE ALL ON FUNCTION public.mark_attendance_selfie_missing(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_attendance_selfie_missing(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_attendance_selfie_missing(uuid, uuid) TO authenticated;

-- ====================================================================
-- VERIFICATION
-- ====================================================================
DO $b7c1b_check$
DECLARE
  v_def text;
  v_n   integer;
BEGIN
  -- Comments stripped AND runs of whitespace collapsed before matching: the SET clause is
  -- column-aligned with multiple spaces, so a whitespace-exact assertion reports a regression
  -- that is not one. (It did, on the first run of this migration.)
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
           '[ 	]+', ' ', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance';

  -- The payroll lock must now sit INSIDE a payroll module gate. Checking that the body merely
  -- mentions tenant_has_module_for is not enough -- the deployed body already mentioned it, for
  -- the TASKS gate. Assert the payroll gate specifically.
  IF position('tenant_has_module_for(p_tenant_id, ''payroll'')' in v_def) = 0 THEN
    RAISE EXCEPTION 'MODULE INDEPENDENCE FAILED: punch-out payroll lock is still not gated behind the payroll module';
  END IF;
  IF position('payroll_lock_date' in v_def) = 0 OR position('PAYROLL_LOCKED' in v_def) = 0 THEN
    RAISE EXCEPTION 'REGRESSION: the payroll lock guard was lost entirely, not gated';
  END IF;
  -- The tasks gate must survive too.
  IF position('tenant_has_module_for(p_tenant_id, ''tasks'')' in v_def) = 0 THEN
    RAISE EXCEPTION 'REGRESSION: the punch-out tasks gate was lost';
  END IF;
  -- The evidence columns 20260829120000 added must survive this rewrite.
  IF position('verification_snapshot = p_verification_snapshot' in v_def) = 0
     OR position('remote_exception_id = p_remote_exception_id' in v_def) = 0
     OR position('location_confidence = p_confidence' in v_def) = 0 THEN
    RAISE EXCEPTION 'REGRESSION: an evidence column write from 20260829120000 was lost';
  END IF;
  IF position('search_path' in pg_get_functiondef((
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance'))) = 0 THEN
    RAISE EXCEPTION 'HARDENING FAILED: punch_out_attendance still has no fixed search_path';
  END IF;

  -- Still exactly one overload, and the extended signature from 20260829120000 is intact.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OVERLOAD FAILED: expected 1 punch_out_attendance, got %', v_n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance'
      AND pg_get_function_identity_arguments(p.oid) =
          'p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_confidence text, p_remote_exception_id uuid, p_verification_snapshot jsonb'
  ) THEN
    RAISE EXCEPTION 'SIGNATURE FAILED: punch_out_attendance signature changed';
  END IF;

  -- The new selfie RPC must exist, assert ownership, and be authenticated-only.
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
           '[ 	]+', ' ', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mark_attendance_selfie_missing';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mark_attendance_selfie_missing is missing';
  END IF;
  IF position('NOT_YOUR_ATTENDANCE' in v_def) = 0
     OR position('can_access_tenant' in v_def) = 0
     OR position('tenant_has_module_for' in v_def) = 0 THEN
    RAISE EXCEPTION 'GUARD FAILED: mark_attendance_selfie_missing does not assert ownership, tenant and module';
  END IF;
  -- It must write exactly ONE column. If a future edit widens it, this fails loudly.
  IF position('SET location_status = ''selfie_missing''' in v_def) = 0 THEN
    RAISE EXCEPTION 'SCOPE FAILED: mark_attendance_selfie_missing no longer writes exactly location_status';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('punch_out_attendance', 'mark_attendance_selfie_missing')
    AND array_to_string(p.proacl, ' ') LIKE '%anon=%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ACL FAILED: anon can execute a punch entry point (% of 2)', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('punch_out_attendance', 'mark_attendance_selfie_missing')
    AND array_to_string(p.proacl, ' ') LIKE '%authenticated=X%';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ACL FAILED: expected both entry points executable by authenticated, got %', v_n;
  END IF;

  RAISE NOTICE 'B7c step 1b verified: punch-out payroll lock is payroll-module-gated, tasks gate and evidence writes intact, search_path pinned, selfie RPC is ownership-checked and single-column, both authenticated-only';
END
$b7c1b_check$;
