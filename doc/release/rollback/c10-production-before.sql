-- Rollback for migration 20260923162654 (C10): production bodies of both functions captured
-- 2026-09-23 immediately before applying it. To roll back: run this file with `db query` against
-- production (CREATE OR REPLACE keeps grants). Forward-fix is preferred.

CREATE OR REPLACE FUNCTION public.approve_leave_request(p_leave_id uuid, p_working_dates date[] DEFAULT NULL::date[], p_approved_business_days integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_leave leaves%ROWTYPE;
  v_balance_row leave_balances%ROWTYPE;
  v_date date;
  v_caller_uid uuid;
  v_hr_employee_id uuid;
  v_working_days integer[];
  v_shift_id uuid;
  v_working_dates date[] := ARRAY[]::date[];
  v_approved_business_days numeric := 0;
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

  v_hr_employee_id := public.assert_leave_reviewer(v_leave.tenant_id, v_leave.employee_id);

  PERFORM assert_date_range_unlocked(v_leave.tenant_id, v_leave.start_date, v_leave.end_date);

  v_date := v_leave.start_date;
  WHILE v_date <= v_leave.end_date LOOP
    SELECT s.working_days INTO v_working_days
    FROM employee_shifts es
    JOIN shifts s ON s.id = es.shift_id
    WHERE es.tenant_id = v_leave.tenant_id
      AND es.employee_id = v_leave.employee_id
      AND es.effective_from <= v_date
      AND (es.effective_to IS NULL OR es.effective_to >= v_date)
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

    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT COALESCE((SELECT h.is_holiday FROM work_calendar_holiday(v_leave.tenant_id, v_leave.employee_id, v_date) h), false) THEN
      v_working_dates := array_append(v_working_dates, v_date);
      v_approved_business_days := v_approved_business_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  IF v_approved_business_days = 0 THEN
    RAISE EXCEPTION 'The selected leave range contains no working days';
  END IF;

  -- C5: a half-day leave deducts and records its fraction (0.5), not a whole day.
  IF v_leave.day_fraction < 1 THEN
    v_approved_business_days := v_approved_business_days * v_leave.day_fraction;
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
    -- P2-04: resolve the employee's real assigned shift for this specific date so the upsert
    -- below targets the SAME composite key a device/app punch already wrote under. Without this,
    -- the INSERT's implicit shift_id=NULL never matches an existing shift-tagged row's
    -- COALESCE(shift_id,...) key, so ON CONFLICT silently misses and a second, evidence-free
    -- phantom row is created alongside the real one instead of updating it.
    SELECT es.shift_id INTO v_shift_id
    FROM employee_shifts es
    WHERE es.tenant_id = v_leave.tenant_id
      AND es.employee_id = v_leave.employee_id
      AND es.effective_from <= v_date
      AND (es.effective_to IS NULL OR es.effective_to >= v_date)
    ORDER BY es.effective_from DESC
    LIMIT 1;

    INSERT INTO attendance (tenant_id, employee_id, date, shift_id, punch_in, status, punch_out_allowed, session_status, leave_id, derivation_source)
    VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, v_shift_id, NULL, CASE WHEN v_leave.day_fraction < 1 THEN 'half_day' ELSE 'on_leave' END, true, 'closed', p_leave_id, 'leave')
    -- CHANGED: was ON CONFLICT (employee_id, date), whose index 20260824100000 dropped.
    -- Must repeat the new index's COALESCE expression verbatim to be inferable.
    -- P2-04 / contracts.md #11.5: punch_in is no longer forced to NULL on conflict -- an
    -- existing row's punch_in/punch_out/in_time/out_time are raw evidence and must survive a
    -- backdated approval. Only status and leave tagging change; see cancel_leave_request for
    -- the reversal, which hands the row back to attendance_derive_pass1/pass2.
    ON CONFLICT (tenant_id, employee_id, date, COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET status = EXCLUDED.status, punch_out_allowed = true, session_status = 'closed',
                  leave_id = EXCLUDED.leave_id, derivation_source = 'leave'
    -- C4 / D5: an HR-corrected (is_locked) day is never overwritten by a leave approval.
    WHERE NOT attendance.is_locked;
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
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_leave_id uuid, p_rejection_reason text, p_new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_leave leaves%ROWTYPE;
  v_balance_row leave_balances%ROWTYPE;
  v_hr_employee_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_date date;
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

  v_hr_employee_id := public.assert_leave_reviewer(v_leave.tenant_id, v_leave.employee_id);

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

    -- P2-04 / contracts.md #11.5: a row this leave overwrote that still carries real
    -- punch evidence is never deleted or nulled. Scoped by leave_id, not a broad date/status
    -- guess. A pure leave-only placeholder (no punch/derivation evidence at all) is removed;
    -- an evidence-bearing row is released (leave_id/derivation_source cleared) for
    -- attendance_derive_pass1/pass2 to re-derive, since `leaves.status` is no longer
    -- 'approved' by the time this runs. Not invoked inline here: pass1/pass2 require the
    -- attendance module enabled, which a Leave-only tenant need not have.
    DELETE FROM attendance
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND leave_id = p_leave_id
      AND punch_in IS NULL AND punch_out IS NULL
      AND in_time IS NULL AND out_time IS NULL;

    UPDATE attendance
    SET leave_id = NULL,
        derivation_source = NULL
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND leave_id = p_leave_id
      AND (punch_in IS NOT NULL OR punch_out IS NOT NULL OR in_time IS NOT NULL OR out_time IS NOT NULL);

  END IF;

  UPDATE leaves
  SET status = p_new_status,
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      rejection_reason = COALESCE(p_rejection_reason, rejection_reason)
  WHERE id = p_leave_id;

  -- C4 (fix 195200): re-derive only AFTER the leave is no longer 'approved' -- derivation reads
  -- leaves.status, so running it earlier re-applied the very leave being cancelled. The core
  -- skips locked days and returns 'module_off' for a leave-only tenant.
  IF v_leave.status = 'approved' THEN
    v_date := v_leave.start_date;
    WHILE v_date <= v_leave.end_date LOOP
      PERFORM public.attendance_rederive_day(v_leave.tenant_id, v_leave.employee_id, v_date);
      v_date := v_date + 1;
    END LOOP;
  END IF;

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
$function$
;
