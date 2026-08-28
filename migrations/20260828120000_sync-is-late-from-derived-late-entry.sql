-- B7b server-side fix (decision doc §3a): sync is_late from the derived late_entry flag inside
-- attendance_derive_pass1, so the payroll contract's late_mark_count (which reads is_late, not
-- late_entry) becomes trustworthy once derivation actually runs in production.
--
-- ============================================================================
-- THE BUG (re-verified live before writing this migration -- both a source scan and a fresh
-- behavioural reproduction; see the DO blocks below)
-- ============================================================================
-- attendance_derive_pass1 (20260825100000, latest CREATE OR REPLACE 20260828100000) computes
-- v_late_entry (D6: hours/grace-based lateness) and writes it to late_entry on BOTH the INSERT
-- and UPDATE paths. It never writes is_late. is_late's column default is false (confirmed live
-- via information_schema.columns), so every derived row silently reads is_late = false
-- regardless of how late the employee actually punched in.
--
-- payroll_period_input (LANGUAGE sql, unmodified by this migration -- see binding rule below)
-- computes its late_mark_count contract column as:
--   count(*) FILTER (WHERE a.is_late AND a.status NOT IN ('absent', 'half_day'))
-- i.e. it reads is_late, not late_entry (confirmed live with comments stripped from
-- pg_get_functiondef, so a comment-only match could not fool the check). Every Pass-1-derived
-- row therefore contributes 0 to late_mark_count no matter how late the punch was -- the same
-- failure class as the payslip-showed-zero incident: a value that should be N silently reads
-- as 0, with no error anywhere. Latent only because derivation had not yet run in production.
--
-- ============================================================================
-- THE DECISION (already made -- not re-litigated here)
-- ============================================================================
-- late_entry is the derived authority (D6). Derivation keeps is_late in sync with it so the
-- payroll contract's existing column becomes server-derived truth instead of a client-asserted
-- value that derivation silently ignores -- without changing the contract's shape, columns, or
-- meaning. is_late stays the single read-point for existing consumers (payroll_period_input,
-- hr_update_attendance, hr_approve_attendance_correction, PunchInOut.tsx, Attendance.tsx).
-- Retiring is_late outright is a payroll-era decision -- payroll is the LAST module to be
-- designed and its decisions are not locked -- not a side effect of an attendance cutover, so
-- it is deliberately NOT done here. payroll_period_input, every other consumer, and every
-- frontend file are UNTOUCHED by this migration.
--
-- ============================================================================
-- WHAT CHANGES, MECHANICALLY
-- ============================================================================
-- CREATE OR REPLACE on attendance_derive_pass1, IDENTICAL signature -- this preserves the
-- function's existing project_admin-only EXECUTE grants (CREATE OR REPLACE keeps a function's
-- ACL and OID; only DROP+CREATE would lose it, which is exactly why the signature is not
-- touched). The UPDATE branch gets one added SET clause, is_late = v_late_entry, immediately
-- after the existing late_entry = v_late_entry. The INSERT branch gets is_late added to the
-- column list and a second v_late_entry added to the VALUES list, both immediately after the
-- existing late_entry entries. punch_in stays named explicitly as NULL in the INSERT column
-- list (20260828100000's phantom-event fix) -- untouched, still present, still NULL. Nothing
-- else in the function body changes.
--
-- Binding rules honoured: SECURITY DEFINER and both can_access_tenant()/tenant_has_module_for()
-- guards are untouched (rule 1). No current_date/now()::date is introduced (D9). No
-- attendance_events row is ever edited or deleted, and no write policy is added to it (D11) --
-- every probe below that touches attendance_events does so inside a savepoint-equivalent
-- BEGIN/EXCEPTION that rolls its own inserts back before this migration commits, so nothing is
-- ever durably created, let alone edited or deleted. No BEGIN/COMMIT/ROLLBACK appears in this
-- file. payroll_period_input is read-only below, never modified. No frontend file is touched.

CREATE OR REPLACE FUNCTION public.attendance_derive_pass1(p_tenant_id uuid, p_shift_id uuid, p_from date, p_to date, p_run_id uuid)
 RETURNS TABLE(groups_processed integer, rows_created integer, rows_updated integer, rows_skipped integer, events_processed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
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
           array_agg(e.id) AS event_ids
    FROM public.attendance_events e
    WHERE e.tenant_id = p_tenant_id
      AND e.shift_id = p_shift_id
      AND e.attendance_id IS NULL
      AND e.skip_derivation = false
      AND e.offshift = false
      AND e.superseded_by_id IS NULL
      AND e.shift_start IS NOT NULL
      AND (e.shift_start AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
    GROUP BY e.employee_id, e.shift_start
  LOOP
    v_groups_processed := v_groups_processed + 1;
    v_events_processed := v_events_processed + COALESCE(array_length(v_group.event_ids, 1), 0);
    v_local_date := (v_group.shift_start AT TIME ZONE v_tz)::date;

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
    SELECT l.id, l.day_fraction INTO v_leave_id, v_leave_day_fraction
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
        session_status
      ) VALUES (
        p_tenant_id, v_group.employee_id, v_local_date, p_shift_id, v_status, 'derived',
        NULL, v_late_entry, v_late_entry, v_early_exit, v_calc.in_time, v_calc.out_time, v_calc.hours, v_leave_id,
        v_shift_snapshot, v_policy_snapshot, v_tz, now(), 1,
        'closed'
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

-- ============================================================================
-- Assertions -- each proves its own claim by doing the thing (Phase 0a lesson: PL/pgSQL plans
-- each statement on first execution of THAT statement). Every probe that writes wraps its
-- writes in a nested BEGIN/EXCEPTION ending in a private sentinel SQLSTATE ('ZZ001'), caught by
-- that same block -- Postgres's implicit per-EXCEPTION-block savepoint rolls back exactly the
-- probe's own writes, so nothing is ever durably created (D11). Any OTHER error propagates out
-- and aborts this migration's transaction: an honest assertion failure means nothing here
-- applies.
-- ============================================================================

-- --------------------------------------------------------------------
-- A. Shape check: exactly one signature, EXECUTE remains project_admin-only.
-- --------------------------------------------------------------------
DO $shape_check$
DECLARE
  v_overload_count integer;
  v_can_admin      boolean;
  v_can_auth       boolean;
  v_can_anon       boolean;
BEGIN
  SELECT count(*) INTO v_overload_count
  FROM pg_proc
  WHERE proname = 'attendance_derive_pass1' AND pronamespace = 'public'::regnamespace;

  IF v_overload_count <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: attendance_derive_pass1 has % overloads/signatures, expected exactly 1', v_overload_count;
  END IF;

  SELECT has_function_privilege('project_admin', 'public.attendance_derive_pass1(uuid,uuid,date,date,uuid)', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.attendance_derive_pass1(uuid,uuid,date,date,uuid)', 'EXECUTE'),
         has_function_privilege('anon', 'public.attendance_derive_pass1(uuid,uuid,date,date,uuid)', 'EXECUTE')
    INTO v_can_admin, v_can_auth, v_can_anon;

  IF NOT v_can_admin OR v_can_auth OR v_can_anon THEN
    RAISE EXCEPTION 'ASSERTION FAILED: expected project_admin-only EXECUTE, got admin=%, authenticated=%, anon=%', v_can_admin, v_can_auth, v_can_anon;
  END IF;

  RAISE NOTICE 'A verified: exactly 1 signature; EXECUTE is project_admin-only (authenticated=%, anon=%)', v_can_auth, v_can_anon;
END
$shape_check$;

-- --------------------------------------------------------------------
-- B. The behavioural probe: derive a not-late row (INSERT path), then re-derive it late
-- (UPDATE path) with a second, independent event -- proving both write paths sync is_late from
-- late_entry, that the payroll contract's late_mark_count picks up the change, and that the
-- GLOBAL attendance_events count moves by exactly the events created here (the phantom-event
-- guard -- population, not sample, per the sibling bug this class already produced once).
--
-- Fixture: QA Attendance Only tenant / QA Day Shift / its permanently-assigned probe employee
-- (same fixture 20260825100000's own E4 probe and 20260828110001 both used). This shift has
-- both working-hour thresholds at 0, so status is always 'present' regardless of hours worked --
-- isolating the probe to late_entry/is_late alone, with no interaction from the status ladder.
-- --------------------------------------------------------------------
DO $is_late_sync_probe$
DECLARE
  v_tenant      uuid := '11111111-1111-4111-8111-000000000001';
  v_shift       uuid := '11111111-1111-4111-8111-000000000004';
  v_employee    uuid := '11111111-1111-4111-8111-000000000011';
  v_date        date := DATE '2099-04-06';
  v_tz          text;
  v_grace       integer;
  v_enable      boolean;
  v_ev1         uuid;
  v_ev2         uuid;
  v_run1        uuid := gen_random_uuid();
  v_run2        uuid := gen_random_uuid();
  v_result      record;
  v_att_id_1    uuid;
  v_att_id_2    uuid;
  v_late_1      boolean;
  v_islate_1    boolean;
  v_punchin_1   timestamptz;
  v_late_2      boolean;
  v_islate_2    boolean;
  v_late_mark_count integer;
  v_ev_before       bigint;
  v_ev_after_first  bigint;
  v_ev_after_second bigint;
  v_ev_final        bigint;
BEGIN
  -- Fixture sanity: the probe leans on the QA Day Shift's known configuration. Confirm it
  -- before trusting it.
  SELECT late_entry_grace_minutes, enable_late_entry_marking INTO v_grace, v_enable
  FROM public.shifts WHERE id = v_shift AND tenant_id = v_tenant;
  IF v_grace IS DISTINCT FROM 10 OR v_enable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PROBE SETUP FAILED: QA Day Shift fixture changed (grace=%, enabled=%) -- update probe assumptions', v_grace, v_enable;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date
  ) THEN
    RAISE EXCEPTION 'PROBE SETUP FAILED: an attendance row already exists for probe date % -- pick a different date', v_date;
  END IF;

  SELECT COALESCE(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = v_tenant;
  SELECT count(*) INTO v_ev_before FROM public.attendance_events;

  BEGIN
    -- Event 1: punch-in 5 minutes after shift start (09:05), inside the 10-minute grace ->
    -- NOT late.
    v_ev1 := public.attendance_event_ingest(
      v_tenant, v_employee, (v_date::timestamp + TIME '09:05:00') AT TIME ZONE v_tz,
      NULL, 'device', 'B7b-is-late-sync-probe-ontime'
    );
    IF v_ev1 IS NULL THEN
      RAISE EXCEPTION 'PROBE SETUP FAILED: attendance_event_ingest (on-time punch) returned NULL';
    END IF;

    SELECT count(*) INTO v_ev_after_first FROM public.attendance_events;
    IF v_ev_after_first - v_ev_before <> 1 THEN
      RAISE EXCEPTION 'PHANTOM-EVENT GUARD FAILED: global attendance_events moved by % after ingesting the FIRST probe event, expected exactly 1', v_ev_after_first - v_ev_before;
    END IF;

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run1, v_tenant, v_shift, v_date, v_date, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_date, v_date, v_run1);
    IF v_result.groups_processed <> 1 OR v_result.rows_created <> 1 OR v_result.rows_updated <> 0 OR v_result.events_processed <> 1 THEN
      RAISE EXCEPTION 'ASSERTION FAILED: first derive expected the INSERT path (groups=1,created=1,updated=0,events=1), got %', v_result;
    END IF;

    SELECT id, late_entry, is_late, punch_in INTO v_att_id_1, v_late_1, v_islate_1, v_punchin_1
    FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date;

    IF v_late_1 IS DISTINCT FROM false OR v_islate_1 IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'ASSERTION FAILED (not-late row): expected late_entry=false AND is_late=false, got late_entry=%, is_late=%', v_late_1, v_islate_1;
    END IF;
    IF v_punchin_1 IS NOT NULL THEN
      RAISE EXCEPTION 'PHANTOM-EVENT TRAP FAILED: derived INSERT-path row has punch_in=% (expected NULL) -- the 20260828100000 fix regressed', v_punchin_1;
    END IF;

    -- Event 2: punch-in 20 minutes after shift start (09:20), past the 10-minute grace ->
    -- LATE. Same employee, same shift, same calendar date -> resolves to the same
    -- (employee_id, shift_start) group, so re-deriving hits the UPDATE path on the SAME
    -- attendance row created above, flipping its lateness.
    v_ev2 := public.attendance_event_ingest(
      v_tenant, v_employee, (v_date::timestamp + TIME '09:20:00') AT TIME ZONE v_tz,
      NULL, 'device', 'B7b-is-late-sync-probe-late'
    );
    IF v_ev2 IS NULL THEN
      RAISE EXCEPTION 'PROBE SETUP FAILED: attendance_event_ingest (late punch) returned NULL';
    END IF;

    SELECT count(*) INTO v_ev_after_second FROM public.attendance_events;
    IF v_ev_after_second - v_ev_after_first <> 1 THEN
      RAISE EXCEPTION 'PHANTOM-EVENT GUARD FAILED: global attendance_events moved by % after ingesting the SECOND probe event, expected exactly 1', v_ev_after_second - v_ev_after_first;
    END IF;

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run2, v_tenant, v_shift, v_date, v_date, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_date, v_date, v_run2);
    IF v_result.groups_processed <> 1 OR v_result.rows_created <> 0 OR v_result.rows_updated <> 1 OR v_result.events_processed <> 1 THEN
      RAISE EXCEPTION 'ASSERTION FAILED: second derive expected the UPDATE path (groups=1,created=0,updated=1,events=1), got %', v_result;
    END IF;

    SELECT id, late_entry, is_late INTO v_att_id_2, v_late_2, v_islate_2
    FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date;

    IF v_att_id_2 IS DISTINCT FROM v_att_id_1 THEN
      RAISE EXCEPTION 'ASSERTION FAILED: UPDATE path touched a different attendance row (id % -> %), expected the SAME row', v_att_id_1, v_att_id_2;
    END IF;
    IF v_late_2 IS DISTINCT FROM true OR v_islate_2 IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'ASSERTION FAILED (UPDATE-path sync): expected late_entry=true AND is_late=true after re-derivation, got late_entry=%, is_late=%', v_late_2, v_islate_2;
    END IF;

    -- The payroll contract itself, not just the underlying column.
    SELECT late_mark_count INTO v_late_mark_count
    FROM public.payroll_period_input(v_tenant, v_date, v_date)
    WHERE employee_id = v_employee;

    IF v_late_mark_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'ASSERTION FAILED (payroll contract): payroll_period_input.late_mark_count expected 1, got %', v_late_mark_count;
    END IF;

    RAISE NOTICE 'B7b probe (pre-rollback) verified: not-late row (late_entry=%, is_late=%, punch_in=%) -> UPDATE-path re-derivation flips both to late (late_entry=%, is_late=%, same row id=%) -> payroll_period_input.late_mark_count=% -> event deltas +1/+1 (before=%, after_first=%, after_second=%)',
      v_late_1, v_islate_1, v_punchin_1, v_late_2, v_islate_2, v_att_id_2, v_late_mark_count, v_ev_before, v_ev_after_first, v_ev_after_second;

    RAISE EXCEPTION 'B7b probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'B7b probe writes rolled back (2 events, 1 attendance row, 2 attendance_derivation_runs rows)';
  END;

  -- Phantom-event guard, post-rollback: the GLOBAL log must be back to EXACTLY the pre-probe
  -- baseline -- assert the population, not the sample.
  SELECT count(*) INTO v_ev_final FROM public.attendance_events;
  IF v_ev_final <> v_ev_before THEN
    RAISE EXCEPTION 'PHANTOM-EVENT GUARD FAILED: global attendance_events count did not return to baseline % after rollback, now %', v_ev_before, v_ev_final;
  END IF;

  RAISE NOTICE 'B verified: attendance_events baseline % restored exactly after rollback (final=%)', v_ev_before, v_ev_final;
END
$is_late_sync_probe$;
