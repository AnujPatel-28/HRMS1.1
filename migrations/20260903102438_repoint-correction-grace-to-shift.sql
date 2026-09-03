-- Group B, item 1 -- one definition of "late".
--
-- attendance_derive_pass1 decides lateness from the SHIFT:
--     v_shift.enable_late_entry_marking
--       AND in_time > shift_start + make_interval(mins => v_shift.late_entry_grace_minutes)
--
-- hr_approve_attendance_correction decided it from tenant_settings.late_mark_grace_minutes,
-- anchored on the shift's start_time. Both write attendance.is_late / late_entry.
--
-- These never raced: this function sets is_locked and Pass 1 skips locked rows (D5). But within
-- one employee-month a CORRECTED day and a DERIVED day were judged by two different grace
-- values, and calculate-late-marks sums both into a single salary deduction. Which definition
-- applied to a given day depended only on whether HR happened to touch it.
--
-- After this migration the shift is the single source. The tenant_settings key survives ONLY as
-- the fallback for a tenant with no shift at all (9 of 15 tenants today) -- the same situation in
-- which start_time already falls back to tenants.punch_in_start, and in which the scheduled
-- derivation does not run either.
--
-- The shift's enable_late_entry_marking is now honoured too, so a shift with late marking off can
-- no longer produce a late day through the correction path.
--
-- Body derived from the deployed definition with four targeted edits; every other statement --
-- derivation_source = 'correction', the audit payload, the notifications insert and the return
-- shape -- is byte-identical to what was live.

CREATE OR REPLACE FUNCTION public.hr_approve_attendance_correction(p_tenant_id uuid, p_correction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_correction attendance_corrections%ROWTYPE;
  v_attendance attendance%ROWTYPE;
  v_tenant tenants%ROWTYPE;
  v_shift_start time;
  v_shift_grace integer;
  v_shift_late_enabled boolean;
  v_shift_found boolean := false;
  v_effective_in time;
  v_effective_out time;
  v_punch_in timestamptz;
  v_punch_out timestamptz;
  v_raw_hours numeric;
  v_work_hours numeric;
  v_lunch_minutes integer;
  v_grace_minutes integer;
  v_is_late boolean;
  v_row_count integer;
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

  SELECT count(*) INTO v_row_count
  FROM attendance a
  WHERE a.tenant_id = p_tenant_id
    AND a.employee_id = v_correction.employee_id
    AND a.date = v_correction.attendance_date;

  IF v_row_count > 1 THEN
    RAISE EXCEPTION 'Attendance for % has % shift rows and a correction request cannot name a shift. Edit the specific shift row from the attendance table instead.',
      v_correction.attendance_date, v_row_count;
  END IF;

  SELECT a.* INTO v_attendance
  FROM attendance a
  WHERE a.tenant_id = p_tenant_id
    AND a.employee_id = v_correction.employee_id
    AND a.date = v_correction.attendance_date
  FOR UPDATE;

  v_before := CASE WHEN v_attendance.id IS NULL THEN NULL ELSE to_jsonb(v_attendance) END;

  SELECT s.start_time, s.late_entry_grace_minutes, s.enable_late_entry_marking
    INTO v_shift_start, v_shift_grace, v_shift_late_enabled
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = p_tenant_id
    AND es.employee_id = v_correction.employee_id
    AND es.effective_from <= v_correction.attendance_date
    AND (es.effective_to IS NULL OR es.effective_to >= v_correction.attendance_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;
  v_shift_found := FOUND;

  IF NOT v_shift_found THEN
    SELECT s.start_time, s.late_entry_grace_minutes, s.enable_late_entry_marking
      INTO v_shift_start, v_shift_grace, v_shift_late_enabled
    FROM shifts s
    WHERE s.tenant_id = p_tenant_id
      AND s.is_default = true
      AND s.is_active IS NOT FALSE
    LIMIT 1;
    v_shift_found := FOUND;
  END IF;

  IF v_shift_found THEN
    v_grace_minutes := COALESCE(v_shift_grace, 0);
  ELSE
    v_shift_late_enabled := true;
    SELECT COALESCE(NULLIF(value, '')::integer, 0) INTO v_grace_minutes
    FROM tenant_settings
    WHERE tenant_id = p_tenant_id
      AND key = 'late_mark_grace_minutes';
    v_grace_minutes := COALESCE(v_grace_minutes, 0);
  END IF;

  v_shift_late_enabled := COALESCE(v_shift_late_enabled, true);
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
    WHEN NOT v_shift_late_enabled THEN false
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
      is_late, late_entry, status, punch_out_allowed, session_status,
      is_locked, derivation_source
    )
    VALUES (
      p_tenant_id, v_correction.employee_id, v_correction.attendance_date,
      v_punch_in, v_punch_out, v_work_hours, v_is_late, v_is_late, 'present', true,
      CASE WHEN v_punch_out IS NULL THEN 'open' ELSE 'closed' END,
      true, 'correction'
    )
    RETURNING * INTO v_attendance;
  ELSE
    UPDATE attendance
    SET punch_in = COALESCE(v_punch_in, punch_in),
        punch_out = COALESCE(v_punch_out, punch_out),
        work_hours = COALESCE(v_work_hours, work_hours),
        is_late = v_is_late,
        late_entry = v_is_late,
        is_locked = true,
        derivation_source = 'correction',
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
$function$;

-- ---------------------------------------------------------------------------
-- Assertions. Comments are stripped and whitespace collapsed first (a column-
-- aligned clause does not match a single-spaced pattern), and the checks are
-- regex rather than LIKE because `_` is a LIKE wildcard.
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  v_body text;
BEGIN
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
           '\s+', ' ', 'g')
    INTO v_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'hr_approve_attendance_correction';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'assertion: hr_approve_attendance_correction is missing';
  END IF;

  IF v_body !~ 'late_entry_grace_minutes' THEN
    RAISE EXCEPTION 'assertion: the correction path does not read the shift grace';
  END IF;

  IF v_body !~ 'WHEN NOT v_shift_late_enabled THEN false' THEN
    RAISE EXCEPTION 'assertion: the shift late-marking switch is not honoured';
  END IF;

  -- tenant_settings grace may remain, but only inside the no-shift fallback arm.
  IF v_body ~ 'late_mark_grace_minutes' AND v_body !~ 'IF v_shift_found THEN' THEN
    RAISE EXCEPTION 'assertion: tenant_settings grace is read outside the no-shift fallback';
  END IF;

  -- Guard the statements this migration must NOT have altered.
  IF v_body !~ 'derivation_source = ''correction''' THEN
    RAISE EXCEPTION 'assertion: derivation_source value changed';
  END IF;
  IF v_body !~ 'INSERT INTO notifications' THEN
    RAISE EXCEPTION 'assertion: the employee notification was dropped';
  END IF;
  IF v_body !~ 'attendance_correction.approved' THEN
    RAISE EXCEPTION 'assertion: the audit action name changed';
  END IF;
END;
$assert$;
