-- ============================================================================
-- QA fixture battery -- the agent-testable half of the QA plan.
--
--   PART A  Fixture integrity. Everything doc/qa/ promises a human tester is actually
--           there. If A fails, the tester is about to file seed gaps as product bugs.
--   PART B  The attendance derivation truth table, executed for real against the QA
--           tenant's own shift, then rolled back. This is the half a human cannot check
--           by clicking: it needs punches at controlled minutes on controlled dates.
--   PART C  Organisation invariants -- what the DATABASE enforces, as opposed to what the
--           UI merely asks about. The org module's own docs got this wrong twice, so
--           doc/qa/02's "enforced where" column is decided here empirically, never guessed.
--
-- SAFETY: Parts B and C write, and roll every write back through the ZZ001 pattern used by
-- b8_device_ingest_battery.sql, then re-count the affected tables against a baseline taken
-- before the writes. Part B works on dates in 2091 so that even a rollback failure could
-- not collide with a real or QA-visible day.
--
-- OUTPUT: RAISE NOTICE is not surfaced by either the CLI or the raw-SQL endpoint, so every
-- result is also written to a temp table and returned by the SELECT at the end. Read that
-- table -- a silent run tells you nothing. FAIL rows and RAISEs are both real failures;
-- FINDING rows are facts about the product that the QA docs must reflect.
--
-- RUN:  node scratch/apply_sql_direct.mjs doc/verification/qa_fixture_battery.sql
--       (NOT apply_sql_file.mjs -- that one collapses whitespace without stripping `--`
--       comments inside a dollar-quoted block, which folds the whole body into a comment.)
-- ============================================================================

-- ############################################################################
-- PART A -- Fixture integrity (read-only)
-- ############################################################################
DO $part_a$
DECLARE
  t uuid := 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e';
  v_n      integer;
  v_txt    text;
  v_shift  public.shifts%ROWTYPE;
  v_report text[] := ARRAY[]::text[];
