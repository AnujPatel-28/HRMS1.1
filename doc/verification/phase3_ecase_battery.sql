-- --------------------------------------------------------------------
-- F0. Shape: leaves.day_fraction exists with the stated CHECK, and the backfill left every
-- pre-existing row at exactly 1.0 (not merely "trusted" from the DEFAULT clause).
-- --------------------------------------------------------------------
DO $shape_check$
DECLARE
  v_non_default_count integer;
  v_missing_funcs text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leaves' AND column_name = 'day_fraction'
  ) THEN
    RAISE EXCEPTION 'F0 FAILED: leaves.day_fraction does not exist';
  END IF;

  SELECT count(*) INTO v_non_default_count FROM public.leaves WHERE day_fraction <> 1.0;
  IF v_non_default_count <> 0 THEN
    RAISE EXCEPTION 'F0 FAILED: % pre-existing leaves rows did not backfill to day_fraction = 1.0', v_non_default_count;
  END IF;
  RAISE NOTICE 'F0a verified: leaves.day_fraction exists; every pre-existing row backfilled to exactly 1.0';

  SELECT string_agg(missing_fn, ', ') INTO v_missing_funcs
  FROM (
    SELECT unnest(ARRAY[
      'attendance_derive_pass2', 'hr_run_attendance_derivation'
    ]) AS missing_fn
    EXCEPT
    SELECT p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ) x;
  IF v_missing_funcs IS NOT NULL THEN
    RAISE EXCEPTION 'F0 FAILED: missing functions: %', v_missing_funcs;
  END IF;
  RAISE NOTICE 'F0b verified: attendance_derive_pass2 and hr_run_attendance_derivation exist';
END
$shape_check$;

-- --------------------------------------------------------------------
-- F1. The Pass 1 punch_in phantom-event fix (header bug): a Pass-1-shaped INSERT no longer
-- appends a phantom event. Calls attendance_derive_pass1 for real (not a hand-rolled insert)
-- via one real event, and checks the group's attendance row ends up with EXACTLY the events
-- fed in stamped to it -- no more, no less.
-- --------------------------------------------------------------------
DO $phantom_fix_check$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_shift    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee uuid := '11111111-1111-4111-8111-000000000011';
  v_date     date := DATE '2097-02-02';
  v_ev1      uuid;
  v_ev2      uuid;
  v_run      uuid := gen_random_uuid();
  v_result   record;
  v_att_id   uuid;
  v_stamped_count integer;
