-- migration: C4 -- re-derive an already-derived attendance day
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C4 section.
--
-- Gap (measured 2026-09-23 from live bodies): attendance_derive_pass1 only takes events with
-- attendance_id IS NULL and pass2 only fills dates with no row, so a derived day is never
-- recomputed. cancel_leave_request releases the day (leave_id/derivation_source cleared, pure
-- placeholders deleted) but deliberately does not re-derive -> a day with punches keeps
-- status='on_leave' forever, and an emptied day stays empty until a scheduled run (the hourly
-- schedule is inactive on TB). approve_leave_request already writes on_leave correctly, including
-- over punch rows -- NOT changed here.
--
-- Pass functions are unchanged. New:
--   attendance_rederive_day(tenant, employee, date)    -- core, internal (no client EXECUTE)
--   hr_rederive_attendance_day(tenant, employee, date) -- HR "recalculate day"
-- cancel_leave_request: exact live body + one loop calling the core for each day of the leave.
--
-- Evidence rule (P2-04): punches, events, selfies, breaks, overtime and audit rows are never
-- destroyed. Events are only un-stamped (attendance_id -> NULL, the one permitted mutation, D11);
-- a row is deleted only if it carries no punch/derived time AND nothing references it.
-- is_locked days (HR-corrected, D5) are never touched.
-- No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

CREATE OR REPLACE FUNCTION public.attendance_rederive_day(p_tenant_id uuid, p_employee_id uuid, p_date date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_shift_id uuid;
  v_run_id uuid := gen_random_uuid();
  v_status text;
BEGIN
  IF p_tenant_id IS NULL OR p_employee_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'attendance_rederive_day: all three parameters are required';
  END IF;

  -- Definer bypasses RLS: restore the tenant fence by hand (same rule as the pass functions).
  IF (SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible';
  END IF;

  -- A Leave-only tenant: nothing to derive, and the pass functions would raise.
  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RETURN 'module_off';
  END IF;

  -- D5: an HR-corrected day is never recomputed.
  IF EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.tenant_id = p_tenant_id AND a.employee_id = p_employee_id AND a.date = p_date AND a.is_locked
  ) THEN
    RETURN 'locked';
  END IF;

  -- The shift the employee was assigned that day; else whatever shift the day's row carries.
  SELECT es.shift_id INTO v_shift_id
  FROM public.employee_shifts es
  WHERE es.tenant_id = p_tenant_id AND es.employee_id = p_employee_id
    AND es.effective_from <= p_date AND (es.effective_to IS NULL OR es.effective_to >= p_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;
  IF v_shift_id IS NULL THEN
    SELECT a.shift_id INTO v_shift_id
    FROM public.attendance a
    WHERE a.tenant_id = p_tenant_id AND a.employee_id = p_employee_id AND a.date = p_date AND a.shift_id IS NOT NULL
    LIMIT 1;
  END IF;
  IF v_shift_id IS NULL THEN
    RETURN 'no_shift';
  END IF;

  -- Hand the day's events back to pass 1 (un-stamp only; the events themselves are untouched).
  UPDATE public.attendance_events ev
  SET attendance_id = NULL
  WHERE ev.attendance_id IN (
    SELECT a.id FROM public.attendance a
    WHERE a.tenant_id = p_tenant_id AND a.employee_id = p_employee_id AND a.date = p_date
  );

  -- An evidence-free row (a leave placeholder or an earlier pass-2 fill) is removed so pass 2
  -- can refill the date from the calendar. Never a row with punches/derived times, and never a
  -- row that anything references (breaks/selfies/overtime cascade; audit rows must stay valid).
  DELETE FROM public.attendance a
  WHERE a.tenant_id = p_tenant_id AND a.employee_id = p_employee_id AND a.date = p_date
    AND NOT a.is_locked
    AND a.punch_in IS NULL AND a.punch_out IS NULL AND a.in_time IS NULL AND a.out_time IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.attendance_breaks b WHERE b.attendance_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM public.attendance_selfies s WHERE s.attendance_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM public.overtime_records o WHERE o.attendance_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM public.attendance_audit_logs l WHERE l.attendance_id = a.id);

  INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
  VALUES (v_run_id, p_tenant_id, v_shift_id, p_date, p_date, 'manual', 'running');

  PERFORM public.attendance_derive_pass1(p_tenant_id, v_shift_id, p_date, p_date, v_run_id);
  PERFORM public.attendance_derive_pass2(p_tenant_id, v_shift_id, p_date, p_date, v_run_id);

  SELECT a.status INTO v_status
  FROM public.attendance a
  WHERE a.tenant_id = p_tenant_id AND a.employee_id = p_employee_id AND a.date = p_date
  ORDER BY a.derived_at DESC NULLS LAST
  LIMIT 1;

  RETURN COALESCE(v_status, 'no_row');
END;
$function$;

-- Internal: only other definer functions (same owner) call it.
REVOKE ALL ON FUNCTION public.attendance_rederive_day(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hr_rederive_attendance_day(p_tenant_id uuid, p_employee_id uuid, p_date date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_result text;
BEGIN
  -- Same authority as hr_run_attendance_derivation / hr_unlock_attendance_day.
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF NOT EXISTS (SELECT 1 FROM employees WHERE tenant_id = p_tenant_id AND id = p_employee_id) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, p_date, p_date);

  v_result := public.attendance_rederive_day(p_tenant_id, p_employee_id, p_date);

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'attendance.rederived', 'attendance', p_employee_id,
    jsonb_build_object('employee_id', p_employee_id, 'date', p_date, 'result', v_result, 'correlation_id', gen_random_uuid())
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.hr_rederive_attendance_day(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_rederive_attendance_day(uuid, uuid, date) TO authenticated;

-- cancel_leave_request: exact live pg_get_functiondef() body; only change = the v_date declaration
-- and the C4 re-derive loop inside the IF v_leave.status = 'approved' branch.
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

    -- C4: hand every day of the cancelled leave back to derivation now, so a day with punches
    -- snaps back to its punch-derived status and an evidence-free day is refilled from the
    -- calendar. The core skips locked days and returns 'module_off' for a leave-only tenant.
    v_date := v_leave.start_date;
    WHILE v_date <= v_leave.end_date LOOP
      PERFORM public.attendance_rederive_day(v_leave.tenant_id, v_leave.employee_id, v_date);
      v_date := v_date + 1;
    END LOOP;
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
$function$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['attendance_rederive_day', 'hr_rederive_attendance_day', 'cancel_leave_request'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C4: expected exactly one pg_proc row for %', fn;
    END IF;
  END LOOP;
END $$;