BEGIN
  -- A1. The tenant is active and every module the QA plan touches is enabled. A disabled
  -- module makes its tables unreadable through the API regardless of what the UI does, so a
  -- tester would meet empty screens and no error message.
  SELECT string_agg(m, ', ') INTO v_txt
  FROM (
    SELECT unnest(ARRAY['directory','attendance','leave','tasks','policy_center','onboarding','offboarding']) AS m
    EXCEPT
    SELECT tm.module_key FROM public.tenant_modules tm WHERE tm.tenant_id = t AND tm.enabled
  ) x;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'A1 FAILED: modules disabled for the QA tenant: %', v_txt;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = t AND status = 'active') THEN
    RAISE EXCEPTION 'A1 FAILED: QA tenant is not active -- AuthContext signs every user straight back out';
  END IF;
  v_report := v_report || ('A1 PASS' || ': ' || 'QA tenant active; all seven modules under test enabled')::text;

  -- A2. An employee with user_id NULL cannot log in at all -- that is how the module-mix
  -- fixture tenants are built, and exactly what this tenant must not be.
  -- Scoped to the six FIXTURE employees, not the tenant. OM-12 has QA create an employee, and
  -- a tenant-wide count would then fail on the tester's own test step.
  SELECT count(*) INTO v_n FROM public.employees
   WHERE tenant_id = t AND status = 'active' AND user_id IS NOT NULL
     AND id IN ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
                'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
                'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006');
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'A2 FAILED: expected the 6 fixture employees active and auth-backed, got %', v_n;
  END IF;
  v_report := v_report || ('A2 PASS' || ': ' || '6 active employees, every one auth-backed')::text;

  -- A3. is_hr() reads auth.users.metadata->>'role' first, and the frontend reads ONLY that
  -- (AuthContext.extractRole accepts superadmin | hr | employee). An employee_roles row of
  -- 'owner' satisfies neither. Checking the metadata is the only check that predicts what a
  -- tester will actually see on screen.
  SELECT count(*) INTO v_n FROM public.employees e JOIN auth.users u ON u.id = e.user_id
   WHERE e.tenant_id = t AND e.id IN ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
                'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
                'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006') AND u.metadata->>'role' = 'hr';
  IF v_n <> 1 THEN RAISE EXCEPTION 'A3 FAILED: expected exactly 1 fixture employee with metadata role=hr, got %', v_n; END IF;

  -- Scoped to the fixture: an employee QA creates in OM-12 would otherwise make this 6.
  SELECT count(*) INTO v_n FROM public.employees e JOIN auth.users u ON u.id = e.user_id
   WHERE e.tenant_id = t AND e.id IN ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
                'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
                'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006') AND u.metadata->>'role' = 'employee';
  IF v_n <> 5 THEN RAISE EXCEPTION 'A3 FAILED: expected 5 fixture employees with metadata role=employee, got %', v_n; END IF;

  -- get_auth_tenant_id() reads metadata->>'tenant_id'; a NULL there makes the RESTRICTIVE
  -- tenant fence return 0 rows on every table, which looks exactly like a broken product.
  SELECT count(*) INTO v_n FROM public.employees e JOIN auth.users u ON u.id = e.user_id
   WHERE e.tenant_id = t AND NULLIF(u.metadata->>'tenant_id','')::uuid IS DISTINCT FROM t;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'A3 FAILED: % QA users carry a wrong or missing metadata.tenant_id', v_n;
  END IF;
  v_report := v_report || ('A3 PASS' || ': ' || '1 HR session + 5 employee sessions, all stamped with the QA tenant')::text;

  -- A4. AuthContext derives isManager from COUNT(employees.manager_id = me.id) -- not from
  -- any role row. Zero reports means the Team screens never render and every manager case
  -- in doc/qa/ is unrunnable.
  SELECT count(*) INTO v_n FROM public.employees
   WHERE tenant_id = t AND manager_id = 'e0000000-0000-0000-0000-000000000002';
  IF v_n < 1 THEN RAISE EXCEPTION 'A4 FAILED: QA Manager has 0 direct reports; isManager would be false'; END IF;
  v_report := v_report || format('A4 PASS: QA Manager has %s direct reports, so isManager resolves true', v_n)::text;

  -- A5. Attendance prerequisites.
  SELECT count(*) INTO v_n FROM public.shifts WHERE tenant_id = t AND is_active AND is_default;
  IF v_n <> 1 THEN RAISE EXCEPTION 'A5 FAILED: expected exactly 1 active default shift, got %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.employees e
   WHERE e.tenant_id = t AND e.status = 'active' AND e.id IN ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
                'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
                'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006')
     AND NOT EXISTS (SELECT 1 FROM public.employee_shifts es WHERE es.employee_id = e.id AND es.tenant_id = t);
  IF v_n <> 0 THEN RAISE EXCEPTION 'A5 FAILED: % fixture employees have no shift assignment; derivation skips them', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.employees
   WHERE tenant_id = t AND status = 'active' AND id IN ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
                'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
                'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006') AND coalesce(employee_code,'') = '';
  IF v_n <> 0 THEN RAISE EXCEPTION 'A5 FAILED: % fixture employees have no employee_code; the kiosk cannot resolve them', v_n; END IF;

  -- Employees QA created themselves are reported, never raised on -- a missing code on a
  -- hand-created employee is a product observation for OM-12, not a broken fixture.
  SELECT count(*) INTO v_n FROM public.employees
   WHERE tenant_id = t AND status = 'active' AND id NOT IN ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
                'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
                'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006') AND coalesce(employee_code,'') = '';
  IF v_n > 0 THEN
    v_report := v_report || format('A5 FINDING: %s QA-created employee(s) have no employee_code and could not use a kiosk. Relevant to OM-12; not a fixture fault.', v_n)::text;
  END IF;
  v_report := v_report || ('A5 PASS' || ': ' || '1 default shift, every employee assigned, every employee has a code')::text;

  -- A6. Leave prerequisites, including the ledger identity nothing in the schema enforces.
  SELECT count(*) INTO v_n FROM public.leave_types WHERE tenant_id = t AND is_active;
  IF v_n < 4 THEN RAISE EXCEPTION 'A6 FAILED: expected >= 4 active leave types, got %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.leave_balances
   WHERE tenant_id = t AND year = 2026 AND balance <> (total_allocated + carried_forward - used_days);
  IF v_n <> 0 THEN RAISE EXCEPTION 'A6 FAILED: % leave balances break allocated + carried - used = balance', v_n; END IF;

  SELECT count(*) INTO v_n
  FROM public.employees e CROSS JOIN public.leave_types lt
  WHERE e.tenant_id = t AND e.status = 'active' AND e.id IN ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
                'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
                'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006')
    AND lt.tenant_id = t AND lt.is_active
    AND NOT EXISTS (SELECT 1 FROM public.leave_balances lb
                     WHERE lb.employee_id = e.id AND lb.leave_type_id = lt.id AND lb.year = 2026);
  IF v_n <> 0 THEN RAISE EXCEPTION 'A6 FAILED: % (fixture employee, leave type) pairs have no 2026 balance row', v_n; END IF;
  v_report := v_report || ('A6 PASS' || ': ' || '4 leave types, complete 2026 ledger, arithmetic consistent')::text;

  -- A7. The default shift's numbers are the ones doc/qa/03's boundary cases are written
  -- against. Retune the shift and those cases go stale silently; this is what makes it loud.
  SELECT * INTO v_shift FROM public.shifts WHERE id = 'da7a0000-0000-0000-0004-000000000001';
  IF v_shift.start_time <> TIME '09:30' OR v_shift.end_time <> TIME '18:30' THEN
    RAISE EXCEPTION 'A7 FAILED: General shift is %-%; doc/qa/03 is written against 09:30-18:30', v_shift.start_time, v_shift.end_time;
  END IF;
  IF NOT v_shift.enable_late_entry_marking OR v_shift.late_entry_grace_minutes <> 10 THEN
    RAISE EXCEPTION 'A7 FAILED: late marking %, grace %; doc/qa/03 assumes ON with grace 10',
      v_shift.enable_late_entry_marking, v_shift.late_entry_grace_minutes;
  END IF;
  IF v_shift.working_hours_threshold_for_absent <> 2.0 OR v_shift.working_hours_threshold_for_half_day <> 4.0 THEN
    RAISE EXCEPTION 'A7 FAILED: thresholds absent<% half<%; doc/qa/03 assumes 2.0 and 4.0',
      v_shift.working_hours_threshold_for_absent, v_shift.working_hours_threshold_for_half_day;
  END IF;
  IF v_shift.working_days <> ARRAY[1,2,3,4,5,6] THEN
    RAISE EXCEPTION 'A7 FAILED: working_days is %; doc/qa/03 assumes Mon-Sat', v_shift.working_days;
  END IF;
  v_report := v_report || ('A7 PASS' || ': ' || 'General shift 09:30-18:30 Mon-Sat, late grace 10, thresholds 2.0 / 4.0')::text;

  -- A8. last_sync_of_events gates Pass 2's absent-marking entirely: NULL means no absent row
  -- is ever created, however many days an employee misses. A tester told to expect "Absent"
  -- on an unpunched day would be filing a bug against correct behaviour.
  IF v_shift.last_sync_of_events IS NOT NULL THEN
    v_report := v_report || format('Absent-marking IS active: General shift watermark = %s. doc/qa/03 AT-09 should expect Absent up to that date.', v_shift.last_sync_of_events)::text;
  ELSE
    v_report := v_report || ('A8 FINDING' || ': ' || 'General shift last_sync_of_events is NULL, so Pass 2 will NEVER mark a day Absent. doc/qa/03 AT-09 must expect NO ROW, not Absent.')::text;
  END IF;

  RAISE EXCEPTION 'REPORT :: %', array_to_string(v_report, ' || ') USING ERRCODE = 'ZZ002';