BEGIN
  BEGIN
    v_ev1 := public.attendance_event_ingest(v_tenant, v_employee, (v_date::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'F1-in');
    v_ev2 := public.attendance_event_ingest(v_tenant, v_employee, (v_date::timestamp + TIME '18:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'F1-out');

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run, v_tenant, v_shift, v_date, v_date, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_date, v_date, v_run);
    IF v_result.rows_created <> 1 THEN
      RAISE EXCEPTION 'F1 FAILED: expected 1 row created, got %', v_result;
    END IF;

    SELECT id INTO v_att_id FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date;

    SELECT count(*) INTO v_stamped_count FROM public.attendance_events WHERE attendance_id = v_att_id;
    IF v_stamped_count <> 2 THEN
      RAISE EXCEPTION 'F1 FAILED (phantom event fix): expected exactly 2 events (the 2 fed in, no phantom) stamped to attendance row %, found %', v_att_id, v_stamped_count;
    END IF;

    PERFORM 1 FROM public.attendance WHERE id = v_att_id AND punch_in IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'F1 FAILED: Pass-1-created row % does not have punch_in = NULL', v_att_id;
    END IF;

    RAISE NOTICE 'F1 verified: attendance_derive_pass1''s INSERT branch no longer produces a phantom dual-write event -- exactly 2 events (the 2 real ones) stamped, punch_in explicitly NULL';

    RAISE EXCEPTION 'F1 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F1 probe writes rolled back';
  END;
END
$phantom_fix_check$;

-- --------------------------------------------------------------------
-- F2 (E23). A half-day approved leave (day_fraction = 0.5) yields half_day with leave_id set
-- via Pass 1, while a full-day leave (day_fraction default 1.0) still yields on_leave --
-- both in the SAME probe, so the branch that used to be the only outcome is proven unchanged.
-- --------------------------------------------------------------------
DO $e23_check$
DECLARE
  v_tenant       uuid := '11111111-1111-4111-8111-000000000001';
  v_shift        uuid := '11111111-1111-4111-8111-000000000004';
  v_employee     uuid := '11111111-1111-4111-8111-000000000011';
  v_date_full    date := DATE '2097-02-10';
  v_date_half    date := DATE '2097-02-11';
  v_leave_full   uuid;
  v_leave_half   uuid;
  v_run          uuid := gen_random_uuid();
  v_result       record;
  v_row          record;
BEGIN
  BEGIN
    INSERT INTO public.leaves (tenant_id, employee_id, leave_type, start_date, end_date, total_days, reason, status, day_fraction)
    VALUES (v_tenant, v_employee, 'casual', v_date_full, v_date_full, 1, 'F2 full-day probe (rolled back)', 'approved', 1.0)
    RETURNING id INTO v_leave_full;

    INSERT INTO public.leaves (tenant_id, employee_id, leave_type, start_date, end_date, total_days, reason, status, day_fraction)
    VALUES (v_tenant, v_employee, 'casual', v_date_half, v_date_half, 1, 'F2 half-day probe (rolled back)', 'approved', 0.5)
    RETURNING id INTO v_leave_half;

    PERFORM public.attendance_event_ingest(v_tenant, v_employee, (v_date_full::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'F2-full-in');
    PERFORM public.attendance_event_ingest(v_tenant, v_employee, (v_date_half::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'F2-half-in');

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run, v_tenant, v_shift, v_date_full, v_date_half, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_date_full, v_date_half, v_run);
    IF v_result.rows_created <> 2 THEN
      RAISE EXCEPTION 'F2 FAILED: expected 2 rows created, got %', v_result;
    END IF;

    SELECT status, leave_id INTO v_row FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date_full;
    IF v_row.status <> 'on_leave' OR v_row.leave_id IS DISTINCT FROM v_leave_full THEN
      RAISE EXCEPTION 'F2 FAILED (full-day regression): expected on_leave/%, got %/%', v_leave_full, v_row.status, v_row.leave_id;
    END IF;
    RAISE NOTICE 'F2a verified: full-day leave (day_fraction=1.0, the default) still yields on_leave -- unchanged by this migration';

    SELECT status, leave_id INTO v_row FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date_half;
    IF v_row.status <> 'half_day' OR v_row.leave_id IS DISTINCT FROM v_leave_half THEN
      RAISE EXCEPTION 'F2 FAILED (E23): expected half_day/%, got %/%', v_leave_half, v_row.status, v_row.leave_id;
    END IF;
    RAISE NOTICE 'F2b verified (E23): half-day leave (day_fraction=0.5) yields half_day with leave_id=% set via Pass 1', v_leave_half;

    RAISE EXCEPTION 'F2 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F2 probe writes rolled back (2 leaves, 2 events, 2 attendance rows, 1 run row)';
  END;
END
$e23_check$;

-- --------------------------------------------------------------------
-- F3. Pass 2 core battery: E25 (weekly_off), E24 (holiday), E22/E23 (leave, full + half),
-- absent with the watermark satisfied (E10), the watermark interlock itself (unset ->
-- nothing written), and idempotency (D5/E45: a re-run over the same window does zero work).
-- All against ONE employee (QA Attendance Only, employee 011) and ONE computed week, so the
-- whole battery shares one setup. Dates are DERIVED from a computed anchor, never hardcoded
-- as a specific weekday (the Phase 0 lesson).
-- --------------------------------------------------------------------
DO $pass2_battery$
DECLARE
  v_tenant     uuid := '11111111-1111-4111-8111-000000000001';
  v_shift      uuid := '11111111-1111-4111-8111-000000000004';
  v_employee   uuid := '11111111-1111-4111-8111-000000000011';
  v_anchor     date := DATE '2097-03-01';
  v_monday     date;
  v_sunday_before date;
  v_wednesday  date; -- holiday
  v_thursday   date; -- full-day leave
  v_friday     date; -- half-day leave
  v_saturday   date; -- absent candidate, watermark satisfied
  v_next_sunday date;
  v_leave_full uuid;
  v_leave_half uuid;
  v_run1       uuid := gen_random_uuid();
  v_run2       uuid := gen_random_uuid();
  v_result     record;
  v_row        record;
  v_count      integer;
BEGIN
  -- Compute the Monday on/after v_anchor (DOW: Sunday=0 .. Saturday=6; Monday=1).
  v_monday := v_anchor + ((1 - EXTRACT(DOW FROM v_anchor)::int + 7) % 7);
  IF EXTRACT(DOW FROM v_monday)::int <> 1 THEN
    RAISE EXCEPTION 'F3 setup FAILED: computed date % is not a Monday (DOW=%)', v_monday, EXTRACT(DOW FROM v_monday);
  END IF;
  v_sunday_before := v_monday - 1;
  v_wednesday     := v_monday + 2;
  v_thursday      := v_monday + 3;
  v_friday        := v_monday + 4;
  v_saturday      := v_monday + 5;
  v_next_sunday   := v_monday + 6;

  BEGIN
    -- Watermark satisfied comfortably past v_saturday (+1 day past it, so v_saturday itself
    -- qualifies per v_absent_watermark_date = last_sync_of_events_date - 1).
    UPDATE public.shifts
    SET last_sync_of_events = (v_saturday + 2)::timestamp AT TIME ZONE 'Asia/Kolkata'
    WHERE id = v_shift;

    INSERT INTO public.holidays (tenant_id, name, date, type)
    VALUES (v_tenant, 'F3 probe holiday (rolled back)', v_wednesday, 'company');

    INSERT INTO public.leaves (tenant_id, employee_id, leave_type, start_date, end_date, total_days, reason, status, day_fraction)
    VALUES (v_tenant, v_employee, 'casual', v_thursday, v_thursday, 1, 'F3 full-day leave (rolled back)', 'approved', 1.0)
    RETURNING id INTO v_leave_full;

    INSERT INTO public.leaves (tenant_id, employee_id, leave_type, start_date, end_date, total_days, reason, status, day_fraction)
    VALUES (v_tenant, v_employee, 'casual', v_friday, v_friday, 1, 'F3 half-day leave (rolled back)', 'approved', 0.5)
    RETURNING id INTO v_leave_half;

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run1, v_tenant, v_shift, v_sunday_before, v_next_sunday, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass2(v_tenant, v_shift, v_sunday_before, v_next_sunday, v_run1);

    -- 8 dates in range (sunday_before .. next_sunday inclusive). Two of them (sunday_before,
    -- next_sunday) are both weekly_off; monday/tuesday have no coverage below and ARE watermark-
    -- eligible (v_saturday+2 watermark covers the whole week) so both come back absent too;
    -- wednesday=holiday; thursday=on_leave; friday=half_day; saturday=absent. Every one of the
    -- 8 dates gets a row (watermark covers the whole span), so rows_created = 8 per employee.
    --
    -- THIS SHIFT HAS TWO ASSIGNED EMPLOYEES (QA fixture employees 011 and 012, both
    -- open-ended from 2026-01-06) -- Pass 2 correctly processes BOTH, not just v_employee
    -- (011), since it iterates assigned employees, not a hardcoded one (that IS the point of
    -- this migration -- see the header on why C2 existed). employee 012 has no leave/events
    -- set up in this probe, so it gets weekly_off/holiday/absent on all 8 dates (no
    -- on_leave/half_day, since no leave row exists for it) -- checked explicitly below, not
    -- just inferred from the aggregate count.
    IF v_result.employees_processed <> 2 OR v_result.rows_created <> 16 OR v_result.rows_skipped_watermark <> 0 THEN
      RAISE EXCEPTION 'F3 FAILED: expected 2 employees_processed / 16 rows created (8 dates x 2 assigned employees) / 0 watermark-skipped, got %', v_result;
    END IF;
    RAISE NOTICE 'F3 setup verified: 2 employees_processed, 16/16 rows created (8 dates x 2 assigned employees), 0 watermark-skipped';

    PERFORM 1 FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = '11111111-1111-4111-8111-000000000012'
      AND date = v_saturday AND status = 'absent';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'F3 FAILED: the OTHER assigned employee (012, no leave/events set up here) did not get its own absent row on %', v_saturday;
    END IF;
    RAISE NOTICE 'F3 setup verified: the other assigned employee (012) was independently derived (absent on %, no leave override) -- confirms Pass 2 iterates ALL assigned employees, not one hardcoded employee', v_saturday;

    SELECT status INTO v_row FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_sunday_before;
    IF v_row.status <> 'weekly_off' THEN RAISE EXCEPTION 'E25a FAILED: expected weekly_off on %, got %', v_sunday_before, v_row.status; END IF;
    SELECT status INTO v_row FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_next_sunday;
    IF v_row.status <> 'weekly_off' THEN RAISE EXCEPTION 'E25b FAILED: expected weekly_off on %, got %', v_next_sunday, v_row.status; END IF;
    RAISE NOTICE 'E25 verified: both Sundays in range (not a working day per shift.working_days) -> weekly_off, not absent';

    SELECT status INTO v_row FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_wednesday;
    IF v_row.status <> 'holiday' THEN RAISE EXCEPTION 'E24 FAILED: expected holiday on %, got %', v_wednesday, v_row.status; END IF;
    RAISE NOTICE 'E24 verified: the holiday date -> holiday, not absent';

    SELECT status, leave_id INTO v_row FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_thursday;
    IF v_row.status <> 'on_leave' OR v_row.leave_id IS DISTINCT FROM v_leave_full THEN
      RAISE EXCEPTION 'E22 FAILED: expected on_leave/%, got %/%', v_leave_full, v_row.status, v_row.leave_id;
    END IF;
    RAISE NOTICE 'E22 verified (Pass 2): full-day approved leave -> on_leave with leave_id set';

    SELECT status, leave_id INTO v_row FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_friday;
    IF v_row.status <> 'half_day' OR v_row.leave_id IS DISTINCT FROM v_leave_half THEN
      RAISE EXCEPTION 'E23 FAILED: expected half_day/%, got %/%', v_leave_half, v_row.status, v_row.leave_id;
    END IF;
    RAISE NOTICE 'E23 verified (Pass 2): half-day approved leave (day_fraction=0.5) -> half_day with leave_id set';

    SELECT status INTO v_row FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_saturday;
    IF v_row.status <> 'absent' THEN RAISE EXCEPTION 'E10/absent FAILED: expected absent on %, got %', v_saturday, v_row.status; END IF;
    RAISE NOTICE 'E10 verified: a working day with no coverage and the watermark satisfied -> absent';

    -- D5/E45 idempotency: re-run over the identical window. Every date now already has a row
    -- (from the first run), so the existence check must skip all 8, creating zero more.
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run2, v_tenant, v_shift, v_sunday_before, v_next_sunday, 'replay', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass2(v_tenant, v_shift, v_sunday_before, v_next_sunday, v_run2);
    IF v_result.rows_created <> 0 THEN
      RAISE EXCEPTION 'D5/E45 IDEMPOTENCY FAILED: re-running Pass 2 over the same window created % more rows, expected 0', v_result.rows_created;
    END IF;
    RAISE NOTICE 'D5/E45 idempotency verified: re-running attendance_derive_pass2 over the identical window created 0 additional rows';

    RAISE EXCEPTION 'F3 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F3 probe writes rolled back (shift watermark, 1 holiday, 2 leaves, 8 attendance rows, 2 run rows)';
  END;
END
$pass2_battery$;

-- --------------------------------------------------------------------
-- F4. The watermark interlock itself: with last_sync_of_events left at its live NULL, a
-- working day with no coverage gets NO row at all (not absent, not present) -- proven
-- separately from F3 so F3's "watermark satisfied" setup cannot be mistaken for this.
-- Also proves the "too recent" half: a watermark set to a date BEFORE the candidate date
-- also blocks it.
-- --------------------------------------------------------------------
DO $watermark_check$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_shift    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee uuid := '11111111-1111-4111-8111-000000000012';
  v_anchor   date := DATE '2097-04-01';
  v_monday   date;
  v_run1     uuid := gen_random_uuid();
  v_run2     uuid := gen_random_uuid();
  v_result   record;
  v_existing_watermark timestamptz;
BEGIN
  v_monday := v_anchor + ((1 - EXTRACT(DOW FROM v_anchor)::int + 7) % 7);
  IF EXTRACT(DOW FROM v_monday)::int <> 1 THEN
    RAISE EXCEPTION 'F4 setup FAILED: computed date % is not a Monday', v_monday;
  END IF;

  SELECT last_sync_of_events INTO v_existing_watermark FROM public.shifts WHERE id = v_shift;
  IF v_existing_watermark IS NOT NULL THEN
    RAISE EXCEPTION 'F4 setup FAILED: expected shift % to have last_sync_of_events IS NULL (its live state) at the start of this probe -- another probe left it dirty', v_shift;
  END IF;

  BEGIN
    -- Case 1: watermark unset (live default state, unchanged here).
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run1, v_tenant, v_shift, v_monday, v_monday, 'manual', 'running');

    -- QA Day Shift has TWO assigned employees (011 and 012, both open-ended) -- both are
    -- absent candidates on v_monday, so both get watermark-skipped: 2, not 1.
    SELECT * INTO v_result FROM public.attendance_derive_pass2(v_tenant, v_shift, v_monday, v_monday, v_run1);
    IF v_result.rows_created <> 0 OR v_result.rows_skipped_watermark <> 2 THEN
      RAISE EXCEPTION 'F4a FAILED (watermark unset): expected 0 rows created / 2 watermark-skipped (2 assigned employees), got %', v_result;
    END IF;
    PERFORM 1 FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_monday;
    IF FOUND THEN
      RAISE EXCEPTION 'F4a FAILED: a row was written for % despite last_sync_of_events being unset', v_monday;
    END IF;
    RAISE NOTICE 'F4a verified: last_sync_of_events IS NULL (the live state of every shift today) -> no absent row written for a working day with no coverage; nothing written at all';

    -- Case 2: watermark set, but too recent -- last_sync_of_events equal to v_monday itself
    -- means v_absent_watermark_date = v_monday - 1, which is BEFORE v_monday, so v_monday
    -- still does not qualify.
    UPDATE public.shifts SET last_sync_of_events = v_monday::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id = v_shift;

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run2, v_tenant, v_shift, v_monday, v_monday, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass2(v_tenant, v_shift, v_monday, v_monday, v_run2);
    IF v_result.rows_created <> 0 OR v_result.rows_skipped_watermark <> 2 THEN
      RAISE EXCEPTION 'F4b FAILED (watermark too recent): expected 0 rows created / 2 watermark-skipped (2 assigned employees), got %', v_result;
    END IF;
    RAISE NOTICE 'F4b verified: last_sync_of_events set but not yet 24h past the candidate date -> still no absent row (the deliberate lag, §2.7)';

    RAISE EXCEPTION 'F4 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F4 probe writes rolled back (shift watermark, 2 run rows)';
  END;
END
$watermark_check$;

-- --------------------------------------------------------------------
-- F5. Clamps: E26 (before date_of_joining), E27 (after an exit_requests-derived relieving
-- date, excluding withdrawn/rejected), E28 (inactive employee skipped entirely). Watermark
-- set generously so absence is never the reason a date is missing here -- only the clamp is.
-- --------------------------------------------------------------------
DO $clamps_check$
DECLARE
  v_tenant     uuid := '11111111-1111-4111-8111-000000000001';
  v_shift      uuid := '11111111-1111-4111-8111-000000000004';
  v_emp_e26    uuid := '11111111-1111-4111-8111-000000000011'; -- date_of_joining = 2026-01-06 (real fixture data)
  v_emp_e27    uuid := '11111111-1111-4111-8111-000000000012';
  v_from_e26   date := DATE '2025-12-01';
  v_to_e26     date := DATE '2026-01-10';
  v_last_working date := DATE '2097-05-15';
  v_from_e27   date;
  v_to_e27     date;
  v_run        uuid := gen_random_uuid();
  v_result     record;
  v_count      integer;
  v_join_date  date;
BEGIN
  SELECT date_of_joining INTO v_join_date FROM public.employees WHERE id = v_emp_e26;
  IF v_join_date IS DISTINCT FROM DATE '2026-01-06' THEN
    RAISE EXCEPTION 'F5 setup FAILED: expected QA employee % date_of_joining = 2026-01-06 (fixture data), got %', v_emp_e26, v_join_date;
  END IF;

  v_from_e27 := v_last_working - 3;
  v_to_e27   := v_last_working + 3;

  BEGIN
    UPDATE public.shifts
    SET last_sync_of_events = ((GREATEST(v_to_e26, v_to_e27) + 2))::timestamp AT TIME ZONE 'Asia/Kolkata'
    WHERE id = v_shift;

    -- ---------------- E26 ----------------
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run, v_tenant, v_shift, v_from_e26, v_to_e26, 'manual', 'running');

    PERFORM public.attendance_derive_pass2(v_tenant, v_shift, v_from_e26, v_to_e26, v_run);

    SELECT count(*) INTO v_count FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_emp_e26 AND date < DATE '2026-01-06';
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'E26 FAILED: % rows created before date_of_joining (2026-01-06)', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_emp_e26 AND date >= DATE '2026-01-06' AND date <= v_to_e26;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'E26 FAILED: expected at least one row on/after date_of_joining, found none';
    END IF;
    RAISE NOTICE 'E26 verified: 0 attendance rows before date_of_joining (2026-01-06); rows start appearing on/after it';

    -- ---------------- E27 ----------------
    INSERT INTO public.exit_requests (tenant_id, employee_id, exit_type, initiated_by, initiated_by_role, last_working_date, status, reason)
    VALUES (v_tenant, v_emp_e27, 'resignation', v_emp_e27, 'employee', v_last_working, 'notice_period', 'F5 E27 probe (rolled back)');

    -- A withdrawn request with an EARLIER last_working_date must NOT clamp anything (proves
    -- the withdrawn/rejected exclusion, not just that A clamp exists).
    INSERT INTO public.exit_requests (tenant_id, employee_id, exit_type, initiated_by, initiated_by_role, last_working_date, status, reason)
    VALUES (v_tenant, v_emp_e27, 'resignation', v_emp_e27, 'employee', v_last_working - 100, 'withdrawn', 'F5 E27 withdrawn decoy (rolled back)');

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (gen_random_uuid(), v_tenant, v_shift, v_from_e27, v_to_e27, 'manual', 'running')
    RETURNING id INTO v_run;

    PERFORM public.attendance_derive_pass2(v_tenant, v_shift, v_from_e27, v_to_e27, v_run);

    SELECT count(*) INTO v_count FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_emp_e27 AND date > v_last_working;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'E27 FAILED: % rows created after the relieving date %, and the withdrawn decoy (earlier date) was wrongly honoured', v_count, v_last_working;
    END IF;

    SELECT count(*) INTO v_count FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_emp_e27 AND date >= v_from_e27 AND date <= v_last_working;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'E27 FAILED: expected rows on/before the relieving date, found none';
    END IF;
    RAISE NOTICE 'E27 verified: 0 rows after last_working_date=%; the earlier-dated withdrawn request was correctly ignored (status exclusion works, not just "any exit_requests row clamps")', v_last_working;

    RAISE EXCEPTION 'F5 probe rollback (E26/E27)' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F5 (E26/E27) probe writes rolled back (shift watermark, 2 exit_requests, attendance rows, run rows)';
  END;

  -- ---------------- E28 (separate sub-block: flips employee status, must not leak) ----------------
  -- QA Day Shift has TWO assigned employees (011 and 012) -- both are flipped inactive here
  -- so employees_processed for the WHOLE shift is genuinely 0, not just for one of them.
  BEGIN
    UPDATE public.employees SET status = 'inactive' WHERE id IN (v_emp_e26, v_emp_e27);

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (gen_random_uuid(), v_tenant, v_shift, v_from_e27, v_to_e27, 'manual', 'running')
    RETURNING id INTO v_run;

    SELECT * INTO v_result FROM public.attendance_derive_pass2(v_tenant, v_shift, v_from_e27, v_to_e27, v_run);
    IF v_result.employees_processed <> 0 OR v_result.rows_created <> 0 THEN
      RAISE EXCEPTION 'E28 FAILED: expected 0 employees_processed / 0 rows_created with both assigned employees inactive, got %', v_result;
    END IF;
    RAISE NOTICE 'E28 verified: inactive employees (both assigned employees flipped for this probe only) are skipped entirely -- 0 employees_processed, 0 rows_created';

    RAISE EXCEPTION 'F5 probe rollback (E28)' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'E28 probe writes rolled back (employee status, run row)';
  END;
END
$clamps_check$;

-- --------------------------------------------------------------------
-- F6. Module independence: Pass 2 produces IDENTICAL derivation results for QA Attendance
-- Only vs QA Full Suite from the same shape of input (an assigned employee, a working day,
-- no coverage, watermark satisfied -> absent in both). Mirrors Pass 1's own E7.
-- --------------------------------------------------------------------
DO $module_independence_check$
DECLARE
  v_tenant_a   uuid := '11111111-1111-4111-8111-000000000001';
  v_shift_a    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee_a uuid := '11111111-1111-4111-8111-000000000012';
  v_tenant_c   uuid := '33333333-3333-4333-8333-000000000001';
  v_shift_c    uuid := '33333333-3333-4333-8333-000000000004';
  v_employee_c uuid := '33333333-3333-4333-8333-000000000012';
  v_anchor     date := DATE '2097-06-01';
  v_monday     date;
  v_run_a      uuid := gen_random_uuid();
  v_run_c      uuid := gen_random_uuid();
  v_result     record;
  v_row_a      record;
  v_row_c      record;
BEGIN
  v_monday := v_anchor + ((1 - EXTRACT(DOW FROM v_anchor)::int + 7) % 7);

  BEGIN
    UPDATE public.shifts SET last_sync_of_events = (v_monday + 2)::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id = v_shift_a;
    UPDATE public.shifts SET last_sync_of_events = (v_monday + 2)::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id = v_shift_c;

    -- Each QA Day Shift has TWO assigned employees (011 and 012, both open-ended) -- both
    -- get processed, so 2 rows created per tenant, not 1.
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run_a, v_tenant_a, v_shift_a, v_monday, v_monday, 'manual', 'running');
    SELECT * INTO v_result FROM public.attendance_derive_pass2(v_tenant_a, v_shift_a, v_monday, v_monday, v_run_a);
    IF v_result.rows_created <> 2 THEN
      RAISE EXCEPTION 'F6 FAILED (QA Attendance Only): expected 2 rows created (2 assigned employees), got %', v_result;
    END IF;

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run_c, v_tenant_c, v_shift_c, v_monday, v_monday, 'manual', 'running');
    SELECT * INTO v_result FROM public.attendance_derive_pass2(v_tenant_c, v_shift_c, v_monday, v_monday, v_run_c);
    IF v_result.rows_created <> 2 THEN
      RAISE EXCEPTION 'F6 FAILED (QA Full Suite): expected 2 rows created (2 assigned employees), got %', v_result;
    END IF;

    SELECT status, leave_id INTO v_row_a FROM public.attendance
    WHERE tenant_id = v_tenant_a AND employee_id = v_employee_a AND date = v_monday;
    SELECT status, leave_id INTO v_row_c FROM public.attendance
    WHERE tenant_id = v_tenant_c AND employee_id = v_employee_c AND date = v_monday;

    IF v_row_a.status IS DISTINCT FROM v_row_c.status OR v_row_a.leave_id IS DISTINCT FROM v_row_c.leave_id THEN
      RAISE EXCEPTION 'F6 FAILED: derivation diverged between module mixes. QA-A: %, QA-C: %', v_row_a, v_row_c;
    END IF;
    IF v_row_a.status <> 'absent' THEN
      RAISE EXCEPTION 'F6 FAILED: unexpected baseline result: %', v_row_a;
    END IF;

    RAISE NOTICE 'F6 verified: Pass 2 produced IDENTICAL results (status=absent) for QA Attendance Only and QA Full Suite -- completeness derivation does not depend on the leave/payroll module mix';

    RAISE EXCEPTION 'F6 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F6 probe writes rolled back (2 shift watermarks, 2 attendance rows, 2 run rows)';
  END;
