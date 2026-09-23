-- migration: C5 -- half-day leave
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C5 section (user decision 2026-09-22).
--
-- Measured 2026-09-23: leaves.day_fraction exists (all 7 rows = 1.0) and both derivation passes
-- already map day_fraction < 1 -> 'half_day', but nothing could write it. leaves.total_days and
-- approved_business_days were INTEGER (0.5 impossible); leave_balances.* already numeric. Readers
-- of those two columns (pg_proc sweep): only apply/approve/cancel; no views; frontend displays only.
--
-- 1. leaves.total_days / approved_business_days -> numeric (widening; existing integers unchanged).
-- 2. leave_types.allow_half_day (HR-configurable, default off).
-- 3. leaves.half_day_session ('first'|'second') + a shape CHECK tying it to day_fraction.
-- 4. employee_apply_leave_request: NEW signature (+ p_half_day_session DEFAULT NULL). Old exact
--    signature DROPPED first (no overload); the DEFAULT keeps 5-argument callers working.
-- 5. approve_leave_request: deducts/records day_fraction, writes 'half_day' for a half-day leave.
-- 6. attendance_derive_pass1: first-half leave clears late_entry, second-half clears early_exit
--    (otherwise every half-day leave produced a false late mark / early exit).
-- cancel_leave_request needs no change: it credits approved_business_days (now 0.5) and C4
-- re-derives the day. All bodies are live pg_get_functiondef() output with anchored edits only.
-- No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

ALTER TABLE public.leaves ALTER COLUMN total_days TYPE numeric USING total_days::numeric;
ALTER TABLE public.leaves ALTER COLUMN approved_business_days TYPE numeric USING approved_business_days::numeric;

ALTER TABLE public.leave_types ADD COLUMN allow_half_day boolean NOT NULL DEFAULT false;

ALTER TABLE public.leaves ADD COLUMN half_day_session text;
ALTER TABLE public.leaves ADD CONSTRAINT leaves_half_day_shape CHECK (
  (day_fraction = 1 AND half_day_session IS NULL)
  OR (day_fraction = 0.5 AND half_day_session IN ('first', 'second') AND start_date = end_date)
);