END
$part_a$;


-- ############################################################################
-- PART B -- Attendance derivation truth table (writes, rolled back)
--
-- Dates in 2091, chosen for their weekday:
--   01-01 Mon, 01-02 Tue, 01-03 Wed, 01-04 Thu, 01-05 Fri, 01-06 Sat, 01-07 Sun.
-- Subject: QA Normal Employee. Times are Asia/Kolkata local.
-- ############################################################################
DO $part_b$
DECLARE
  t       uuid := 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e';
  v_shift uuid := 'da7a0000-0000-0000-0004-000000000001';
  v_emp   uuid := 'e0000000-0000-0000-0000-000000000003';
  v_lt_cl uuid := 'da7a0000-0000-0000-0006-000000000001';
  v_tz    text := 'Asia/Kolkata';

  v_att_base bigint; v_ev_base bigint; v_run_base bigint; v_lv_base bigint;
  v_att_now  bigint; v_ev_now  bigint; v_run_now  bigint; v_lv_now  bigint;

  v_run      uuid;
  v_row      record;
  v_ignore   record;
  v_leave_id uuid;
  v_results  text[] := ARRAY[]::text[];   -- survives the ZZ001 subtransaction rollback
BEGIN
  SELECT count(*) INTO v_att_base FROM public.attendance;
  SELECT count(*) INTO v_ev_base  FROM public.attendance_events;
  SELECT count(*) INTO v_run_base FROM public.attendance_derivation_runs;
  SELECT count(*) INTO v_lv_base  FROM public.leaves;

  BEGIN
    -- B1. On time. 09:29 precedes the shift start, so late_entry must be false whatever the
    -- grace is. Eight hours worked -> present.
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-01', DATE '2091-01-01', 'manual', 0,0,0,0,0, now(), 'running');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-01' + TIME '09:29') AT TIME ZONE v_tz, NULL, 'kiosk', 'B1-in');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-01' + TIME '18:30') AT TIME ZONE v_tz, NULL, 'kiosk', 'B1-out');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass1(t, v_shift, DATE '2091-01-01', DATE '2091-01-01', v_run);

    SELECT status, late_entry, round(work_hours::numeric,2) AS hrs INTO v_row
      FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-01';
    IF NOT FOUND THEN RAISE EXCEPTION 'B1 FAILED: no attendance row derived from two punches'; END IF;
    IF v_row.status <> 'present' THEN RAISE EXCEPTION 'B1 FAILED: 09:29-18:30 gave %, expected present', v_row.status; END IF;
    IF v_row.late_entry THEN RAISE EXCEPTION 'B1 FAILED: a 09:29 punch was marked late'; END IF;
    v_results := v_results || format('B1 PASS: 09:29 -> 18:30 = present, not late, %s hours', v_row.hrs);

    -- B2a. The grace boundary. late_entry is `in_time > start + grace`, a STRICT comparison:
    -- with start 09:30 and grace 10, exactly 09:40 is on time. The likeliest off-by-one in
    -- the module, and not checkable by hand without a stopwatch.
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-02', DATE '2091-01-02', 'manual', 0,0,0,0,0, now(), 'running');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-02' + TIME '09:40') AT TIME ZONE v_tz, NULL, 'kiosk', 'B2-in');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-02' + TIME '18:30') AT TIME ZONE v_tz, NULL, 'kiosk', 'B2-out');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass1(t, v_shift, DATE '2091-01-02', DATE '2091-01-02', v_run);

    SELECT status, late_entry INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-02';
    IF v_row.late_entry THEN RAISE EXCEPTION 'B2a FAILED: 09:40 with a 10-minute grace was marked late -- the comparison is not strict'; END IF;
    v_results := v_results || 'B2a PASS: 09:40 sits exactly on the grace boundary and is NOT late'::text;

    -- B2b. One minute past the boundary is late; the status stays present, because lateness
    -- is a flag and never a status; and late_entry and is_late must agree (they disagreed
    -- once, and a genuinely late day displayed as on time).
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-03', DATE '2091-01-03', 'manual', 0,0,0,0,0, now(), 'running');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-03' + TIME '09:41') AT TIME ZONE v_tz, NULL, 'kiosk', 'B2-in2');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-03' + TIME '18:30') AT TIME ZONE v_tz, NULL, 'kiosk', 'B2-out2');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass1(t, v_shift, DATE '2091-01-03', DATE '2091-01-03', v_run);

    SELECT status, late_entry, is_late INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-03';
    IF NOT v_row.late_entry THEN RAISE EXCEPTION 'B2b FAILED: 09:41 with a 10-minute grace was NOT marked late'; END IF;
    IF v_row.is_late IS DISTINCT FROM v_row.late_entry THEN
      RAISE EXCEPTION 'B2b FAILED: late_entry=% but is_late=% -- the two columns disagree', v_row.late_entry, v_row.is_late;
    END IF;
    IF v_row.status <> 'present' THEN
      RAISE EXCEPTION 'B2b FAILED: a late full day gave status %, expected present', v_row.status;
    END IF;
    v_results := v_results || 'B2b PASS: 09:41 IS late, late_entry = is_late, status stays present'::text;

    -- B3a. Hour thresholds: absent < 2.0 <= half_day < 4.0 <= present, absent checked first.
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-04', DATE '2091-01-04', 'manual', 0,0,0,0,0, now(), 'running');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-04' + TIME '09:30') AT TIME ZONE v_tz, NULL, 'kiosk', 'B3-in');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-04' + TIME '12:30') AT TIME ZONE v_tz, NULL, 'kiosk', 'B3-out');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass1(t, v_shift, DATE '2091-01-04', DATE '2091-01-04', v_run);

    SELECT status, round(work_hours::numeric,2) AS hrs INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-04';
    IF v_row.status <> 'half_day' THEN RAISE EXCEPTION 'B3a FAILED: %s worked hours gave %, expected half_day', v_row.hrs, v_row.status; END IF;
    v_results := v_results || format('B3a PASS: %s hours -> half_day', v_row.hrs);

    -- B3b. Under the absent threshold the employee is Absent even though they did punch.
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-05', DATE '2091-01-05', 'manual', 0,0,0,0,0, now(), 'running');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-05' + TIME '09:30') AT TIME ZONE v_tz, NULL, 'kiosk', 'B3-in2');
    PERFORM public.attendance_event_ingest(t, v_emp, (DATE '2091-01-05' + TIME '10:30') AT TIME ZONE v_tz, NULL, 'kiosk', 'B3-out2');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass1(t, v_shift, DATE '2091-01-05', DATE '2091-01-05', v_run);

    SELECT status, round(work_hours::numeric,2) AS hrs INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-05';
    IF v_row.status <> 'absent' THEN RAISE EXCEPTION 'B3b FAILED: %s worked hours gave %, expected absent', v_row.hrs, v_row.status; END IF;
    v_results := v_results || format('B3b PASS: %s hours -> absent, despite a real punch pair', v_row.hrs);

    -- B4. Pass 2 on a Sunday. The General shift works Mon-Sat, so this must be weekly_off
    -- with no punches at all.
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-07', DATE '2091-01-07', 'manual', 0,0,0,0,0, now(), 'running');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass2(t, v_shift, DATE '2091-01-07', DATE '2091-01-07', v_run);

    SELECT status INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-07';
    IF NOT FOUND THEN RAISE EXCEPTION 'B4 FAILED: Pass 2 derived no row for a Sunday'; END IF;
    IF v_row.status <> 'weekly_off' THEN RAISE EXCEPTION 'B4 FAILED: Sunday derived as %, expected weekly_off', v_row.status; END IF;
    v_results := v_results || 'B4 PASS: Sunday derives weekly_off (General shift is Mon-Sat)'::text;

    -- B5a. Approved leave beats absence, and the derived row must carry the leave_id --
    -- a status string alone leaves payroll unable to trace which leave paid for the day.
    INSERT INTO public.leaves (tenant_id, employee_id, leave_type, leave_type_id, start_date, end_date, total_days, status, day_fraction, reason)
    VALUES (t, v_emp, 'casual', v_lt_cl, DATE '2091-01-06', DATE '2091-01-06', 1, 'approved', 1.0, 'QA battery B5')
    RETURNING id INTO v_leave_id;

    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-06', DATE '2091-01-06', 'manual', 0,0,0,0,0, now(), 'running');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass2(t, v_shift, DATE '2091-01-06', DATE '2091-01-06', v_run);

    SELECT status, leave_id INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-06';
    IF NOT FOUND THEN RAISE EXCEPTION 'B5a FAILED: no row derived for an approved-leave day'; END IF;
    IF v_row.status <> 'on_leave' THEN RAISE EXCEPTION 'B5a FAILED: a full-day approved leave derived as %, expected on_leave', v_row.status; END IF;
    IF v_row.leave_id IS DISTINCT FROM v_leave_id THEN RAISE EXCEPTION 'B5a FAILED: the derived row does not carry the approving leave_id'; END IF;
    v_results := v_results || 'B5a PASS: a full-day approved leave derives on_leave and carries its leave_id'::text;

    -- B5b. day_fraction is the only policy value that crosses from leave into attendance.
    -- Ignore it and a half day is paid as a whole one.
    UPDATE public.leaves SET day_fraction = 0.5 WHERE id = v_leave_id;
    DELETE FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-06';
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-06', DATE '2091-01-06', 'manual', 0,0,0,0,0, now(), 'running');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass2(t, v_shift, DATE '2091-01-06', DATE '2091-01-06', v_run);

    SELECT status INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-06';
    IF v_row.status <> 'half_day' THEN RAISE EXCEPTION 'B5b FAILED: a day_fraction 0.5 leave derived as %, expected half_day', v_row.status; END IF;
    v_results := v_results || 'B5b PASS: day_fraction 0.5 derives half_day, not on_leave'::text;

    -- B6. Idempotence. The scheduler re-derives a two-day lookback every hour, so a
    -- non-idempotent pass would corrupt yesterday all day long.
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-01', DATE '2091-01-01', 'manual', 0,0,0,0,0, now(), 'running');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass1(t, v_shift, DATE '2091-01-01', DATE '2091-01-01', v_run);

    SELECT count(*) AS n INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-01';
    IF v_row.n <> 1 THEN RAISE EXCEPTION 'B6 FAILED: re-deriving produced % rows, expected 1', v_row.n; END IF;
    SELECT status INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-01';
    IF v_row.status <> 'present' THEN RAISE EXCEPTION 'B6 FAILED: a second pass changed the status to %', v_row.status; END IF;
    v_results := v_results || 'B6 PASS: re-deriving the same day is idempotent -- one row, same status'::text;

    -- B7. is_locked is honoured. HR corrections set it; were derivation to ignore it, the
    -- next scheduled run would silently revert every correction HR ever made.
    UPDATE public.attendance SET status = 'present', is_locked = true
     WHERE employee_id = v_emp AND date = DATE '2091-01-05';
    v_run := gen_random_uuid();
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, events_processed, rows_created, rows_updated, rows_skipped, error_count, started_at, status)
    VALUES (v_run, t, v_shift, DATE '2091-01-05', DATE '2091-01-05', 'manual', 0,0,0,0,0, now(), 'running');
    SELECT * INTO v_ignore FROM public.attendance_derive_pass1(t, v_shift, DATE '2091-01-05', DATE '2091-01-05', v_run);

    SELECT status INTO v_row FROM public.attendance WHERE employee_id = v_emp AND date = DATE '2091-01-05';
    IF v_row.status <> 'present' THEN
      RAISE EXCEPTION 'B7 FAILED: derivation overwrote a locked row (now %) -- every HR correction would revert', v_row.status;
    END IF;
    v_results := v_results || 'B7 PASS: a locked day survives re-derivation; HR corrections are safe'::text;

    RAISE EXCEPTION 'qa battery rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;
  END;


  SELECT count(*) INTO v_att_now FROM public.attendance;
  SELECT count(*) INTO v_ev_now  FROM public.attendance_events;
  SELECT count(*) INTO v_run_now FROM public.attendance_derivation_runs;
  SELECT count(*) INTO v_lv_now  FROM public.leaves;
  IF v_att_now <> v_att_base THEN RAISE EXCEPTION 'ROLLBACK FAILED: attendance % -> %', v_att_base, v_att_now; END IF;
  IF v_ev_now  <> v_ev_base  THEN RAISE EXCEPTION 'ROLLBACK FAILED: attendance_events % -> %', v_ev_base, v_ev_now; END IF;
  IF v_run_now <> v_run_base THEN RAISE EXCEPTION 'ROLLBACK FAILED: derivation_runs % -> %', v_run_base, v_run_now; END IF;
  IF v_lv_now  <> v_lv_base  THEN RAISE EXCEPTION 'ROLLBACK FAILED: leaves % -> %', v_lv_base, v_lv_now; END IF;

  v_results := v_results || format(
    'B-rollback PASS: all Part B writes rolled back; population restored (attendance %s, events %s, runs %s, leaves %s)',
    v_att_base, v_ev_base, v_run_base, v_lv_base)::text;

  -- A DO block cannot return rows, and NOTICE is not surfaced by the raw-SQL endpoint. ZZ002
  -- is the report channel: scratch/qa-battery-run.mjs prints it as a report, not a failure.
  RAISE EXCEPTION 'REPORT :: %', array_to_string(v_results, ' || ') USING ERRCODE = 'ZZ002';