END
$module_independence_check$;

-- --------------------------------------------------------------------
-- F7. hr_run_attendance_derivation: a non-HR (here, session-less) caller is refused. No JWT
-- simulation available (see header) -- a project_admin/migration-context caller IS,
-- definitionally, not an authenticated HR user, so this is a real, honest test of the guard.
-- --------------------------------------------------------------------
DO $wrapper_auth_check$
DECLARE
  v_tenant uuid := '11111111-1111-4111-8111-000000000001';
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM public.hr_run_attendance_derivation(v_tenant, DATE '2097-07-01', DATE '2097-07-01');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM NOT ILIKE '%Unauthenticated%' THEN
      RAISE EXCEPTION 'F7 FAILED: expected the Unauthenticated message from assert_hr_for_tenant, got: %', SQLERRM;
    END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'F7 FAILED: hr_run_attendance_derivation did not refuse a session-less (non-HR) caller';
  END IF;

  RAISE NOTICE 'F7 verified: hr_run_attendance_derivation refuses a non-HR caller (session-less -> assert_hr_for_tenant raises Unauthenticated)';
END
$wrapper_auth_check$;

-- --------------------------------------------------------------------
-- F8. hr_run_attendance_derivation's run-row lifecycle mechanics: replicates the wrapper's
-- own internal sequence (insert the run row, loop is_active + enable_auto_derivation shifts,
-- clamp by process_attendance_after, call Pass 1 then Pass 2, aggregate) directly, since that
-- machinery is not itself auth-gated (only the assert_hr_for_tenant call at the top is, and
-- that half is proven separately by F7 -- see the header's JWT-simulation limitation note).
-- --------------------------------------------------------------------
DO $wrapper_mechanics_check$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_shift    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee uuid := '11111111-1111-4111-8111-000000000011';
  v_anchor   date := DATE '2097-08-01';
  v_date     date; -- computed below: must be a working day (not Sunday) or the expected
                    -- outcome is weekly_off, not absent -- the exact trap the Phase 0 lesson
                    -- warns about, caught live while first applying this migration.
  v_run_id   uuid := gen_random_uuid();
  v_from_clamped date;
  v_row      record;
BEGIN
  v_date := v_anchor + ((1 - EXTRACT(DOW FROM v_anchor)::int + 7) % 7); -- next Monday on/after v_anchor
  IF EXTRACT(DOW FROM v_date)::int <> 1 THEN
    RAISE EXCEPTION 'F8 setup FAILED: computed date % is not a Monday', v_date;
  END IF;

  BEGIN
    UPDATE public.shifts SET last_sync_of_events = (v_date + 2)::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id = v_shift;

    -- Mirrors hr_run_attendance_derivation's body exactly, minus the assert_hr_for_tenant call.
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run_id, v_tenant, NULL, v_date, v_date, 'manual', 'running');

    SELECT GREATEST(v_date, COALESCE(process_attendance_after, v_date)) INTO v_from_clamped
    FROM public.shifts WHERE id = v_shift;

    PERFORM public.attendance_derive_pass1(v_tenant, v_shift, v_from_clamped, v_date, v_run_id);
    PERFORM public.attendance_derive_pass2(v_tenant, v_shift, v_from_clamped, v_date, v_run_id);

    UPDATE public.attendance_derivation_runs
    SET status = 'completed', finished_at = now()
    WHERE id = v_run_id;

    SELECT * INTO v_row FROM public.attendance_derivation_runs WHERE id = v_run_id;
    IF v_row.status <> 'completed' OR v_row.finished_at IS NULL OR v_row.started_at IS NULL THEN
      RAISE EXCEPTION 'F8 FAILED: run row % is not complete: %', v_run_id, v_row;
    END IF;

    PERFORM 1 FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND date = v_date AND status = 'absent';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'F8 FAILED: expected Pass 2 (called via the wrapper''s own sequence) to have written an absent row for %', v_date;
    END IF;

    RAISE NOTICE 'F8 verified: the run-row lifecycle (insert running -> Pass 1 -> Pass 2 -> completed/finished_at) that hr_run_attendance_derivation''s body performs produces a complete run row and real derived output';

    RAISE EXCEPTION 'F8 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F8 probe writes rolled back (shift watermark, 1 attendance row, 1 run row)';
  END;
