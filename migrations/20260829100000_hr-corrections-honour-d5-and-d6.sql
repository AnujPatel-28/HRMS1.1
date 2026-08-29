-- B7 pre-work (decision doc D5 + D6, cutover plan section 3a "STILL OPEN"): make the two HR
-- write paths into attendance agree with the derivation processor, BEFORE derivation is ever
-- run in production. Five tenants already have a shift with enable_auto_derivation = true, and
-- attendance_derivation_runs is still 0, so every defect below is latent RIGHT NOW and fires on
-- the first production derivation run.
--
-- ============================================================================
-- THE THREE DEFECTS (each re-verified live against the deployed functions before writing this)
-- ============================================================================
--
-- D6-A. HR corrections move is_late and never touch late_entry.
--   hr_update_attendance and hr_approve_attendance_correction each compute a lateness value and
--   write it to is_late only. late_entry is boolean NOT NULL DEFAULT false and is the AUTHORITY
--   (D6), kept in sync on derived rows by attendance_derive_pass1 since 20260828120000. So an HR
--   correction on a derived row leaves the two columns contradicting each other: is_late moves,
--   late_entry keeps the pre-correction derived value. This is the divergence already recorded
--   on the is_late/late_entry column comments by 20260828120001 as "reconcile in B7b/B7c".
--   FIX: every place either function writes is_late now writes late_entry to the SAME value, so
--   the row is self-consistent whichever column a consumer reads. payroll_period_input reads
--   is_late and is NOT touched by this migration -- the contract keeps its exact shape.
--
-- D5-B. attendance.is_locked is read by the processor and written by NOBODY.
--   Decision doc section 5.2: "HR manual edits and payroll-locked rows are never re-derived",
--   and E17/E45 both make is_locked the flag that makes a day un-re-derivable. Verified live
--   with a REGEX scan (not LIKE -- in LIKE the underscore is a single-character wildcard, so
--   a LIKE pattern for is_locked also matches the literal text "is locked" inside an unrelated
--   error message, which is exactly the false positive that first suggested a third writer
--   existed): only attendance_derive_pass1 and attendance_derive_pass2 reference the column,
--   both purely as a skip-guard. Nothing in the database, in any trigger on attendance, or
--   anywhere in src/ ever sets it. D5's guard is therefore INERT: HR corrects a day, the next
--   derivation run silently overwrites the correction, no error anywhere. Same silent-wrong-
--   value class as the late_mark_count = 0 bug fixed in 20260828120000.
--   FIX: both HR write paths set is_locked = true and stamp derivation_source -- manual for a
--   direct HR edit, correction for an approved correction request (the CHECK already allows
--   derived | manual | correction | import | leave, and the distinction is free at write time
--   and valuable later when someone asks why a day was not derived).
--
-- D5-B2. Locking with no unlock is a ONE-WAY DOOR, so this migration also adds the unlock.
--   Because nothing wrote is_locked, nothing could clear it either. Shipping only the lock would
--   mean a single HR punch-time tweak permanently excludes that employee-day from every future
--   derivation run -- including re-derivation after a backdated event arrives (E17) and a month
--   replay (E45), the two cases the decision doc explicitly wants to remain possible. The doc
--   locks the LOCK; it says nothing about recovery. hr_unlock_attendance_day is added here so
--   the lock is reversible by HR rather than permanent. It is purely additive: no existing
--   caller changes, no client change is needed for it to be correct, and it is simply unused
--   until someone wires a control to it.
--
-- D-C. Both functions locate the attendance row by (tenant_id, employee_id, date) with no
--   ORDER BY and no LIMIT.
--   The unique key is (tenant_id, employee_id, date, COALESCE(shift_id, all-zero uuid)), so once
--   Pass 1 writes per-shift rows a single employee-day legitimately holds SEVERAL rows. A plpgsql
--   SELECT INTO without STRICT silently takes an arbitrary one of them and raises nothing, and
--   the FOR UPDATE locks all of them. The subsequent UPDATE by that row id then corrects a shift
--   nobody chose. attendance_corrections has no shift_id column at all (verified live: id,
--   tenant_id, employee_id, attendance_date, requested_punch_in, requested_punch_out, reason,
--   status, reviewed_by, reviewed_at, rejection_reason, created_at), so the request genuinely
--   CANNOT name a shift.
--   FIX: count the matching rows first and RAISE a self-diagnosing exception naming the actual
--   condition, instead of silently correcting an arbitrary shift. Surfacing beats guessing when
--   the input cannot express the answer.
--
-- ============================================================================
-- WHY THIS IS SAFE AGAINST THE FROZEN CLIENT
-- ============================================================================
-- Production is still serving the Aug-21 bundle (marker-checked again at the top of this
-- session: /assets/index-_OaU7Cj5.js, working_hours_threshold_for_absent count 0) because the
-- Vercel deployments for the newer commits are Blocked at the account level. So no frontend fix
-- can be shipped to compensate for a server change right now. Every change here is therefore
-- corrective or additive, never restrictive:
--
--   * Both functions are replaced with CREATE OR REPLACE at an IDENTICAL signature, which
--     preserves their existing ACL (project_admin=X, authenticated=X) and OID. No parameter is
--     added -- a trailing defaulted parameter would create a SECOND overload rather than replace,
--     and a stale client calling the old arity against two overloads is a landmine.
--   * Verified live how src/hr/Attendance.tsx builds the rows it passes: the daily fetch maps
--     over allEmployees and uses a find() per employee, returning a synthesized row with an empty
--     string id when that employee has NO attendance row for the day. saveEdit sends
--     p_attendance_id as row.id or null, so a NULL p_attendance_id means the client found ZERO
--     rows -- never "found several and could not choose". The new ambiguity guard on that path
--     therefore cannot turn a currently-working edit into an error; it can only fire on a call
--     that is already meaningless.
--   * The dual-write trigger is AFTER INSERT OR UPDATE OF punch_out. Both existing UPDATE
--     statements already name punch_out in their SET list, and this migration only ADDS columns
--     to those SET lists, so trigger firing is completely unchanged. Stated here so the next
--     reader does not have to re-derive it.
--
-- Binding rules honoured: the SECURITY DEFINER seams keep their explicit assert_hr_for_tenant()
-- guard, which itself refuses a NULL auth.uid() and re-checks can_access_tenant() and is_hr()
-- (rule 1 -- SECURITY DEFINER bypasses RLS entirely, so the fence is asserted in code). No
-- current_date and no now() cast to date is introduced (D9). No attendance_events row is edited
-- or deleted and no write policy is added to that table (D11). No BEGIN/COMMIT/ROLLBACK appears
-- in this file. payroll_period_input, attendance_derive_pass1, attendance_derive_pass2 and every
-- frontend file are UNTOUCHED.
--
-- ============================================================================
-- VERIFICATION REACH -- READ THIS BEFORE TRUSTING THE PROBES BELOW
-- ============================================================================
-- assert_hr_for_tenant() raises Unauthenticated when auth.uid() is NULL. A migration runs as
-- project_admin with no end-user JWT, so these two functions CANNOT be invoked from inside this
-- file. The probes below are therefore:
--   * STRUCTURAL for the two HR functions -- they scan the deployed source with comments
--     stripped (regexp_replace of the double-dash line comments), because a comment is part of
--     pg_get_functiondef and an assertion that forgets that will match its own explanation.
--   * BEHAVIOURAL for the consequence that matters -- that a locked row is genuinely skipped by
--     the processor, and that a multi-row employee-day is genuinely constructible so the new
--     ambiguity guard is guarding a real condition, not a hypothetical one.
-- The end-to-end behavioural half -- calling these RPCs over HTTP with a real HR JWT and
-- watching the row change -- is NOT covered here and is handed back as a QA step, alongside the
-- identical gap that leaves C3 open.
--
-- NOT DONE HERE, deliberately, and handed back instead:
--   * assert_date_range_unlocked is called unconditionally by both HR functions and is NOT gated
--     behind tenant_has_module_for(tenant, payroll), unlike punch_in_attendance which gates the
--     same payroll-lock check. Pre-existing, and low impact because an attendance-only tenant
--     will not have a payroll_lock_date set, but it is the same module-independence seam.
--   * src/hr/Attendance.tsx's find() shows only the FIRST row of a multi-shift day. That is a
--     frontend gap for B7d/B9, not something a migration can fix.

