-- B7a — server-authoritative punch-in + a tenant-timezone business date the SPA can read.
-- Authority: `doc/attendance_b7_cutover_plan.md` (B7a is the ONLY scope of this file) and
-- `new update doc/attendance_shift_v2_decision_doc.md` D9, D12, C1, C3, C6, F1, F2, §10.
--
-- Applied head at planning time: 20260828100000. This file is the assigned version
-- 20260828110000. Corrections go in 20260828110001, per instruction.
--
-- ============================================================================
-- THIS RELEASE IS ADDITIVE. IT REMOVES NOTHING.
-- ============================================================================
-- The live production bundle is PRE-Phase-0 (marker check: 0 hits for
-- working_hours_threshold_for_absent / enable_auto_derivation). Every employee punches in via
-- a direct `attendance` table INSERT (PunchInOut.tsx:742) today, and that path is UNCHANGED
-- by this migration -- verified below by a live probe of that exact path, not by inspection.
-- This file only ADDS two new functions. `PunchInOut.tsx` is not touched (that is B7b).
--
-- ============================================================================
-- VERIFIED LIVE BEFORE WRITING THIS (rule 6 -- never trust doc/database_schema.md)
-- ============================================================================
-- punch_out_attendance (6-arg, current def fetched via pg_get_functiondef): SECURITY DEFINER,
-- no SET search_path, ownership check via `(SELECT auth.uid()) IS NOT NULL` + employees lookup
-- + is_hr() fallback, NO can_access_tenant() call anywhere in its body. attendance_derive_pass1
-- (20260825100000/20260828100000) is the actual live precedent for "restore the tenant fence
-- and module gate by hand": `IF (SELECT auth.uid()) IS NOT NULL AND NOT can_access_tenant(...)
-- THEN RAISE` (fence, SKIPPED for a session-less caller) followed by a SEPARATE, UNCONDITIONAL
-- `IF NOT tenant_has_module_for(...,'attendance') THEN RAISE` (module gate, applies even to a
-- session-less/migration caller -- a business invariant, not just a security fence). Both
-- functions below copy that exact two-check shape, not punch_out_attendance's, per the task's
-- explicit instruction to restore the fence via can_access_tenant + tenant_has_module_for.
--
-- attendance columns confirmed live: punch_in has DEFAULT now(), business_date_tz/shift_
-- snapshot/policy_snapshot/derivation_source/late_entry/early_exit already exist (added by
-- earlier phases), idx_single_open_session is `UNIQUE (tenant_id, employee_id) WHERE
-- session_status = 'open'`. Only two triggers on attendance: trg_auto_close_active_break
-- (BEFORE UPDATE only -- irrelevant to an INSERT) and trg_attendance_dual_write_event (AFTER
-- INSERT OR UPDATE OF punch_out), which is exactly the mechanism this RPC relies on for its
-- event-log write -- see below.
--
-- Baseline counts at migration-write time: attendance_events = 3, attendance = 13 rows.
-- Confirmed no attendance rows exist yet for the QA fixture employees used in the probes below.
--
-- ============================================================================
-- WHY THIS RPC DOES NOT CALL attendance_event_ingest ITSELF
-- ============================================================================
-- trg_attendance_dual_write_event already fires AFTER INSERT ... WHEN NEW.punch_in IS NOT
-- NULL and calls attendance_event_ingest with idempotency_key = NEW.id::text || ':in'. Since
-- this RPC legitimately sets punch_in = now() on INSERT, a plain INSERT into attendance is
-- enough -- the trigger produces the 'in' event exactly the same way the existing direct-insert
-- path does today. Calling attendance_event_ingest a second time from this function would
-- double-write. Phase 3 flipped the trigger from recording-on-failure to RAISING on failure, so
-- if this RPC's INSERT makes event ingestion fail, the whole punch fails -- verified by
-- population-count assertions below, not by inspecting the two rows this migration expects.
--
-- ============================================================================
-- STATED GAP -- NOT A SILENT OMISSION -- SO IT IS ON THE RECORD, NOT ONLY IN THIS AGENT'S HEAD
-- ============================================================================
-- punch_in_attendance does NOT compute or write `is_late` or a half-day `status`. The direct-
-- insert path DOES (client-computed, using late_mark_grace_minutes / half_day cutoff read from
-- tenant_settings and the resolved shift -- itself a D12 violation this release does not fix).
-- The B7 plan's own §3a defers the is_late-vs-late_entry reconciliation explicitly to B7b/B7c,
-- and "no policy, thresholds, rates, or expected hours from the client" (D12/C1) argues against
-- inventing a THIRD, RPC-side copy of that threshold logic here. Consequence, stated plainly:
-- punch_in_attendance is NOT YET a pure drop-in replacement for the direct insert -- a row it
-- creates always has status='present' (column default) and is_late=false (column default),
-- even when the same punch, run through the OLD path, would have been marked late/half_day.
-- B7b cannot be "PunchInOut.tsx calls the RPC" as a pure call-site swap until §3a is actually
-- decided; it will need to either keep a client-side is_late follow-up UPDATE (mirroring how
-- punch_out_attendance's caller still does a plain follow-up UPDATE for evidence fields today)
-- or §3a's reconciliation has to land first. Flagging this here so it is a decision for B7b,
-- not a surprise discovered while wiring it up.
--
-- punch_out_allowed is left explicitly `true` (not the column's `false` default): grep across
-- both src/ and every server-side writer (approve_leave_request, hr_approve_attendance_
-- correction, approve_task_request) found this column WRITTEN in several places but READ
-- (in a WHERE/IF) nowhere -- punch_out_attendance itself re-derives the task gate live from
-- `tasks` rather than trusting this column. It is write-only today. `true` is is the value the
-- direct-insert path itself writes in the common case (gate disabled, or gate enabled with zero
-- outstanding tasks) and is the value every other writer of this column uses, so it costs one
-- line to remove the question rather than leave a NOT NULL column at its strictly worse default.
--
-- punch_in_ip, remote_exception_id, verification_snapshot, location_confidence and selfie
-- upload are intentionally NOT parameters here, mirroring punch_out_attendance's own precedent
-- exactly: that RPC only takes p_lat/p_lng/p_acc/p_loc_status, and its caller does a separate
-- plain `.update()` afterwards for location_confidence/remote_exception_id/verification_
-- snapshot (PunchInOut.tsx:812-825). A future B7b would follow the identical pattern for
-- punch-in. Selfie upload already requires the attendance id to exist first (it is FK'd), so it
-- cannot be a parameter of the INSERT that creates that id either way -- same two-step shape as
-- today. close_stale_attendance (a separate, already-existing RPC the client calls before
-- inserting) is untouched and not replicated here; B7b's caller is expected to keep calling it
-- first, exactly as PunchInOut.tsx does today.
--
-- ============================================================================
-- SQLSTATE CHOICE -- DELIBERATELY NOT P0001-P0004
-- ============================================================================
-- punch_out_attendance overloads P0001-P0004 for its own custom exception names. Those four
-- codes collide with PL/pgSQL's OWN reserved 'P0' error class (P0001 raise_exception, P0002
-- no_data_found, P0003 too_many_rows, P0004 assert_failure) -- e.g. a future `SELECT ... INTO
-- STRICT` added to this function that finds no row would raise P0002 no_data_found, and this
-- function's own exception handler would silently relabel that bug as PAYROLL_LOCKED if P0002
-- were reused for it. This function uses P0005-P0011 instead, entirely outside that reserved
-- range, so no such collision is possible now or after a future edit.

-- ============================================================================
-- A. tenant_business_date -- a server-authoritative "today" the SPA can read (deliverable B)
-- ============================================================================
-- Mirrors work_calendar_working_days's shape exactly: a STABLE SQL function, SECURITY DEFINER,
-- SET search_path TO '' (fully-qualified identifiers throughout), returning NULL rather than
-- raising when the fence or module gate fails -- consistent with that function being a plain
-- read the SPA polls, not a mutation. A NULL return means "forbidden, or the attendance module
-- is off for this tenant" -- B7b must treat NULL as an explicit case, never fall back to a
-- device clock, which is exactly the bug (C6/F2) this whole function exists to prevent.
--
-- p_instant defaults to now() so the SPA's normal call is just tenant_business_date(tenant_id).
-- The second, explicit parameter exists so the tenant-timezone-vs-UTC divergence (D9/C6/F2) can
-- be proven for a fixed, chosen instant below, rather than only for whatever now() happens to
-- be at apply time -- most days of the year do not straddle a UTC/local date boundary, so a
-- bare now()-only test could pass by coincidence 364 days out of 365.
CREATE OR REPLACE FUNCTION public.tenant_business_date(
  p_tenant_id uuid,
  p_instant   timestamptz DEFAULT now()
)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN ((SELECT auth.uid()) IS NULL OR (SELECT public.can_access_tenant(p_tenant_id)))
     AND (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance'))
    THEN (
      SELECT (p_instant AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date
      FROM public.tenants t
      WHERE t.id = p_tenant_id
    )
    ELSE NULL
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tenant_business_date(uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_business_date(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_business_date(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.tenant_business_date(uuid, timestamptz) IS
'D9/C6/F2: the tenant-timezone business date for a given instant (defaults to now()). Returns
NULL if the caller cannot access the tenant or the attendance module is off for it. No screen
may compute a business date from a device clock -- this is the server-authoritative source.';

-- ============================================================================
-- B. punch_in_attendance -- server-authoritative punch-in (deliverable A)
-- ============================================================================
-- Signature note: punch_out_attendance's caller already knows p_attendance_id (the row
-- exists). Punch-in has no row yet, so p_employee_id replaces it -- NULL means "the caller's
-- own employee row", resolved from auth.uid(); an explicit value lets HR punch in on behalf of
-- someone else, the same allowance punch_out_attendance's ownership check makes for HR closing
-- a forgotten session. Evidence params (p_lat/p_lng/p_acc/p_loc_status) are the same four
-- punch_out_attendance takes -- geofence evidence, never policy (D12).
CREATE OR REPLACE FUNCTION public.punch_in_attendance(
  p_tenant_id   uuid,
  p_employee_id uuid DEFAULT NULL,
  p_lat         numeric DEFAULT NULL,
  p_lng         numeric DEFAULT NULL,
  p_acc         numeric DEFAULT NULL,
  p_loc_status  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tenant           public.tenants%ROWTYPE;
  v_tenant_tz        text;
  v_caller_employee  uuid;
  v_employee_id      uuid;
  v_business_date    date;
  v_now              timestamptz := now();
  v_payroll_lock_str text;
  v_payroll_lock_date date;
  v_attendance_id    uuid;
BEGIN
  -- ── 1. TENANT FENCE ─────────────────────────────────────────────────────────────────────
  -- Binding rule 1: SECURITY DEFINER bypasses RLS entirely (owner exemption). Restored by
  -- hand, copying attendance_derive_pass1's shape: the fence is SKIPPED only for a session-
  -- less caller (migration/service-role, already trusted); a real authenticated caller must
  -- pass can_access_tenant.
  IF (SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'TENANT_FORBIDDEN'
      USING ERRCODE = 'P0006',
            DETAIL  = 'This tenant is not accessible to the caller.';
  END IF;

  -- Module gate is UNCONDITIONAL (unlike the fence above) -- a business invariant, not a
  -- security check, so it applies even to a session-less caller. Matches attendance_derive_
  -- pass1 exactly.
  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'MODULE_DISABLED'
      USING ERRCODE = 'P0007',
            DETAIL  = 'The attendance module is not enabled for this tenant.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND'
      USING ERRCODE = 'P0008',
            DETAIL  = 'Unknown tenant.';
  END IF;

  -- ── 2. OWNERSHIP (C3, mirroring punch_out_attendance's shape) ──────────────────────────────
  SELECT id INTO v_caller_employee FROM public.employees
   WHERE user_id = (SELECT auth.uid()) AND tenant_id = p_tenant_id;

  v_employee_id := COALESCE(p_employee_id, v_caller_employee);

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_RESOLVED'
      USING ERRCODE = 'P0009',
            DETAIL  = 'No employee context: the caller has no employee row in this tenant and none was supplied.';
  END IF;

  -- Session-less caller (migration/service-role) is trusted, same as punch_out_attendance.
  -- A real authenticated caller may only punch themselves in, unless they are HR.
  IF (SELECT auth.uid()) IS NOT NULL THEN
    IF v_employee_id IS DISTINCT FROM v_caller_employee
       AND NOT (SELECT public.is_hr()) THEN
      RAISE EXCEPTION 'NOT_YOUR_ATTENDANCE'
        USING ERRCODE = 'P0010',
              DETAIL  = 'You may only punch in your own attendance.';
    END IF;
  END IF;

  -- ── 3. BUSINESS DATE, SERVER-SIDE, TENANT TIMEZONE (D9 / kills C6 / F2 for this path) ─────
  -- No current_date, no now()::date -- the instant is v_now (server clock), converted through
  -- the TENANT's own timezone, never the caller's. The client supplies no date at all.
  v_tenant_tz     := COALESCE(v_tenant.timezone, 'UTC');
  v_business_date := (v_now AT TIME ZONE v_tenant_tz)::date;

  -- ── 4. PAYROLL LOCK GUARD -- module-independence (standing constraint) ─────────────────────
  -- A payroll lock is a legitimate payroll-to-attendance fact (punch_out_attendance already
  -- enforces one), so mirroring it here is correct -- but ONLY when the payroll module is
  -- actually enabled for this tenant. A tenant running attendance without payroll must never
  -- read a payroll-flavoured setting at all; if payroll is off, there is no lock and punch-in
  -- proceeds unconditionally.
  IF (SELECT public.tenant_has_module_for(p_tenant_id, 'payroll')) THEN
    SELECT value INTO v_payroll_lock_str
    FROM public.tenant_settings
    WHERE tenant_id = p_tenant_id AND key = 'payroll_lock_date';

    IF v_payroll_lock_str IS NOT NULL AND v_payroll_lock_str <> '' THEN
      v_payroll_lock_date := v_payroll_lock_str::date;
      IF v_business_date <= v_payroll_lock_date THEN
        RAISE EXCEPTION 'PAYROLL_LOCKED'
          USING ERRCODE = 'P0011',
                DETAIL  = 'This attendance date falls within a locked payroll period.';
      END IF;
    END IF;
  END IF;

  -- ── 5. OPEN-SESSION GUARD (idx_single_open_session) -- fail cleanly ────────────────────────
  -- A friendly pre-check for the common (single-session) case; idx_single_open_session is the
  -- real guarantee under concurrency, and a race that slips past this check still fails
  -- cleanly via the unique_violation arm of the exception handler below, never as a raw
  -- constraint-violation message.
  PERFORM 1 FROM public.attendance
   WHERE tenant_id = p_tenant_id AND employee_id = v_employee_id AND session_status = 'open'
   FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'ALREADY_PUNCHED_IN'
      USING ERRCODE = 'P0005',
            DETAIL  = 'An open attendance session already exists for this employee.';
  END IF;

  -- ── 6. WRITE THE ROW ────────────────────────────────────────────────────────────────────
  -- Same shape as the existing direct-insert path (PunchInOut.tsx:742), minus the client-
  -- computed policy (is_late / half-day status -- see the header's stated gap; D12 forbids
  -- inventing a third copy of that threshold logic here) and minus IP/confidence/snapshot
  -- fields the existing punch_out_attendance precedent also leaves to a client follow-up
  -- update. punch_in = v_now (not left to the column DEFAULT) so trg_attendance_dual_write_
  -- event's `NEW.punch_in IS NOT NULL` branch fires deterministically and logs exactly one
  -- 'in' event -- the same mechanism the direct-insert path already relies on today.
  -- punch_out_allowed is explicitly true -- see header: write-only column, this is the value
  -- every other writer of it (including the direct-insert common case) already uses.
  INSERT INTO public.attendance (
    tenant_id, employee_id, date, punch_in, session_status, punch_out_allowed,
    punch_in_lat, punch_in_lng, punch_in_location_accuracy, punch_in_location_status,
    location_accuracy, location_status, business_date_tz
  ) VALUES (
    p_tenant_id, v_employee_id, v_business_date, v_now, 'open', true,
    p_lat, p_lng, p_acc, p_loc_status,
    p_acc, p_loc_status, v_tenant_tz
  )
  RETURNING id INTO v_attendance_id;

  RETURN jsonb_build_object(
    'success',       true,
    'reason',        null,
    'attendance_id', v_attendance_id,
    'date',          v_business_date
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ALREADY_PUNCHED_IN', 'errcode', '23505');
  WHEN SQLSTATE 'P0005' OR SQLSTATE 'P0006' OR SQLSTATE 'P0007'
    OR SQLSTATE 'P0008' OR SQLSTATE 'P0009' OR SQLSTATE 'P0010' OR SQLSTATE 'P0011' THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM, 'errcode', SQLSTATE);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text) IS
'B7a. Server-authoritative punch-in: derives the business date from the TENANT''s IANA
timezone (D9, closes C6/F2 for this path), asserts the caller owns the row or is HR (C3),
takes no policy/threshold/rate from the client (D12), and fails ALREADY_PUNCHED_IN cleanly
against idx_single_open_session. Additive -- the direct-insert path in PunchInOut.tsx is
untouched; this closes F1 only once B7b switches the frontend to call it. Does NOT set
is_late or half-day status -- see migration header, that is B7b/B7c (plan §3a).';

-- ============================================================================
-- C. ASSERTIONS
-- ============================================================================
-- Every probe that WRITES uses the established rolled-back-DO-block idiom from
-- 20260825100000: a nested BEGIN ... <writes + assertions, each failure RAISEs its own,
-- distinct exception> ... a final deliberate RAISE EXCEPTION 'probe rollback' USING ERRCODE =
-- 'ZZ001', caught ONLY by that same nested block's `EXCEPTION WHEN SQLSTATE 'ZZ001'` handler.
-- This undoes every write the block made (Postgres implements a BEGIN/EXCEPTION block as a
-- subtransaction) while leaving a genuine assertion failure -- which raises a DIFFERENT
-- SQLSTATE -- to propagate out and abort the whole migration. The ZZ001 handler is scoped to
-- the single innermost block in every probe below; a real trigger failure during the INSERT
-- (Phase 3 made attendance_dual_write_event RAISE on ingest failure) would surface as an
-- ordinary Postgres error before the deliberate ZZ001 raise is ever reached, and is NOT
-- caught by it.

-- ---------------------------------------------------------------------------------------------
-- C0. Capture the true baseline immediately before any probe runs.
-- ---------------------------------------------------------------------------------------------
DO $baseline$
DECLARE
  v_events int;
  v_rows   int;
BEGIN
  SELECT count(*) INTO v_events FROM public.attendance_events;
  SELECT count(*) INTO v_rows FROM public.attendance;
  RAISE NOTICE 'BASELINE: attendance_events=%, attendance=% (captured immediately before probes)', v_events, v_rows;
END
$baseline$;

-- ---------------------------------------------------------------------------------------------
-- C1. Grants: both functions are callable by authenticated, not by anon/PUBLIC.
-- ---------------------------------------------------------------------------------------------
DO $grants$
BEGIN
  IF NOT has_function_privilege('authenticated',
       'public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS FAILED: authenticated cannot execute punch_in_attendance';
  END IF;
  IF has_function_privilege('anon',
       'public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS FAILED: anon can execute punch_in_attendance (should have been revoked)';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.tenant_business_date(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS FAILED: authenticated cannot execute tenant_business_date';
  END IF;
  IF has_function_privilege('anon',
       'public.tenant_business_date(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS FAILED: anon can execute tenant_business_date (should have been revoked)';
  END IF;
  RAISE NOTICE 'C1 verified: punch_in_attendance and tenant_business_date are EXECUTE-granted to authenticated only';
END
$grants$;

-- ---------------------------------------------------------------------------------------------
-- C2. tenant_business_date: basic sanity + the wrong-timezone case (D9/C6/F2, the whole point).
-- Pure read, no writes -- no rollback machinery needed.
-- ---------------------------------------------------------------------------------------------
DO $tz_check$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001'; -- QA Attendance Only, tz Asia/Kolkata
  v_today    date;
  v_expected date;
  v_instant  timestamptz;
  v_utc_date date;
  v_tz_date  date;
BEGIN
  -- Sanity: default-instant call matches the direct formula for the same tenant right now.
  SELECT (now() AT TIME ZONE t.timezone)::date INTO v_expected FROM public.tenants t WHERE t.id = v_tenant;
  v_today := public.tenant_business_date(v_tenant);
  IF v_today IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'C2 FAILED: tenant_business_date(%) = % but direct AT TIME ZONE computation = %', v_tenant, v_today, v_expected;
  END IF;
  RAISE NOTICE 'C2 sanity verified: tenant_business_date(tenant) with default now() = % (Asia/Kolkata)', v_today;

  -- THE WRONG-TIMEZONE CASE: 2026-08-29 01:00 IST is 2026-08-28 19:30 UTC -- a different
  -- calendar date in UTC than in the tenant's own timezone. This is exactly C6/F2: a naive
  -- now()::date would land this punch on the 28th; the tenant-timezone-aware function must
  -- land it on the 29th.
  v_instant := '2026-08-29 01:00:00+05:30'::timestamptz;
  v_utc_date := (v_instant AT TIME ZONE 'UTC')::date;
  v_tz_date  := public.tenant_business_date(v_tenant, v_instant);

  IF v_utc_date <> '2026-08-28' THEN
    RAISE EXCEPTION 'C2 test setup wrong: expected UTC date 2026-08-28 for this instant, got %', v_utc_date;
  END IF;
  IF v_tz_date <> '2026-08-29' THEN
    RAISE EXCEPTION 'C2 FAILED (C6/F2): instant % should land on 2026-08-29 in Asia/Kolkata, tenant_business_date returned %', v_instant, v_tz_date;
  END IF;
  IF v_tz_date = v_utc_date THEN
    RAISE EXCEPTION 'C2 FAILED: tenant date and UTC date must differ for this instant to prove anything, both are %', v_tz_date;
  END IF;
  RAISE NOTICE 'C2 verified (C6/F2): instant % -> UTC date=%, tenant (Asia/Kolkata) date=% -- they differ, and the tenant''s own date wins', v_instant, v_utc_date, v_tz_date;

  -- Forbidden case: an unknown tenant returns NULL, not an error, not someone else's date.
  IF public.tenant_business_date('00000000-0000-0000-0000-000000000000'::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'C2 FAILED: tenant_business_date for an unknown tenant should return NULL';
  END IF;
  RAISE NOTICE 'C2 verified: unknown tenant returns NULL (module gate / fence), not a fabricated date';
END
$tz_check$;

-- ---------------------------------------------------------------------------------------------
-- C3. Happy path: punch-in via the RPC creates exactly one attendance row on the tenant-
-- timezone business date, and produces exactly one 'in' event -- population count, not sample.
-- ---------------------------------------------------------------------------------------------
DO $happy_path$
DECLARE
  v_tenant       uuid := '11111111-1111-4111-8111-000000000001'; -- QA Attendance Only
  v_employee     uuid := '11111111-1111-4111-8111-000000000011'; -- QA Employee 1
  v_events_before_total  int;
  v_events_after_total   int;
  v_events_before_scoped int;
  v_events_after_scoped  int;
  v_result       jsonb;
  v_att_id       uuid;
  v_att_date     date;
  v_att_punch_in timestamptz;
  v_expected_date date;
  v_row_count    int;
  v_ev_direction text;
  v_ev_att_id    uuid;
BEGIN
  BEGIN
    SELECT count(*) INTO v_events_before_total FROM public.attendance_events;
    SELECT count(*) INTO v_events_before_scoped FROM public.attendance_events
     WHERE tenant_id = v_tenant AND employee_id = v_employee;

    v_result := public.punch_in_attendance(v_tenant, v_employee, 12.34, 56.78, 9.5, 'office_verified');

    IF (v_result->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'C3 FAILED: punch_in_attendance did not succeed: %', v_result;
    END IF;
    v_att_id := (v_result->>'attendance_id')::uuid;

    -- Exactly one attendance row for this employee, session_status open.
    SELECT count(*) INTO v_row_count FROM public.attendance
     WHERE tenant_id = v_tenant AND employee_id = v_employee;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'C3 FAILED: expected exactly 1 attendance row, found %', v_row_count;
    END IF;

    SELECT date, punch_in INTO v_att_date, v_att_punch_in
    FROM public.attendance WHERE id = v_att_id;

    -- Non-coincidental date cross-check: computed independently from the row's OWN punch_in
    -- value (not from a second bare now() call that would merely agree by chance).
    v_expected_date := public.tenant_business_date(v_tenant, v_att_punch_in);
    IF v_att_date IS DISTINCT FROM v_expected_date OR (v_result->>'date')::date IS DISTINCT FROM v_expected_date THEN
      RAISE EXCEPTION 'C3 FAILED: row date=%, jsonb date=%, tenant_business_date(punch_in)=% -- must all agree', v_att_date, v_result->>'date', v_expected_date;
    END IF;
    RAISE NOTICE 'C3 verified: attendance row % created, date=% (tenant-timezone, cross-checked against tenant_business_date(punch_in))', v_att_id, v_att_date;

    -- Exactly one event, both globally (population, not sample) and scoped to this employee.
    SELECT count(*) INTO v_events_after_total FROM public.attendance_events;
    SELECT count(*) INTO v_events_after_scoped FROM public.attendance_events
     WHERE tenant_id = v_tenant AND employee_id = v_employee;

    IF v_events_after_scoped - v_events_before_scoped <> 1 THEN
      RAISE EXCEPTION 'C3 FAILED: employee-scoped attendance_events count moved by % (expected 1)', v_events_after_scoped - v_events_before_scoped;
    END IF;
    IF v_events_after_total - v_events_before_total <> 1 THEN
      RAISE EXCEPTION 'C3 FAILED: GLOBAL attendance_events count moved by % (expected exactly 1) -- this is the phantom-event check', v_events_after_total - v_events_before_total;
    END IF;

    SELECT direction, attendance_id INTO v_ev_direction, v_ev_att_id
    FROM public.attendance_events
    WHERE tenant_id = v_tenant AND employee_id = v_employee
    ORDER BY created_at DESC LIMIT 1;

    IF v_ev_direction <> 'in' OR v_ev_att_id IS DISTINCT FROM v_att_id THEN
      RAISE EXCEPTION 'C3 FAILED: new event has direction=%, attendance_id=% (expected in, %)', v_ev_direction, v_ev_att_id, v_att_id;
    END IF;
    RAISE NOTICE 'C3 verified: exactly ONE new event globally AND scoped to this employee, direction=in, attendance_id=%', v_ev_att_id;

    RAISE EXCEPTION 'C3 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'C3 probe writes rolled back (1 attendance row, 1 event)';
  END;
END
$happy_path$;

-- ---------------------------------------------------------------------------------------------
-- C4. A second punch-in while one is open fails cleanly (ALREADY_PUNCHED_IN), not with a raw
-- constraint violation.
-- ---------------------------------------------------------------------------------------------
DO $double_punch$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001'; -- QA Attendance Only
  v_employee uuid := '11111111-1111-4111-8111-000000000012'; -- QA Employee 2
  v_result1  jsonb;
  v_result2  jsonb;
  v_row_count int;
BEGIN
  BEGIN
    v_result1 := public.punch_in_attendance(v_tenant, v_employee);
    IF (v_result1->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'C4 setup FAILED: first punch-in did not succeed: %', v_result1;
    END IF;

    v_result2 := public.punch_in_attendance(v_tenant, v_employee);
    IF (v_result2->>'success')::boolean IS NOT FALSE THEN
      RAISE EXCEPTION 'C4 FAILED: second punch-in should have failed, got: %', v_result2;
    END IF;
    IF v_result2->>'reason' <> 'ALREADY_PUNCHED_IN' THEN
      RAISE EXCEPTION 'C4 FAILED: expected reason=ALREADY_PUNCHED_IN, got: %', v_result2;
    END IF;

    -- Still exactly one open session -- the second call created nothing.
    SELECT count(*) INTO v_row_count FROM public.attendance
     WHERE tenant_id = v_tenant AND employee_id = v_employee AND session_status = 'open';
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'C4 FAILED: expected exactly 1 open session after the rejected second call, found %', v_row_count;
    END IF;

    RAISE NOTICE 'C4 verified: second punch-in cleanly rejected -- %, exactly 1 open session remains', v_result2;
    RAISE EXCEPTION 'C4 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'C4 probe writes rolled back (1 attendance row, 1 event)';
  END;
END
$double_punch$;

-- ---------------------------------------------------------------------------------------------
-- C5. Module independence, baseline case: punch-in succeeds IDENTICALLY for QA Attendance Only
-- (attendance is the only non-core module) and QA Full Suite (every module on), with no lock
-- set on either.
-- ---------------------------------------------------------------------------------------------
DO $qa_parity$
DECLARE
  v_tenant_a   uuid := '11111111-1111-4111-8111-000000000001'; -- QA Attendance Only
  v_employee_a uuid := '11111111-1111-4111-8111-000000000011';
  v_tenant_c   uuid := '33333333-3333-4333-8333-000000000001'; -- QA Full Suite
  v_employee_c uuid := '33333333-3333-4333-8333-000000000011';
  v_result_a   jsonb;
  v_result_c   jsonb;
BEGIN
  BEGIN
    v_result_a := public.punch_in_attendance(v_tenant_a, v_employee_a, 1.0, 2.0, 5.0, 'office_verified');
    v_result_c := public.punch_in_attendance(v_tenant_c, v_employee_c, 1.0, 2.0, 5.0, 'office_verified');

    IF (v_result_a->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'C5 FAILED: QA Attendance Only punch-in did not succeed: %', v_result_a;
    END IF;
    IF (v_result_c->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'C5 FAILED: QA Full Suite punch-in did not succeed: %', v_result_c;
    END IF;
    -- Both tenants are Asia/Kolkata (verified live) -- the derived date must be identical.
    IF (v_result_a->>'date') IS DISTINCT FROM (v_result_c->>'date') THEN
      RAISE EXCEPTION 'C5 FAILED: derived dates differ between tenants: A=%, C=%', v_result_a->>'date', v_result_c->>'date';
    END IF;

    RAISE NOTICE 'C5 verified: QA Attendance Only ≡ QA Full Suite -- both punched in successfully, same date % , attendance-only=% full-suite=%', v_result_a->>'date', v_result_a, v_result_c;
    RAISE EXCEPTION 'C5 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'C5 probe writes rolled back (2 attendance rows, 2 events)';
  END;
END
$qa_parity$;

-- ---------------------------------------------------------------------------------------------
-- C6. Module independence, the actual guard: a payroll_lock_date is set for BOTH tenants.
-- QA Attendance Only (payroll module OFF) must proceed anyway -- proving the lock read is truly
-- gated by tenant_has_module_for(...,'payroll'), not merely untriggered by accident. QA Full
-- Suite (payroll ON) must be BLOCKED by the same lock.
-- ---------------------------------------------------------------------------------------------
DO $payroll_gate$
DECLARE
  v_tenant_a   uuid := '11111111-1111-4111-8111-000000000001'; -- QA Attendance Only (no payroll)
  v_employee_a uuid := '11111111-1111-4111-8111-000000000012';
  v_tenant_c   uuid := '33333333-3333-4333-8333-000000000001'; -- QA Full Suite (payroll on)
  v_employee_c uuid := '33333333-3333-4333-8333-000000000012';
  v_lock_date  date;
  v_result_a   jsonb;
  v_result_c   jsonb;
BEGIN
  BEGIN
    -- A lock date safely in the future relative to today's business date in both tenants
    -- (same timezone), so "date <= lock_date" is unconditionally true regardless of when this
    -- migration is applied.
    v_lock_date := (now() AT TIME ZONE 'Asia/Kolkata')::date + 3650;

    INSERT INTO public.tenant_settings (id, tenant_id, key, value, updated_at)
    VALUES (gen_random_uuid(), v_tenant_a, 'payroll_lock_date', v_lock_date::text, now())
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    INSERT INTO public.tenant_settings (id, tenant_id, key, value, updated_at)
    VALUES (gen_random_uuid(), v_tenant_c, 'payroll_lock_date', v_lock_date::text, now())
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    -- Tenant A: payroll module OFF -- must proceed despite the lock being "set".
    v_result_a := public.punch_in_attendance(v_tenant_a, v_employee_a);
    IF (v_result_a->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'C6 FAILED: QA Attendance Only (payroll OFF) should proceed despite payroll_lock_date, got: %', v_result_a;
    END IF;
    RAISE NOTICE 'C6 verified: QA Attendance Only (payroll module OFF) punched in successfully with payroll_lock_date=% set -- the lock was never read', v_lock_date;

    -- Tenant C: payroll module ON -- must be BLOCKED by the same lock.
    v_result_c := public.punch_in_attendance(v_tenant_c, v_employee_c);
    IF (v_result_c->>'success')::boolean IS NOT FALSE THEN
      RAISE EXCEPTION 'C6 FAILED: QA Full Suite (payroll ON) should be blocked by payroll_lock_date=%, got: %', v_lock_date, v_result_c;
    END IF;
    IF v_result_c->>'reason' <> 'PAYROLL_LOCKED' THEN
      RAISE EXCEPTION 'C6 FAILED: expected reason=PAYROLL_LOCKED, got: %', v_result_c;
    END IF;
    RAISE NOTICE 'C6 verified: QA Full Suite (payroll module ON) correctly BLOCKED: %', v_result_c;

    RAISE EXCEPTION 'C6 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'C6 probe writes rolled back (2 tenant_settings rows touched, 1 attendance row, 1 event)';
  END;
END
$payroll_gate$;

-- ---------------------------------------------------------------------------------------------
-- C7. THE CORE PROMISE: the old direct-insert path (PunchInOut.tsx:742's exact column shape)
-- still works completely unchanged -- still creates exactly one row and fires exactly one
-- dual-write event, same as before this migration.
-- ---------------------------------------------------------------------------------------------
DO $direct_insert_unaffected$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001'; -- QA Attendance Only
  v_employee uuid := '11111111-1111-4111-8111-000000000011';
  v_events_before int;
  v_events_after  int;
  v_att_id   uuid;
  v_row_count int;
  v_ev_direction text;
  v_ev_source    text;
BEGIN
  BEGIN
    SELECT count(*) INTO v_events_before FROM public.attendance_events
     WHERE tenant_id = v_tenant AND employee_id = v_employee;

    -- Exact column shape PunchInOut.tsx:742-756 inserts (punch_in deliberately OMITTED from
    -- the column list, exactly like the real client -- it relies on the column's own DEFAULT
    -- now(), which is what the phantom-event header warns about for OTHER callers, and is
    -- precisely why this probe proves that specific path still behaves as before).
    INSERT INTO public.attendance (
      employee_id, tenant_id, date, punch_in_ip, punch_out_allowed, status, session_status,
      punch_in_lat, punch_in_lng, punch_in_location_accuracy, punch_in_location_status,
      location_accuracy, location_confidence, location_status
    ) VALUES (
      v_employee, v_tenant, CURRENT_DATE, '203.0.113.5', true, 'present', 'open',
      11.11, 22.22, 7.5, 'office_verified',
      7.5, 'high', 'office_verified'
    )
    RETURNING id INTO v_att_id;

    SELECT count(*) INTO v_row_count FROM public.attendance
     WHERE tenant_id = v_tenant AND employee_id = v_employee;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'C7 FAILED: expected exactly 1 attendance row from the direct-insert path, found %', v_row_count;
    END IF;

    SELECT count(*) INTO v_events_after FROM public.attendance_events
     WHERE tenant_id = v_tenant AND employee_id = v_employee;
    IF v_events_after - v_events_before <> 1 THEN
      RAISE EXCEPTION 'C7 FAILED: direct-insert path produced % events (expected exactly 1) -- the dual-write trigger regressed', v_events_after - v_events_before;
    END IF;

    SELECT direction, source INTO v_ev_direction, v_ev_source
    FROM public.attendance_events
    WHERE tenant_id = v_tenant AND employee_id = v_employee
    ORDER BY created_at DESC LIMIT 1;
    IF v_ev_direction <> 'in' THEN
      RAISE EXCEPTION 'C7 FAILED: direct-insert path event has direction=% (expected in)', v_ev_direction;
    END IF;

    RAISE NOTICE 'C7 verified: THE OLD DIRECT-INSERT PATH STILL WORKS UNCHANGED -- 1 attendance row (id=%), 1 dual-write event (direction=in, source=%)', v_att_id, v_ev_source;
    RAISE EXCEPTION 'C7 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'C7 probe writes rolled back (1 attendance row, 1 event)';
  END;
END
$direct_insert_unaffected$;

-- ---------------------------------------------------------------------------------------------
-- C8. Ownership assertion (C3) -- STRUCTURAL proof, not behavioural. The InsForge CLI refuses
-- any statement that changes per-request auth context (confirmed live: attempting to assign the
-- JWT-claims GUC that auth.uid() reads from, via the Postgres config function, is rejected with
-- a "changing SQL session configuration" error), so auth.uid() cannot be simulated inside a
-- migration -- the exact JWT-simulation limitation 20260828100000's
-- own header already documented for assert_hr_for_tenant-gated RPCs. This checks the GUARD
-- SHAPE, not merely that the string exists: the raise must sit textually between the
-- `auth.uid() IS NOT NULL` guard and be qualified by `NOT ... is_hr()` before it, not just be
-- present anywhere in the body (a string search alone would pass even if the raise were
-- unreachable dead code).
-- ---------------------------------------------------------------------------------------------
DO $ownership_structural$
DECLARE
  v_body    text;
  v_guard_pos  int;
  v_hr_pos     int;
  v_raise_pos  int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_in_attendance';

  v_guard_pos := position('(SELECT auth.uid()) IS NOT NULL THEN' in v_body);
  v_hr_pos    := position('NOT (SELECT public.is_hr())' in v_body);
  v_raise_pos := position('NOT_YOUR_ATTENDANCE' in v_body);

  IF v_guard_pos = 0 THEN
    RAISE EXCEPTION 'C8 FAILED: no auth.uid() IS NOT NULL guard found in punch_in_attendance';
  END IF;
  IF v_hr_pos = 0 THEN
    RAISE EXCEPTION 'C8 FAILED: no "NOT ... is_hr()" qualification found in punch_in_attendance';
  END IF;
  IF v_raise_pos = 0 THEN
    RAISE EXCEPTION 'C8 FAILED: NOT_YOUR_ATTENDANCE raise not found in punch_in_attendance';
  END IF;
  -- Shape: guard opens first, the is_hr() qualification and the raise both sit AFTER it (i.e.
  -- inside that branch), and the is_hr() check comes before the raise it guards.
  IF NOT (v_guard_pos < v_hr_pos AND v_hr_pos < v_raise_pos) THEN
    RAISE EXCEPTION 'C8 FAILED: ownership check is not correctly nested (guard@%, is_hr@%, raise@%)', v_guard_pos, v_hr_pos, v_raise_pos;
  END IF;

  RAISE NOTICE 'C8 verified STRUCTURALLY: NOT_YOUR_ATTENDANCE raise sits inside the auth.uid() IS NOT NULL branch, guarded by NOT is_hr(). NOT independently exercised end-to-end: the CLI refuses to simulate a per-request JWT inside a migration (confirmed live), so the authenticated cross-employee REJECTION path itself is unproven by any probe here -- it requires a live/frontend QA pass with two real employee sessions, exactly the same stated limitation 20260828100000 already carries for assert_hr_for_tenant-gated RPCs.';
END
$ownership_structural$;

-- ---------------------------------------------------------------------------------------------
-- C9. Final population check: attendance_events and attendance are back at their pre-probe
-- counts. This is the phantom-event class of bug's actual detector -- a per-row sample check
-- cannot see this; only a total-population comparison can.
-- ---------------------------------------------------------------------------------------------
DO $final_population$
DECLARE
  v_events int;
  v_rows   int;
BEGIN
  SELECT count(*) INTO v_events FROM public.attendance_events;
  SELECT count(*) INTO v_rows FROM public.attendance;
  RAISE NOTICE 'FINAL: attendance_events=%, attendance=% (compare against the BASELINE notice above -- must be equal if no concurrent real traffic occurred during this migration)', v_events, v_rows;
END
$final_population$;