DROP FUNCTION public.employee_apply_leave_request(uuid, uuid, date, date, text);
CREATE OR REPLACE FUNCTION public.employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text, p_half_day_session text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_employee employees%ROWTYPE;
  v_leave_type leave_types%ROWTYPE;
  v_global_notice_days integer := 0;
  v_working_days integer[];
  v_date date;
  v_total_days numeric := 0;
  v_day_fraction numeric := 1;
  v_balance numeric;
  v_effective_notice integer;
  v_notice_given integer;
  v_notice_days_reason text;
  v_days_since_joining integer;
  v_leave_id uuid;
  v_leave_type_enum text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  IF NOT tenant_has_module_for(p_tenant_id, 'leave') THEN
    RAISE EXCEPTION 'MODULE_DISABLED' USING ERRCODE = 'P0007';
  END IF;

  SELECT * INTO v_employee
  FROM employees
  WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT * INTO v_leave_type
  FROM leave_types
  WHERE tenant_id = p_tenant_id
    AND id = p_leave_type_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave type not found';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT COALESCE(NULLIF(value, '')::integer, 0)
  INTO v_global_notice_days
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'leave_min_notice_days';
  v_global_notice_days := COALESCE(v_global_notice_days, 0);

  v_effective_notice := GREATEST(COALESCE(v_global_notice_days, 0), COALESCE(v_leave_type.min_notice_days, 0));
  -- C2: tenant business date, not server/UTC CURRENT_DATE (P2-01 shared primitive).
  v_notice_given := p_start_date - tenant_business_date(p_tenant_id, now());
  IF v_notice_given < v_effective_notice THEN
    RAISE EXCEPTION 'This leave requires at least % days notice', v_effective_notice;
  END IF;

  IF COALESCE(v_leave_type.applicable_from_day, 0) > 0 AND v_employee.date_of_joining IS NOT NULL THEN
    -- C2: tenant business date, not server/UTC CURRENT_DATE (P2-01 shared primitive).
    v_days_since_joining := tenant_business_date(p_tenant_id, now()) - v_employee.date_of_joining;
    IF v_days_since_joining < v_leave_type.applicable_from_day THEN
      RAISE EXCEPTION '% is only available after % days of employment', v_leave_type.name, v_leave_type.applicable_from_day;
    END IF;
  END IF;

  v_date := p_start_date;
  WHILE v_date <= p_end_date LOOP
    SELECT s.working_days INTO v_working_days
    FROM employee_shifts es
    JOIN shifts s ON s.id = es.shift_id
    WHERE es.tenant_id = p_tenant_id
      AND es.employee_id = v_employee.id
      AND es.effective_from <= v_date
      AND (es.effective_to IS NULL OR es.effective_to >= v_date)
    ORDER BY es.effective_from DESC
    LIMIT 1;

    IF v_working_days IS NULL THEN
      SELECT working_days INTO v_working_days
      FROM shifts
      WHERE tenant_id = p_tenant_id
        AND is_default = true
        AND is_active IS NOT FALSE
      LIMIT 1;
    END IF;
    v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT COALESCE((SELECT h.is_holiday FROM work_calendar_holiday(p_tenant_id, v_employee.id, v_date) h), false) THEN
      v_total_days := v_total_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  IF v_total_days = 0 THEN
    RAISE EXCEPTION 'The selected date range contains no working days';
  END IF;

  -- C5: half-day leave -- one working day, a type that allows it, and a named half.
  IF p_half_day_session IS NOT NULL THEN
    IF p_half_day_session NOT IN ('first', 'second') THEN
      RAISE EXCEPTION 'Half-day session must be first or second';
    END IF;
    IF p_start_date <> p_end_date THEN
      RAISE EXCEPTION 'A half-day leave must be a single day';
    END IF;
    IF NOT COALESCE(v_leave_type.allow_half_day, false) THEN
      RAISE EXCEPTION '% does not allow half-day leave', v_leave_type.name;
    END IF;
    v_day_fraction := 0.5;
    v_total_days := 0.5;
  END IF;

  IF v_leave_type.max_consecutive_days IS NOT NULL AND v_total_days > v_leave_type.max_consecutive_days THEN
    RAISE EXCEPTION '% allows a maximum of % working days per request', v_leave_type.name, v_leave_type.max_consecutive_days;
  END IF;

  SELECT balance INTO v_balance
  FROM leave_balances
  WHERE tenant_id = p_tenant_id
    AND employee_id = v_employee.id
    AND leave_type_id = p_leave_type_id
    AND year = EXTRACT(YEAR FROM p_start_date)
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Leave balance not found';
  END IF;

  IF v_total_days > v_balance THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, requested: %', v_balance, v_total_days;
  END IF;

  IF EXISTS (
    SELECT 1 FROM leaves
    WHERE tenant_id = p_tenant_id
      AND employee_id = v_employee.id
      AND status IN ('pending', 'approved')
      AND start_date <= p_end_date
      AND end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'An existing pending or approved leave overlaps these dates';
  END IF;

  v_leave_type_enum := CASE upper(v_leave_type.code)
    WHEN 'CL' THEN 'casual'
    WHEN 'SL' THEN 'sick'
    WHEN 'EL' THEN 'earned'
    WHEN 'UL' THEN 'unpaid'
    WHEN 'ML' THEN 'maternity'
    WHEN 'PL' THEN 'paternity'
    ELSE 'other'
  END;

  INSERT INTO leaves (
    tenant_id, employee_id, leave_type_id, leave_type, start_date,
    end_date, total_days, reason, status, day_fraction, half_day_session
  )
  VALUES (
    p_tenant_id, v_employee.id, p_leave_type_id, v_leave_type_enum,
    p_start_date, p_end_date, v_total_days, trim(p_reason), 'pending', v_day_fraction, p_half_day_session
  )
  RETURNING id INTO v_leave_id;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    SELECT p_tenant_id, e.id, 'New Leave Request',
           v_employee.full_name || ' has requested ' || v_leave_type.name || ' from ' || p_start_date || ' to ' || p_end_date || '.',
           'general', v_leave_id
    FROM employees e
    WHERE e.tenant_id = p_tenant_id
      AND public.employee_is_hr(e.id)
      AND e.status = 'active';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_leave_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_apply_leave_request(uuid, uuid, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_apply_leave_request(uuid, uuid, date, date, text, text) TO authenticated;

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
$function$;

CREATE OR REPLACE FUNCTION public.attendance_derive_pass1(p_tenant_id uuid, p_shift_id uuid, p_from date, p_to date, p_run_id uuid)
 RETURNS TABLE(groups_processed integer, rows_created integer, rows_updated integer, rows_skipped integer, events_processed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_loc_status            text;
  v_tz                  text;
  v_shift                public.shifts%ROWTYPE;
  v_group                record;
  v_calc                 record;
  v_holiday               record;
  v_absent_threshold      numeric;
  v_half_day_threshold    numeric;
  v_local_date            date;
  v_status                text;
  v_late_entry            boolean;
  v_early_exit            boolean;
  v_leave_id              uuid;
  v_leave_day_fraction    numeric;
  v_leave_session         text;
  v_shift_snapshot        jsonb;
  v_policy_snapshot       jsonb;
  v_existing_id           uuid;
  v_existing_locked       boolean;
  v_existing_version      integer;
  v_att_id                uuid;
  v_groups_processed      integer := 0;
  v_rows_created          integer := 0;
  v_rows_updated          integer := 0;
  v_rows_skipped          integer := 0;
  v_events_processed      integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_shift_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'attendance_derive_pass1: all five parameters are required';
  END IF;

  -- Binding rule 1: definer bypasses RLS; restore the tenant fence and the module gate by hand.
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible';
  END IF;

  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'attendance module not enabled for tenant %', p_tenant_id;
  END IF;

  -- E42: advisory lock per (tenant, shift), auto-released at transaction end.
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text), hashtext(p_shift_id::text));

  SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id AND s.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift % not found for tenant %', p_shift_id, p_tenant_id;
  END IF;

  SELECT COALESCE(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id;
  END IF;

  v_shift_snapshot := to_jsonb(v_shift);

  FOR v_group IN
    SELECT e.employee_id,
           e.shift_start,
           MIN(e.shift_end) AS shift_end,
           jsonb_agg(jsonb_build_object('event_time', e.event_time, 'direction', e.direction) ORDER BY e.event_time) AS events,
           array_agg(e.id) AS event_ids,
           array_agg(DISTINCT e.source) AS sources
    FROM public.attendance_events e
    WHERE e.tenant_id = p_tenant_id
      AND e.shift_id = p_shift_id
      AND e.attendance_id IS NULL
      AND e.skip_derivation = false
      AND e.offshift = false
      AND e.superseded_by_id IS NULL
      AND e.shift_start IS NOT NULL
      AND public.tenant_business_date(p_tenant_id, e.shift_start) BETWEEN p_from AND p_to
    GROUP BY e.employee_id, e.shift_start
  LOOP
    v_groups_processed := v_groups_processed + 1;
    v_events_processed := v_events_processed + COALESCE(array_length(v_group.event_ids, 1), 0);
    v_local_date := public.tenant_business_date(p_tenant_id, v_group.shift_start);

    SELECT * INTO v_holiday
    FROM public.work_calendar_holiday(p_tenant_id, v_group.employee_id, v_local_date);

    -- Holiday overrides derivation entirely unless the shift opts in (§2.6 / §7 E24). Events
    -- stay queued (attendance_id untouched) for a human or a future opt-in to resolve.
    IF v_holiday.is_holiday AND NOT v_shift.mark_attendance_on_holidays THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    -- §2.2: a half-day holiday halves BOTH thresholds.
    v_absent_threshold   := v_shift.working_hours_threshold_for_absent;
    v_half_day_threshold := v_shift.working_hours_threshold_for_half_day;
    IF v_holiday.is_holiday AND v_holiday.is_half_day THEN
      v_absent_threshold   := v_absent_threshold / 2;
      v_half_day_threshold := v_half_day_threshold / 2;
    END IF;

    SELECT * INTO v_calc
    FROM public.attendance_calculate_working_hours(
      v_group.events, v_shift.determine_check_in_and_check_out, v_shift.working_hours_calculation_based_on
    );

    -- D6: late_entry/early_exit are independent flags, never statuses.
    v_late_entry := v_shift.enable_late_entry_marking
      AND v_calc.in_time IS NOT NULL
      AND v_calc.in_time > (v_group.shift_start + make_interval(mins => v_shift.late_entry_grace_minutes));
    v_early_exit := v_shift.enable_early_exit_marking
      AND v_calc.out_time IS NOT NULL
      AND v_calc.out_time < (v_group.shift_end - make_interval(mins => v_shift.early_exit_grace_minutes));

    -- D6: absent threshold checked FIRST.
    IF v_calc.hours < v_absent_threshold THEN
      v_status := 'absent';
    ELSIF v_calc.hours < v_half_day_threshold THEN
      v_status := 'half_day';
    ELSE
      v_status := 'present';
    END IF;

    -- D8: approved leave overrides the derived status. E23 (fixed here): a leave with
    -- day_fraction < 1 yields half_day, not on_leave; a full-day leave (day_fraction = 1,
    -- the default) still yields on_leave exactly as before this migration.
    v_leave_id := NULL;
    v_leave_day_fraction := NULL;
    v_leave_session := NULL;
    SELECT l.id, l.day_fraction, l.half_day_session INTO v_leave_id, v_leave_day_fraction, v_leave_session
    FROM public.leaves l
    WHERE l.tenant_id = p_tenant_id
      AND l.employee_id = v_group.employee_id
      AND l.status = 'approved'
      AND v_local_date BETWEEN l.start_date AND l.end_date
    ORDER BY l.start_date DESC
    LIMIT 1;

    IF v_leave_id IS NOT NULL THEN
      v_status := CASE WHEN v_leave_day_fraction < 1 THEN 'half_day' ELSE 'on_leave' END;
    END IF;

    -- C5: a first-half leave explains a late arrival, a second-half leave an early exit.
    IF v_leave_session = 'first' THEN
      v_late_entry := false;
    ELSIF v_leave_session = 'second' THEN
      v_early_exit := false;
    END IF;

    v_policy_snapshot := jsonb_build_object(
      'absent_threshold', v_absent_threshold,
      'half_day_threshold', v_half_day_threshold,
      'determine_check_in_and_check_out', v_shift.determine_check_in_and_check_out,
      'working_hours_calculation_based_on', v_shift.working_hours_calculation_based_on,
      'enable_late_entry_marking', v_shift.enable_late_entry_marking,
      'late_entry_grace_minutes', v_shift.late_entry_grace_minutes,
      'enable_early_exit_marking', v_shift.enable_early_exit_marking,
      'early_exit_grace_minutes', v_shift.early_exit_grace_minutes,
      'holiday', to_jsonb(v_holiday),
      'calc_flags', v_calc.flags,
      'derivation_version', 1
    );

    -- A day assembled entirely from a fixed terminal or kiosk is location-verified BY THE DEVICE:
    -- it has no GPS to fence, and its physical presence at a site is the evidence. Recording that
    -- as 'office_verified' would be indistinguishable from a GPS-checked app punch in the audit
    -- trail, which is why 'device_verified' exists (20260903105835). A mixed day -- some events
    -- from a device, some from the app -- is deliberately left alone rather than claimed as either.
    IF v_group.sources <@ ARRAY['device', 'kiosk']::text[] THEN
      v_loc_status := 'device_verified';
    ELSE
      v_loc_status := NULL;
    END IF;

    -- D5: an is_locked row is never overwritten by derivation. Checked up front (not via
    -- ON CONFLICT) so the events for a locked day stay untouched and queued for a human --
    -- the advisory lock above already serializes the only concurrent writer this phase has
    -- (another Pass 1 call on the same tenant+shift), so a plain SELECT-then-branch is safe.
    SELECT id, is_locked, derivation_version
      INTO v_existing_id, v_existing_locked, v_existing_version
    FROM public.attendance
    WHERE tenant_id = p_tenant_id
      AND employee_id = v_group.employee_id
      AND date = v_local_date
      AND shift_id = p_shift_id;

    IF FOUND AND v_existing_locked THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    IF FOUND THEN
      UPDATE public.attendance SET
        status              = v_status,
        derivation_source   = 'derived',
        late_entry          = v_late_entry,
        is_late             = v_late_entry,
        early_exit          = v_early_exit,
        in_time             = v_calc.in_time,
        out_time            = v_calc.out_time,
        work_hours          = v_calc.hours,
        leave_id            = v_leave_id,
        shift_snapshot      = v_shift_snapshot,
        policy_snapshot     = v_policy_snapshot,
        business_date_tz    = v_tz,
        derived_at          = now(),
        derivation_version  = COALESCE(v_existing_version, 0) + 1,
        location_status     = COALESCE(v_loc_status, location_status),
        session_status      = 'closed'
      WHERE id = v_existing_id
      RETURNING id INTO v_att_id;
      v_rows_updated := v_rows_updated + 1;
    ELSE
      -- FIX (see header): punch_in named explicitly as NULL. Without it, the column's own
      -- DEFAULT now() applies, NEW.punch_in IS NOT NULL becomes true, and the dual-write
      -- trigger's INSERT branch appends a phantom 'in' event that never happened.
      INSERT INTO public.attendance (
        tenant_id, employee_id, date, shift_id, status, derivation_source,
        punch_in, late_entry, is_late, early_exit, in_time, out_time, work_hours, leave_id,
        shift_snapshot, policy_snapshot, business_date_tz, derived_at, derivation_version,
        location_status, session_status
      ) VALUES (
        p_tenant_id, v_group.employee_id, v_local_date, p_shift_id, v_status, 'derived',
        NULL, v_late_entry, v_late_entry, v_early_exit, v_calc.in_time, v_calc.out_time, v_calc.hours, v_leave_id,
        v_shift_snapshot, v_policy_snapshot, v_tz, now(), 1,
        v_loc_status, 'closed'
      )
      RETURNING id INTO v_att_id;
      v_rows_created := v_rows_created + 1;
    END IF;

    -- Stamp attendance_id onto every event in the group -- the one permitted mutation of an
    -- append-only row (D11), and it happens here inside a definer function that bypasses RLS
    -- by ownership, not via any write policy (there is none, on purpose).
    UPDATE public.attendance_events
    SET attendance_id = v_att_id
    WHERE id = ANY (v_group.event_ids);
  END LOOP;

  -- Table alias `r` is required here, not decoration: this function's own RETURNS TABLE
  -- column names (rows_created, rows_updated, rows_skipped, events_processed) are implicitly
  -- declared as PL/pgSQL OUT variables in this function's namespace, and they collide with the
  -- identically-named columns on attendance_derivation_runs. Without the alias, `COALESCE(
  -- events_processed, 0)` on the right-hand side is ambiguous between the OUT variable and the
  -- table column -- caught by 20260825100000's own apply attempt (Postgres error 42702).
  UPDATE public.attendance_derivation_runs AS r
  SET events_processed = COALESCE(r.events_processed, 0) + v_events_processed,
      rows_created     = COALESCE(r.rows_created, 0) + v_rows_created,
      rows_updated     = COALESCE(r.rows_updated, 0) + v_rows_updated,
      rows_skipped     = COALESCE(r.rows_skipped, 0) + v_rows_skipped,
      finished_at      = now(),
      status           = 'completed'
  WHERE r.id = p_run_id AND r.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance_derivation_runs row % not found for tenant % -- caller must INSERT the run row before calling attendance_derive_pass1', p_run_id, p_tenant_id;
  END IF;

  RETURN QUERY SELECT v_groups_processed, v_rows_created, v_rows_updated, v_rows_skipped, v_events_processed;
END;
$function$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['employee_apply_leave_request', 'approve_leave_request', 'attendance_derive_pass1'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C5: expected exactly one pg_proc row for %', fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.employee_apply_leave_request(uuid,uuid,date,date,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C5: anon must not execute employee_apply_leave_request';
  END IF;
END $$;