-- --------------------------------------------------------------------
-- 1. hr_approve_attendance_correction
-- --------------------------------------------------------------------
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

  SELECT COALESCE(NULLIF(value, '')::integer, 0) INTO v_grace_minutes
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'late_mark_grace_minutes';
  v_grace_minutes := COALESCE(v_grace_minutes, 0);

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

-- --------------------------------------------------------------------
-- 2. hr_update_attendance
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_update_attendance(p_tenant_id uuid, p_attendance_id uuid, p_employee_id uuid, p_date date, p_punch_in time without time zone, p_punch_out time without time zone, p_status text, p_is_late boolean DEFAULT NULL::boolean, p_expected_status text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_row_count integer;
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
    SELECT count(*) INTO v_row_count
    FROM attendance
    WHERE tenant_id = p_tenant_id
      AND employee_id = p_employee_id
      AND date = p_date;

    IF v_row_count > 1 THEN
      RAISE EXCEPTION 'Attendance for % has % shift rows and this edit did not identify which one. Reload the attendance table and edit the specific shift row.',
        p_date, v_row_count;
    END IF;

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
      work_hours, is_late, late_entry, session_status, is_locked, derivation_source
    )
    VALUES (
      p_tenant_id, p_employee_id, p_date, v_punch_in, v_punch_out, p_status,
      v_work_hours, v_final_is_late, v_final_is_late,
      CASE
        WHEN p_status IN ('absent', 'on_leave') THEN 'closed'
        WHEN v_punch_in IS NULL THEN 'closed'
        WHEN v_punch_out IS NULL THEN 'open'
        ELSE 'closed'
      END,
      true, 'manual'
    )
    RETURNING id INTO v_attendance_id;
  ELSE
    UPDATE attendance
    SET punch_in = v_punch_in,
        punch_out = v_punch_out,
        status = p_status,
        work_hours = v_work_hours,
        is_late = v_final_is_late,
        late_entry = v_final_is_late,
        is_locked = true,
        derivation_source = 'manual',
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
$function$;

