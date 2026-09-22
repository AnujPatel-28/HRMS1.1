-- migration: C4 forward fix 2 -- re-derive after the leave status flips, not before
-- Source: C4 (prompts/c2_c6_cleanup_packages_2026-09-22.md). Second C4 forward fix (the pre-authorized
-- slot 195100 went to the approve/locked-day fix); authorized by the lead, recorded in the review.
--
-- Measured 2026-09-23 (tests/m1m2/c4_rederive_day.mjs after 195000+195100): cancel re-derived each
-- day while the leave was still 'approved' (the loop sat before UPDATE leaves), so pass 1/2 re-applied
-- it -- D1 stayed on_leave, D2 was refilled as on_leave. HR recalculate afterwards gave 'present',
-- confirming the order was the only defect. Exact live body (post-195000); the loop moves below the
-- status update, guarded by the original status. No other change.
-- No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

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
$function$;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'cancel_leave_request') <> 1 THEN
    RAISE EXCEPTION 'C4 fix 2: expected exactly one pg_proc row for cancel_leave_request';
  END IF;
END $$;