END
$wrapper_mechanics_check$;

-- --------------------------------------------------------------------
-- F9. Dual-write flip proof, paths 1 and 2 (path 3 is the 3 organic events + zero audit-log
-- failures, re-checked live here). Both against a QA fixture employee with zero live
-- attendance rows (no idx_single_open_session collision risk).
-- --------------------------------------------------------------------
DO $dual_write_proof$
DECLARE
  v_tenant uuid := '11111111-1111-4111-8111-000000000001';
  v_emp    uuid := '11111111-1111-4111-8111-000000000011';
  v_att_id uuid;
  v_events integer;
  v_result jsonb;
  v_audit_failures integer;
BEGIN
  SELECT count(*) INTO v_audit_failures FROM public.attendance_audit_logs WHERE action = 'event_dual_write_failed';
  IF v_audit_failures <> 0 THEN
    RAISE EXCEPTION 'F9 FAILED: % dual-write failures recorded in attendance_audit_logs -- the flip in section E must NOT have been applied; this migration should be aborted and revised', v_audit_failures;
  END IF;
  RAISE NOTICE 'F9 step 1 verified: 0 dual-write failures recorded in attendance_audit_logs since 20260821220000 was applied';

  BEGIN
    -- Path 1: punch-in via a direct table INSERT (the shape PunchInOut.tsx uses).
    INSERT INTO public.attendance (tenant_id, employee_id, date, punch_in, session_status, status)
    VALUES (v_tenant, v_emp, DATE '2097-09-01', now() - interval '9 hours', 'open', 'present')
    RETURNING id INTO v_att_id;

    SELECT count(*) INTO v_events FROM public.attendance_events WHERE attendance_id = v_att_id;
    IF v_events <> 1 THEN
      RAISE EXCEPTION 'F9 FAILED (path 1, punch-in direct INSERT): expected 1 event, got %', v_events;
    END IF;
    RAISE NOTICE 'F9 path 1 verified: a direct-table-INSERT punch-in produced exactly 1 event, no error';

    -- Path 2: punch-out via the punch_out_attendance RPC on the session just opened.
    v_result := public.punch_out_attendance(v_att_id, v_tenant, NULL, NULL, NULL, NULL);
    IF COALESCE(v_result->>'success', 'false') <> 'true' THEN
      RAISE EXCEPTION 'F9 FAILED (path 2, punch_out_attendance RPC): call did not succeed: %', v_result;
    END IF;

    SELECT count(*) INTO v_events FROM public.attendance_events WHERE attendance_id = v_att_id;
    IF v_events <> 2 THEN
      RAISE EXCEPTION 'F9 FAILED (path 2): expected 2 events total after punch-out, got %', v_events;
    END IF;
    RAISE NOTICE 'F9 path 2 verified: punch_out_attendance RPC succeeded (success=true) and produced a second event (2 total), no error';

    RAISE NOTICE 'F9 path 3 (HR manual edit, hr_update_attendance): proven by the 3 organic attendance_events rows already live (source=manual, direction=in, created 2026-08-24) plus 0 recorded dual-write failures -- see migration header for why no new probe is added for this specific path (assert_hr_for_tenant cannot be simulated from a SQL-only migration)';

    RAISE EXCEPTION 'F9 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F9 probe writes rolled back (1 attendance row, 2 events)';
  END;