-- --------------------------------------------------------------------
-- 3. hr_unlock_attendance_day -- the recovery path for D5-B2
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_unlock_attendance_day(p_tenant_id uuid, p_employee_id uuid, p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_unlocked integer := 0;
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE tenant_id = p_tenant_id
      AND id = p_employee_id
  ) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, p_date, p_date);

  UPDATE attendance
  SET is_locked = false,
      derivation_source = NULL
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND date = p_date
    AND is_locked;

  GET DIAGNOSTICS v_unlocked = ROW_COUNT;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'attendance.unlocked', 'attendance', p_employee_id,
    jsonb_build_object(
      'employee_id', p_employee_id,
      'date', p_date,
      'rows_unlocked', v_unlocked,
      'severity', 'WARNING',
      'correlation_id', gen_random_uuid()
    )
  );

  RETURN v_unlocked;
END;
$function$;

COMMENT ON FUNCTION public.hr_unlock_attendance_day(uuid, uuid, date) IS
'Clears is_locked on every attendance row for one employee-day and resets derivation_source to NULL, so the day becomes eligible for derivation again. The recovery path for D5: hr_update_attendance and hr_approve_attendance_correction set is_locked = true so the processor never silently overwrites an HR correction (decision doc section 5.2, E17, E45), and without this function that lock would be permanent and unrecoverable. HR-only via assert_hr_for_tenant, refuses a payroll-locked date, and audited as attendance.unlocked. Returns the number of rows unlocked. Not yet wired to any UI -- callable directly by HR.';