END
$part_b$;


-- ############################################################################
-- PART C -- Organisation: what the DATABASE enforces, and what it does not
-- ############################################################################
DO $part_c$
DECLARE
  t         uuid := 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e';
  v_emp_a   uuid := 'e0000000-0000-0000-0000-000000000002';   -- QA Manager
  v_emp_b   uuid := 'e0000000-0000-0000-0000-000000000003';   -- QA Normal Employee
  v_ou_base bigint;
  v_ou_now  bigint;
  v_unit    uuid;
  v_blocked boolean;
  v_n       integer;
  v_results text[] := ARRAY[]::text[];
BEGIN
  SELECT count(*) INTO v_ou_base FROM public.org_units;

  BEGIN
    -- C1. Archiving an org unit that still holds employees. The UI shows a confirm dialog
    -- and archives anyway; the question is whether anything stops a direct API write.
    SELECT org_unit_id INTO v_unit FROM public.employees WHERE id = v_emp_b;
    IF v_unit IS NULL THEN RAISE EXCEPTION 'C1 SETUP FAILED: QA Normal Employee is in no org unit'; END IF;
    SELECT count(*) INTO v_n FROM public.employees WHERE org_unit_id = v_unit AND tenant_id = t AND status = 'active';

    v_blocked := false;
    BEGIN
      UPDATE public.org_units SET is_active = false WHERE id = v_unit AND tenant_id = t;
    EXCEPTION WHEN OTHERS THEN v_blocked := true;
    END;

    IF v_blocked THEN
      v_results := v_results || format('C1 PASS: Deactivating an org unit holding %s employees IS blocked in the database', v_n);
    ELSE
      v_results := v_results || format('C1 FINDING: Deactivating an org unit holding %s active employees is NOT blocked in the database. The window.confirm() is the only guard, and any direct API call walks past it. doc/qa/02 OM-07 must say UI-only.', v_n);
    END IF;

    -- C2. A self-referencing manager -- the shortest possible reporting cycle.
    v_blocked := false;
    BEGIN
      UPDATE public.employees SET manager_id = v_emp_a WHERE id = v_emp_a AND tenant_id = t;
    EXCEPTION WHEN OTHERS THEN v_blocked := true;
    END;
    IF v_blocked THEN
      v_results := v_results || 'C2 PASS: A self-referencing manager_id IS rejected by the database'::text;
    ELSE
      v_results := v_results || 'C2 FINDING: A self-referencing manager_id is NOT rejected by the database; the cycle guard lives only in the RPC. doc/qa/02 OM-09 must say RPC-only.'::text;
    END IF;

    -- C3. A two-step cycle, A -> B -> A. Same question one level deeper.
    v_blocked := false;
    BEGIN
      UPDATE public.employees SET manager_id = v_emp_b WHERE id = v_emp_a AND tenant_id = t;
      UPDATE public.employees SET manager_id = v_emp_a WHERE id = v_emp_b AND tenant_id = t;
    EXCEPTION WHEN OTHERS THEN v_blocked := true;
    END;
    IF v_blocked THEN
      v_results := v_results || 'C3 PASS: A two-step reporting cycle IS rejected by the database'::text;
    ELSE
      v_results := v_results || 'C3 FINDING: A two-step reporting cycle (A->B->A) is NOT rejected by the database'::text;
    END IF;

    -- C4. Cross-tenant contamination. This one is a tenancy leak, not a usability guardrail,
    -- and genuinely should be enforced.
    SELECT id INTO v_unit FROM public.org_units WHERE tenant_id <> t AND is_active LIMIT 1;
    IF v_unit IS NULL THEN
      v_results := v_results || 'C4 SKIP: No other tenant has an org unit to attempt a cross-tenant assignment with'::text;
    ELSE
      v_blocked := false;
      BEGIN
        UPDATE public.employees SET org_unit_id = v_unit WHERE id = v_emp_b AND tenant_id = t;
      EXCEPTION WHEN OTHERS THEN v_blocked := true;
      END;
      IF v_blocked THEN
        v_results := v_results || 'C4 PASS: Assigning an employee to another tenant''s org unit IS rejected'::text;
      ELSE
        v_results := v_results || 'C4 FINDING: An employee was assigned to ANOTHER TENANT''S org unit with no error. Nothing in the schema fences org_unit_id to the employee''s own tenant.'::text;
      END IF;
    END IF;

    RAISE EXCEPTION 'qa battery rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;
  END;


  SELECT count(*) INTO v_ou_now FROM public.org_units;
  IF v_ou_now <> v_ou_base THEN RAISE EXCEPTION 'ROLLBACK FAILED: org_units % -> %', v_ou_base, v_ou_now; END IF;

  -- C5 (read-only). Whatever C1-C4 concluded about enforcement, the live data must be clean
  -- right now: no cross-tenant unit, no cross-tenant manager, no self-manager.
  SELECT count(*) INTO v_n FROM public.employees e JOIN public.org_units o ON o.id = e.org_unit_id
   WHERE e.org_unit_id IS NOT NULL AND o.tenant_id <> e.tenant_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'C5 FAILED: % employees sit in an org unit belonging to a DIFFERENT tenant', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.employees e JOIN public.employees m ON m.id = e.manager_id
   WHERE e.manager_id IS NOT NULL AND m.tenant_id <> e.tenant_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'C5 FAILED: % employees report to a manager in a DIFFERENT tenant', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.employees e WHERE e.manager_id = e.id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'C5 FAILED: % employees are their own manager', v_n; END IF;

  v_results := v_results || 'C5 PASS: live data clean -- no cross-tenant org units, no cross-tenant managers, no self-managers'::text;
  v_results := v_results || format('C-rollback PASS: all Part C writes rolled back; org_units still %s', v_ou_base)::text;

  RAISE EXCEPTION 'REPORT :: %', array_to_string(v_results, ' || ') USING ERRCODE = 'ZZ002';
END
$part_c$;