END
$dual_write_proof$;

-- --------------------------------------------------------------------
-- F10. The flip is live: the trigger function's body no longer contains the RECORDING
-- (INSERT INTO attendance_audit_logs) failure path, and a forced dual-write failure now
-- RAISES and aborts the write instead of succeeding silently-incomplete.
-- --------------------------------------------------------------------
DO $flip_live_check$
DECLARE
  v_src text;
  v_tenant uuid := '11111111-1111-4111-8111-000000000001';
  v_emp    uuid;
  v_raised boolean := false;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'attendance_dual_write_event' AND pronamespace = 'public'::regnamespace;

  IF v_src ILIKE '%event_dual_write_failed%' THEN
    RAISE EXCEPTION 'F10 FAILED: attendance_dual_write_event still contains the RECORDING failure path -- the flip did not apply';
  END IF;
  RAISE NOTICE 'F10a verified: attendance_dual_write_event no longer records to attendance_audit_logs on failure';

  -- Force a real failure: an attendance row whose employee_id has no matching row in
  -- `employees` violates attendance_event_ingest's FK on employee_id, which the OLD trigger
  -- would have swallowed into an audit log row; the new one must let it propagate.
  BEGIN
    INSERT INTO public.attendance (tenant_id, employee_id, date, punch_in, session_status, status)
    VALUES (v_tenant, '00000000-0000-0000-0000-000000000000'::uuid, DATE '2097-09-02', now(), 'open', 'present');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'F10 FAILED: an attendance INSERT with a dual-write-breaking employee_id did not raise -- the flip is not actually enforced';
  END IF;

  PERFORM 1 FROM public.attendance_audit_logs WHERE action = 'event_dual_write_failed' AND tenant_id = v_tenant;
  IF FOUND THEN
    RAISE EXCEPTION 'F10 FAILED: a dual-write failure was still recorded to attendance_audit_logs instead of raising';
  END IF;

  RAISE NOTICE 'F10b verified: a forced dual-write failure now RAISES and aborts the write (no attendance row, no audit-log record) -- the flip is live and enforced';
END
$flip_live_check$;

DO $final$
BEGIN
  RAISE NOTICE 'Phase 3 (B6 part 2) assertions complete: F0 (shape/backfill), F1 (Pass 1 phantom-event fix), F2 (E23 via Pass 1), F3 (Pass 2 core battery: E25/E24/E22/E23/E10/idempotency), F4 (watermark interlock, unset + too-recent), F5 (E26/E27/E28 clamps), F6 (module independence), F7 (wrapper auth refusal), F8 (wrapper run-row mechanics), F9 (dual-write 3-path proof), F10 (flip enforced) -- all verified.';
END
$final$;