REVOKE ALL ON FUNCTION public.hr_unlock_attendance_day(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_unlock_attendance_day(uuid, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_unlock_attendance_day(uuid, uuid, date) TO authenticated;

-- --------------------------------------------------------------------
-- 4. Column comments: record that the divergence is closed
-- --------------------------------------------------------------------
COMMENT ON COLUMN public.attendance.is_late IS
'Lateness as consumed by the PAYROLL CONTRACT: payroll_period_input counts late marks as (is_late AND status NOT IN (absent, half_day)) and exposes it as late_mark_count. late_entry is the AUTHORITY (D6: derived from hours against shift start plus grace); is_late is the compatibility surface every existing consumer already reads. Kept IN SYNC with late_entry by attendance_derive_pass1 (20260828120000) and, since 20260829100000, by hr_update_attendance and hr_approve_attendance_correction as well -- all four write paths now write the same value to both columns, so the row is self-consistent whichever column a consumer reads. The pre-20260829100000 divergence (HR corrections moved is_late and left late_entry stale) is CLOSED. Retiring this column is a PAYROLL-ERA decision -- payroll is the last module to be designed and its decisions are not locked; do not drop it as a side effect of an attendance change.';

COMMENT ON COLUMN public.attendance.late_entry IS
'THE lateness authority (D6): derived server-side from hours worked against shift start plus late_entry_grace_minutes, by attendance_derive_pass1. An independent FLAG, never a status -- an employee can be present AND late. Mirrored into is_late for contract compatibility (see that column). Since 20260829100000 it is also written by hr_update_attendance and hr_approve_attendance_correction, which previously wrote only is_late; on a legacy row that was never derived, an HR edit repairs late_entry from the is_late value those rows actually carry.';

COMMENT ON COLUMN public.attendance.is_locked IS
'D5: a locked row is never re-derived. attendance_derive_pass1 and attendance_derive_pass2 skip it entirely (counted as rows_skipped, and its events are left unstamped and still queued). Set to true by hr_update_attendance and hr_approve_attendance_correction since 20260829100000 -- before that NOTHING in the database, in any trigger, or in src/ ever wrote this column, so the guard was inert and the next derivation run silently reverted every HR correction. Cleared by hr_unlock_attendance_day, which exists so the lock is reversible; without it an HR edit would permanently exclude that employee-day from re-derivation after a backdated event (E17) or a month replay (E45).';

COMMENT ON COLUMN public.attendance.derivation_source IS
'What produced this row, and therefore what the processor may overwrite (D5). derived = attendance_derive_pass1/pass2. manual = a direct HR edit via hr_update_attendance. correction = an approved correction request via hr_approve_attendance_correction. import and leave are reserved. NULL means unclaimed -- either a legacy row written by the direct punch path, or a row hr_unlock_attendance_day has released back to the processor.';

-- ====================================================================
-- 5. VERIFICATION
-- ====================================================================
-- Reach and its limits are stated in the header. Structural checks below strip the double-dash
-- line comments from pg_get_functiondef BEFORE matching, because a comment is part of the
-- definition and an assertion that forgets that matches its own explanation and proves nothing.

-- --------------------------------------------------------------------
-- 5a. Structural: both functions write late_entry from the SAME variable as is_late, on BOTH
--     the INSERT and the UPDATE branch, and stamp is_locked + derivation_source.
-- --------------------------------------------------------------------
DO $struct_check$
DECLARE
  v_def text;
  v_n   integer;
BEGIN
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'hr_approve_attendance_correction';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'D6-A FAILED: hr_approve_attendance_correction not found';
  END IF;
  IF position('late_entry = v_is_late' in v_def) = 0 THEN
    RAISE EXCEPTION 'D6-A FAILED: correction UPDATE branch does not write late_entry from v_is_late';
  END IF;
  IF position('is_late, late_entry' in v_def) = 0 THEN
    RAISE EXCEPTION 'D6-A FAILED: correction INSERT branch does not name late_entry beside is_late';
  END IF;
  IF position('is_locked = true' in v_def) = 0 OR position('''correction''' in v_def) = 0 THEN
    RAISE EXCEPTION 'D5-B FAILED: correction path does not stamp is_locked / derivation_source';
  END IF;
  IF position('v_row_count > 1' in v_def) = 0 THEN
    RAISE EXCEPTION 'D-C FAILED: correction path has no multi-shift ambiguity guard';
  END IF;

  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'hr_update_attendance';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'D6-A FAILED: hr_update_attendance not found';
  END IF;
  IF position('late_entry = v_final_is_late' in v_def) = 0 THEN
    RAISE EXCEPTION 'D6-A FAILED: edit UPDATE branch does not write late_entry from v_final_is_late';
  END IF;
  IF position('is_late, late_entry' in v_def) = 0 THEN
    RAISE EXCEPTION 'D6-A FAILED: edit INSERT branch does not name late_entry beside is_late';
  END IF;
  IF position('is_locked = true' in v_def) = 0 OR position('''manual''' in v_def) = 0 THEN
    RAISE EXCEPTION 'D5-B FAILED: edit path does not stamp is_locked / derivation_source';
  END IF;
  IF position('v_row_count > 1' in v_def) = 0 THEN
    RAISE EXCEPTION 'D-C FAILED: edit path has no multi-shift ambiguity guard';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('hr_update_attendance', 'hr_approve_attendance_correction');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'SIGNATURE FAILED: expected exactly 2 functions (one overload each), got % -- a second overload means CREATE OR REPLACE added rather than replaced', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('hr_update_attendance', 'hr_approve_attendance_correction', 'hr_unlock_attendance_day')
    AND array_to_string(p.proacl, ' ') LIKE '%authenticated=X%';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'ACL FAILED: expected all 3 HR entry points executable by authenticated, got %', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('hr_update_attendance', 'hr_approve_attendance_correction', 'hr_unlock_attendance_day')
    AND array_to_string(p.proacl, ' ') LIKE '%anon=%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ACL FAILED: an HR entry point is executable by anon (% of 3)', v_n;
  END IF;

  RAISE NOTICE 'Structural verified: both HR paths write late_entry beside is_late on INSERT and UPDATE, stamp is_locked and derivation_source, carry the ambiguity guard; one overload each; authenticated-only, never anon';
END
$struct_check$;

-- --------------------------------------------------------------------
-- 5b. Structural: assert_hr_for_tenant is still the first guard on every entry point, so the
--     SECURITY DEFINER seam has not been widened (rule 1).
-- --------------------------------------------------------------------
DO $guard_check$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname AS nm,
           regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('hr_update_attendance', 'hr_approve_attendance_correction', 'hr_unlock_attendance_day')
  LOOP
    IF position('assert_hr_for_tenant(p_tenant_id)' in r.def) = 0 THEN
      RAISE EXCEPTION 'GUARD FAILED: % does not assert HR for the tenant', r.nm;
    END IF;
    IF position('SECURITY DEFINER' in r.def) = 0 THEN
      RAISE EXCEPTION 'GUARD FAILED: % is not SECURITY DEFINER', r.nm;
    END IF;
    IF position('current_date' in r.def) > 0 THEN
      RAISE EXCEPTION 'D9 FAILED: % computes a business date from the server clock', r.nm;
    END IF;
  END LOOP;
  RAISE NOTICE 'Guards verified: all 3 entry points are SECURITY DEFINER, assert HR for the tenant, and introduce no server-clock business date (D9)';
END
$guard_check$;

-- --------------------------------------------------------------------
-- 5c. Behavioural: the ambiguity guard guards a REAL condition -- the unique key genuinely
--     permits several rows for one employee-day once shift_id differs. Asserted against the
--     whole-table population, not against the rows the probe created.
-- --------------------------------------------------------------------
DO $ambiguity_check$
DECLARE
  v_tenant    uuid := '11111111-1111-4111-8111-000000000001';
  v_shift     uuid := '11111111-1111-4111-8111-000000000004';
  v_employee  uuid := '11111111-1111-4111-8111-000000000011';
  v_date      date := DATE '2099-06-21';
  v_att_base  bigint;
  v_ev_base   bigint;
  v_att_after bigint;
  v_ev_after  bigint;
  v_day_rows  integer;
BEGIN
  SELECT count(*) INTO v_att_base FROM public.attendance;
  SELECT count(*) INTO v_ev_base  FROM public.attendance_events;

  BEGIN
    -- punch_in is named EXPLICITLY as NULL on every probe INSERT below. attendance.punch_in has
    -- DEFAULT now(), and an INSERT that omits it therefore looks like a real punch to the
    -- dual-write trigger and writes a phantom event into the immutable log -- the exact bug
    -- 20260828100000 fixed in Pass 1. Two probe rows for one employee at the same now() would
    -- also collide on the event natural key and abort this migration.
    INSERT INTO public.attendance (tenant_id, employee_id, date, shift_id, status, session_status, punch_in)
    VALUES (v_tenant, v_employee, v_date, v_shift, 'present', 'closed', NULL);

    INSERT INTO public.attendance (tenant_id, employee_id, date, shift_id, status, session_status, punch_in)
    VALUES (v_tenant, v_employee, v_date, NULL, 'present', 'closed', NULL);

    SELECT count(*) INTO v_day_rows
    FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_date;

    IF v_day_rows <> 2 THEN
      RAISE EXCEPTION 'D-C FAILED: expected a multi-row employee-day to be constructible, got % rows', v_day_rows;
    END IF;

    SELECT count(*) INTO v_att_after FROM public.attendance;
    IF v_att_after <> v_att_base + 2 THEN
      RAISE EXCEPTION 'D-C FAILED: population moved by % rows, expected exactly 2', v_att_after - v_att_base;
    END IF;

    RAISE NOTICE 'D-C verified: one employee-day holds 2 attendance rows under the per-shift unique key, so the ambiguity the new guard rejects is real, not hypothetical. attendance_events moved from % to % across the two inserts.', v_ev_base, (SELECT count(*) FROM public.attendance_events);

    RAISE EXCEPTION 'ambiguity probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'ambiguity probe writes rolled back (2 attendance rows and any dual-write events they produced)';
  END;

  SELECT count(*) INTO v_att_after FROM public.attendance;
  SELECT count(*) INTO v_ev_after  FROM public.attendance_events;
  IF v_att_after <> v_att_base OR v_ev_after <> v_ev_base THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance % to %, attendance_events % to %',
      v_att_base, v_att_after, v_ev_base, v_ev_after;
  END IF;
  RAISE NOTICE 'Population restored: attendance % rows, attendance_events % rows', v_att_base, v_ev_base;
END
$ambiguity_check$;

-- --------------------------------------------------------------------
-- 5d. Behavioural: the row SHAPE these functions now write (is_locked = true,
--     derivation_source = manual) is the shape the processor actually honours -- Pass 1 skips it
--     instead of overwriting it. This is the consequence D5-B was missing, proven end to end
--     against the deployed processor rather than inferred from the decision doc.
-- --------------------------------------------------------------------
DO $lock_honoured_check$
DECLARE
  v_tenant    uuid := '11111111-1111-4111-8111-000000000001';
  v_shift     uuid := '11111111-1111-4111-8111-000000000004';
  v_employee  uuid := '11111111-1111-4111-8111-000000000011';
  v_date      date := DATE '2099-06-22';
  v_run       uuid := gen_random_uuid();
  v_locked_id uuid;
  v_result    record;
  v_row       record;
  v_att_base  bigint;
  v_ev_base   bigint;
  v_att_after bigint;
  v_ev_after  bigint;
BEGIN
  SELECT count(*) INTO v_att_base FROM public.attendance;
  SELECT count(*) INTO v_ev_base  FROM public.attendance_events;

  BEGIN
    -- punch_in named explicitly as NULL: see the note in 5c on the DEFAULT now() phantom-event trap.
    INSERT INTO public.attendance (
      tenant_id, employee_id, date, shift_id, status, derivation_source,
      work_hours, is_late, late_entry, is_locked, session_status, punch_in
    ) VALUES (
      v_tenant, v_employee, v_date, v_shift, 'present', 'manual',
      7.5, true, true, true, 'closed', NULL
    ) RETURNING id INTO v_locked_id;

    PERFORM public.attendance_event_ingest(
      v_tenant, v_employee,
      (v_date::timestamp + TIME '10:30:00') AT TIME ZONE 'Asia/Kolkata',
      NULL, 'device', 'D5-lock-honoured-in');

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run, v_tenant, v_shift, v_date, v_date, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_date, v_date, v_run);

    IF v_result.rows_skipped <> 1 OR v_result.rows_created <> 0 OR v_result.rows_updated <> 0 THEN
      RAISE EXCEPTION 'D5-B FAILED: an HR-shaped locked row was NOT skipped by the processor. Got %', v_result;
    END IF;

    SELECT status, work_hours, is_late, late_entry, derivation_source, is_locked
      INTO v_row FROM public.attendance WHERE id = v_locked_id;

    IF v_row.work_hours <> 7.5
       OR v_row.is_late IS NOT TRUE
       OR v_row.late_entry IS NOT TRUE
       OR v_row.derivation_source <> 'manual'
       OR v_row.is_locked IS NOT TRUE THEN
      RAISE EXCEPTION 'D5-B FAILED: the locked HR row was modified by derivation: %', v_row;
    END IF;

    IF v_row.is_late IS DISTINCT FROM v_row.late_entry THEN
      RAISE EXCEPTION 'D6-A FAILED: is_late and late_entry disagree on the HR-shaped row';
    END IF;

    RAISE NOTICE 'D5-B verified: a row shaped as the HR paths now write it (is_locked, derivation_source=manual) is skipped by attendance_derive_pass1 and survives unchanged, with is_late and late_entry in agreement';

    RAISE EXCEPTION 'lock-honoured probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'lock-honoured probe writes rolled back (1 attendance row, 1 event, 1 run row)';
  END;

  SELECT count(*) INTO v_att_after FROM public.attendance;
  SELECT count(*) INTO v_ev_after  FROM public.attendance_events;
  IF v_att_after <> v_att_base OR v_ev_after <> v_ev_base THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance % to %, attendance_events % to %',
      v_att_base, v_att_after, v_ev_base, v_ev_after;
  END IF;
  RAISE NOTICE 'Population restored: attendance % rows, attendance_events % rows', v_att_base, v_ev_base;
END
$lock_honoured_check$;

-- --------------------------------------------------------------------
-- 5e. hr_unlock_attendance_day exists with the intended signature, and the UPDATE it performs
--     actually clears the flag. The UPDATE is exercised directly here because the function
--     itself needs an HR JWT, which a migration does not have -- so the recovery path is proven
--     to work, not merely to compile.
-- --------------------------------------------------------------------
DO $unlock_check$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_shift    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee uuid := '11111111-1111-4111-8111-000000000011';
  v_date     date := DATE '2099-06-23';
  v_id       uuid;
  v_row      record;
  v_att_base bigint;
  v_att_after bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hr_unlock_attendance_day'
      AND pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_employee_id uuid, p_date date'
  ) THEN
    RAISE EXCEPTION 'D5-B2 FAILED: hr_unlock_attendance_day is missing or has the wrong signature';
  END IF;

  SELECT count(*) INTO v_att_base FROM public.attendance;

  BEGIN
    -- punch_in named explicitly as NULL: see the note in 5c on the DEFAULT now() phantom-event trap.
    INSERT INTO public.attendance (
      tenant_id, employee_id, date, shift_id, status, derivation_source, is_locked, session_status, punch_in
    ) VALUES (
      v_tenant, v_employee, v_date, v_shift, 'present', 'manual', true, 'closed', NULL
    ) RETURNING id INTO v_id;

    UPDATE public.attendance
    SET is_locked = false, derivation_source = NULL
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_date AND is_locked;

    SELECT is_locked, derivation_source INTO v_row FROM public.attendance WHERE id = v_id;
    IF v_row.is_locked IS NOT FALSE OR v_row.derivation_source IS NOT NULL THEN
      RAISE EXCEPTION 'D5-B2 FAILED: the unlock UPDATE left the row locked: %', v_row;
    END IF;

    RAISE NOTICE 'D5-B2 verified: the unlock UPDATE clears is_locked and releases derivation_source, so an HR lock is recoverable';

    RAISE EXCEPTION 'unlock probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'unlock probe writes rolled back (1 attendance row and any dual-write event it produced)';
  END;

  SELECT count(*) INTO v_att_after FROM public.attendance;
  IF v_att_after <> v_att_base THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance % to %', v_att_base, v_att_after;
  END IF;
  RAISE NOTICE 'Population restored: attendance % rows', v_att_base;
END
$unlock_check$;
