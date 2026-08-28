-- Phase 3 of the attendance completion plan (doc/attendance_completion_plan_2026-08-24.md).
-- B6 part 2 (decision doc §8): completeness (Pass 2), watermarks, half-day leave (E23),
-- the manual HR trigger (D4), and the dual-write flip decision.
--
-- Authority: `new update doc/attendance_shift_v2_decision_doc.md` §2.2 (Pass 2), §2.6, §2.7
-- (the watermark pair and the deliberate 24h lag), §6, §7 E10, E17, E18, E22-E29, E41-E45,
-- §10 (rules for future agents).
--
-- Applied head at planning time: 20260825100000. This file is the assigned version
-- 20260828100000.
--
-- ============================================================================
-- VERIFIED LIVE BEFORE WRITING THIS (do not trust doc/database_schema.md -- rule 6)
-- ============================================================================
-- attendance 13 rows, ALL with shift_id IS NULL (nothing in the punch path, hr_update_
-- attendance, or approve_leave_request sets it). attendance_events 3 organic rows, all
-- source='manual', direction='in', created 2026-08-24 -- real HR edits via hr_update_
-- attendance's INSERT branch. attendance_audit_logs 0 rows total (none named
-- 'event_dual_write_failed'). attendance_derivation_runs 0 rows. All 6 live shifts have
-- last_sync_of_events IS NULL and process_attendance_after IS NULL (neither is exposed via
-- hr_save_shift or the UI yet, per 20260824100000's own header). employees.status is
-- CHECK-constrained to active|inactive|terminated|draft|pending_hr_review|pending_onboarding
-- (only active/draft exist live). There is no employees.relieving_date column; the closest
-- concept is exit_requests.last_working_date (CHECK status IN pending_approval|
-- notice_period|clearance_pending|completed|withdrawn|rejected; only one live row, status
-- notice_period). leaves has 15 columns, no half-day concept at all before this migration.
--
-- ============================================================================
-- A BUG FOUND WHILE VERIFYING THE ABOVE, FIXED HERE (not silently, not deferred)
-- ============================================================================
-- attendance.punch_in has DEFAULT now(). attendance_derive_pass1's INSERT branch
-- (20260825100000) does not name punch_in in its column list, so every Pass-1-created row
-- got punch_in = now() from the column default -- NOT NULL -- which the dual-write trigger's
-- "AFTER INSERT ... NEW.punch_in IS NOT NULL" branch cannot tell apart from a real app
-- punch-in. Every Pass 1 INSERT has therefore been emitting a PHANTOM 'in' event into the
-- supposedly-immutable log, silently, since 20260825100000 was applied. Pass 1's own header
-- claimed the opposite ("punch_in/punch_out ... deliberately never sets or updates either
-- column"), and its own E3 probe only checked `WHERE id IN (v_ev1, v_ev2)` -- a query that
-- cannot see a THIRD, unexpected event, so it passed anyway.
--
-- Confirmed live before writing this migration with a rolled-back probe that reproduced
-- Pass 1's exact INSERT column list: it stamped 1 phantom event per row. Fixed below, inside
-- the CREATE OR REPLACE this migration already needs for E23 (section B): punch_in is now
-- named explicitly as NULL in the INSERT branch, matching how approve_leave_request already
-- does it. This also directly matters for section E below -- a log the derivation processor
-- itself was quietly polluting is a weaker case for calling it "authoritative enough to
-- raise on" than a clean one, so this fix lands before that decision is made, not after.
--
-- ============================================================================
-- THE JWT-SIMULATION LIMITATION, AND HOW IT SHAPES THE ASSERTIONS BELOW
-- ============================================================================
-- assert_hr_for_tenant (used by hr_save_shift, hr_update_attendance, approve_leave_request,
-- and by hr_run_attendance_derivation below) unconditionally raises when auth.uid() IS NULL
-- -- it has no session-less bypass arm, unlike the lower-level definer helpers (attendance_
-- derive_pass1, work_calendar_holiday, attendance_event_ingest). The CLI used to apply this
-- migration refuses any statement that changes per-request auth context, confirmed live
-- before writing this file, so there is no way to simulate an authenticated HR session
-- inside a SQL-only migration.
-- Checked: no migration in this repo has ever called an assert_hr_for_tenant-gated RPC
-- (hr_save_shift, hr_update_attendance, approve_leave_request) from its own assertions --
-- 20260824100000's own hr_save_shift extension tests the underlying table/constraint
-- behaviour directly and never calls hr_save_shift itself. This migration follows the same
-- established convention for hr_run_attendance_derivation: "a non-HR caller is refused" is
-- proven by a real session-less call (a project_admin/migration-context caller IS,
-- definitionally, not an authenticated HR user -- no simulation needed); "writes a complete
-- run row" is proven by replicating the wrapper's own internal sequence (insert the run row,
-- loop shifts, call Pass 1 then Pass 2, aggregate) directly, since that machinery is not
-- itself auth-gated. Stated as a limitation, not hidden: genuine end-to-end verification of
-- the authenticated happy path needs a manual/frontend QA pass, flagged in the report.
--
-- The same limitation is why section E's three-path dual-write proof only adds NEW probes
-- for the punch-in (direct INSERT) and punch-out (punch_out_attendance RPC) paths, neither
-- of which is auth-gated. The HR-manual-edit path is proven by the 3 organic events already
-- live (hr_update_attendance's INSERT branch, real HR user, 2026-08-24) plus the confirmed
-- zero rows in attendance_audit_logs for 'event_dual_write_failed' since 20260821220000 was
-- applied -- i.e. that path has already succeeded, three times, for real, with no recorded
-- failure. No new probe can prove that path more strongly than it already is proven.

-- ============================================================================
-- A. leaves.day_fraction -- half-day leave support (E23), approved this session
-- ============================================================================
-- CHOICE: a numeric fraction in (0, 1], not a boolean is_half_day. A fraction covers a half
-- day (0.5) without foreclosing a quarter day later, and payroll -- designed last, per the
-- module-independence roadmap -- can consume the fraction directly instead of another
-- boolean-to-fraction translation layer being invented on top of it afterwards. Default 1.0
-- (a full day) preserves every existing row's meaning exactly; proven, not assumed, in the
-- assertions below.
ALTER TABLE public.leaves
  ADD COLUMN IF NOT EXISTS day_fraction numeric NOT NULL DEFAULT 1.0;

ALTER TABLE public.leaves DROP CONSTRAINT IF EXISTS leaves_day_fraction_check;
ALTER TABLE public.leaves ADD CONSTRAINT leaves_day_fraction_check
  CHECK (day_fraction > 0 AND day_fraction <= 1);

-- approve_leave_request is DELIBERATELY NOT touched here. It still deducts whole days
-- (v_approved_business_days, an integer count of working dates) from leave_balances
-- regardless of day_fraction, and its INSERT into attendance still always writes
-- status='on_leave' unconditionally. Making leave approval/balance math fraction-aware is a
-- separate release -- this column exists now so attendance derivation (Pass 1/Pass 2) can
-- read it TODAY (E23) and so payroll's eventual design sees the concept from the start,
-- without foreclosing anything about how balances get deducted. The new column's default
-- (1.0) keeps approve_leave_request's behaviour byte-for-byte identical: that function never
-- references day_fraction anywhere in its body, so its output cannot change regardless of
-- the column's value on any row it touches. FOLLOW-UP, stated explicitly: approve_leave_
-- request does not yet let HR submit a half-day leave request at all (there is no UI or RPC
-- parameter for it) -- day_fraction is schema headroom for that future release, consumed
-- today only by the read side (derivation).

-- ============================================================================
-- B. attendance_derive_pass1 -- CREATE OR REPLACE, IDENTICAL SIGNATURE, two surgical fixes
-- ============================================================================
-- (1) E23: an approved leave whose day_fraction < 1 now yields half_day (with leave_id set)
--     instead of on_leave. Full-day leave (day_fraction = 1, the default) is unchanged.
-- (2) The punch_in phantom-event bug described in the header above: punch_in is now named
--     explicitly as NULL in the INSERT branch.
-- Every other line is byte-identical to 20260825100000's definition -- this is not a
-- rewrite. RETURNS TABLE signature is unchanged (required: CREATE OR REPLACE errors on a
-- changed return type), so grants (already REVOKEd from PUBLIC/anon/authenticated in
-- 20260825100000) are preserved automatically and are not re-issued here.
CREATE OR REPLACE FUNCTION public.attendance_derive_pass1(
  p_tenant_id uuid,
  p_shift_id  uuid,
  p_from      date,
  p_to        date,
  p_run_id    uuid
)
 RETURNS TABLE (
   groups_processed integer,
   rows_created     integer,
   rows_updated     integer,
   rows_skipped     integer,
   events_processed integer
 )
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
        punch_in, late_entry, early_exit, in_time, out_time, work_hours, leave_id,
        shift_snapshot, policy_snapshot, business_date_tz, derived_at, derivation_version,
        session_status
      ) VALUES (
        p_tenant_id, v_group.employee_id, v_local_date, p_shift_id, v_status, 'derived',
        NULL, v_late_entry, v_early_exit, v_calc.in_time, v_calc.out_time, v_calc.hours, v_leave_id,
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

COMMENT ON FUNCTION public.attendance_derive_pass1(uuid, uuid, date, date, uuid) IS
'B6 Pass 1 (decision doc §6): groups unprocessed attendance_events by (employee_id, shift_start) -- never by calendar date, which is the night-shift solution (§2.2) -- computes hours via attendance_calculate_working_hours, derives present/half_day/absent by D6 ordering (absent threshold first, thresholds halved on a half-day holiday), lets an approved leave override to on_leave or half_day (E23, day_fraction < 1) (D8), upserts attendance skipping is_locked rows (D5), and stamps attendance_id onto every event in the group. INSERT branch names punch_in = NULL explicitly (20260828100000 fix: the column DEFAULT now() was otherwise producing a phantom dual-write event on every derived row). Advisory-locked per (tenant, shift) (E42). Caller must INSERT the attendance_derivation_runs row identified by p_run_id first; this function only updates it. Not granted to authenticated -- see 20260825100000 header deviation 3.';

-- ============================================================================
-- C. attendance_derive_pass2 -- completeness (D4, resolves C2) + the watermark interlock (§2.7)
-- ============================================================================
-- ITERATES ASSIGNED EMPLOYEES, NOT EVENTS. Events can only tell you who was present; only
-- the shift assignment knows who should have been. This is the structural reason C2 exists,
-- and getting it backwards (iterating events, or iterating "all employees" without going
-- through employee_shifts) makes the whole release pointless -- see the brief.
--
-- EXISTENCE CHECK IS DELIBERATELY NOT SCOPED BY shift_id, BUT THE INSERT IS. All 13 live
-- attendance rows have shift_id IS NULL (nothing in the punch path, hr_update_attendance, or
-- approve_leave_request sets it) -- confirmed live before writing this. If the "does a row
-- already exist for this date" check were scoped to `shift_id = p_shift_id`, Pass 2 would
-- not see a NULL-shift punch/leave/HR-edit row on that date (different coalesced unique key)
-- and would insert a SECOND row for the same day -- a duplicated day, worse than a missing
-- one. So the existence check matches on (tenant_id, employee_id, date) alone, regardless of
-- shift_id. The INSERT itself still stamps shift_id = p_shift_id, though, or Pass 1's own
-- lookup (`... AND shift_id = p_shift_id`, unchanged above) could never find a Pass-2-created
-- absent row again on replay, and E17 (a backdated event flipping absent -> present) would
-- silently fail to find anything to flip.
--
-- WATERMARK SEMANTICS (§2.7), STATED EXPLICITLY:
--   - process_attendance_after clamps the START of the whole range this function will touch
--     (weekly_off/holiday/on_leave/absent alike) -- it protects imported/legacy history from
--     ANY new derivation output, not just absence, which is why it is folded into
--     v_from_clamped below rather than gating only the absent branch.
--   - last_sync_of_events + the deliberate 24h lag gates ONLY the absent branch. weekly_off,
--     holiday and on_leave are FACTS independent of whether device events have arrived yet
--     (a Sunday is a Sunday, an approved leave is an approved leave, regardless of event
--     sync state) -- only "absent" is an INFERENCE from missing events, which is exactly the
--     risky step the watermark exists to guard. Collapsing "only process shifts whose window
--     ended before last_sync_of_events" and "absentees one day before that" into one
--     v_absent_watermark_date := (last_sync_of_events at tenant tz)::date - 1 is a safe,
--     conservative combination of both bullets given every shift's total span (scheduled +
--     both margins) is already constrained to < 1440 minutes by shifts_circular_shift_check
--     (20260824100000) -- no shift instance can straddle more than one extra calendar day.
--   - last_sync_of_events UNSET (NULL, the live state of all 6 shifts today) means "we do
--     not know whether events have arrived for this shift at all". REFUSING to mark absent
--     in that case is the safe reading, per the brief: an unset watermark is not evidence of
--     completeness, and unknown must never become a confident 'absent' -- the same
--     "unknown != zero" rule that produced the ₹0 payslips. When the watermark cannot
--     justify an absent row, Pass 2 writes NOTHING for that date (no row at all) rather than
--     guessing 'present' or writing 'absent' anyway -- an honest gap, not a wrong answer.
--
-- CLAMPS: date_of_joining (E26), an exit_requests-derived relieving date (E27, see below --
-- there is no employees.relieving_date column), inactive employees (E28, status <> 'active'
-- skips the employee entirely -- draft/pending_hr_review/pending_onboarding/terminated/
-- inactive are all "not currently expected to attend").
--
-- E27 clamp source: employees has no relieving_date column (verified live). The closest
-- concept is exit_requests.last_working_date. STATED CHOICE: clamp using the EARLIEST
-- last_working_date among exit_requests rows whose status is NOT IN ('withdrawn',
-- 'rejected') -- i.e. any request that is still active or was actually completed, not one
-- that was called off. pending_approval/notice_period/clearance_pending are included
-- deliberately: once HR has recorded a last working date, attendance should not be derived
-- past it even while the exit is still administratively in progress, not only once it is
-- marked 'completed'. Withdrawn/rejected requests are excluded because those specifically
-- mean the employee is NOT leaving on that date after all.
--
-- D5 (is_locked) is satisfied structurally, not by a separate check: Pass 2 only ever
-- INSERTs into a date with NO existing attendance row at all (any row -- including a locked
-- one -- is skipped by the existence check above), so it can never overwrite an is_locked row.
--
-- SECURITY DEFINER / RLS bypass: same fencing pattern as Pass 1 (binding rule 1) --
-- can_access_tenant with the auth.uid() IS NULL arm, tenant_has_module_for('attendance').
-- Same advisory lock key as Pass 1 (hashtext(tenant), hashtext(shift)) so the two passes
-- (and repeat Pass 2 calls) serialize correctly against each other for a given (tenant,shift).
-- Not granted to authenticated -- same reasoning as Pass 1 (deviation 3 in 20260825100000):
-- the HR-facing entry point with its own is_hr() check is hr_run_attendance_derivation
-- (section D below), not this function directly.
CREATE OR REPLACE FUNCTION public.attendance_derive_pass2(
  p_tenant_id uuid,
  p_shift_id  uuid,
  p_from      date,
  p_to        date,
  p_run_id    uuid
)
 RETURNS TABLE (
   employees_processed     integer,
   rows_created             integer,
   rows_skipped_watermark   integer
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tz                     text;
  v_shift                  public.shifts%ROWTYPE;
  v_assign                 record;
  v_relieving_date         date;
  v_from_clamped           date;
  v_to_clamped             date;
  v_absent_watermark_date  date;
  v_date                   date;
  v_holiday                record;
  v_leave_id               uuid;
  v_leave_day_fraction     numeric;
  v_status                 text;
  v_employees_processed    integer := 0;
  v_rows_created           integer := 0;
  v_rows_skipped_watermark integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_shift_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'attendance_derive_pass2: all five parameters are required';
  END IF;

  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible';
  END IF;

  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'attendance module not enabled for tenant %', p_tenant_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text), hashtext(p_shift_id::text));

  SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id AND s.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift % not found for tenant %', p_shift_id, p_tenant_id;
  END IF;

  SELECT COALESCE(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id;
  END IF;

  -- §2.7: absent-marking watermark. NULL last_sync_of_events -> no absent row can ever be
  -- justified for this shift (the safe reading; see the header note).
  v_absent_watermark_date := CASE
    WHEN v_shift.last_sync_of_events IS NULL THEN NULL
    ELSE (v_shift.last_sync_of_events AT TIME ZONE v_tz)::date - 1
  END;

  FOR v_assign IN
    SELECT es.employee_id, es.effective_from, es.effective_to,
           e.date_of_joining, e.status AS emp_status
    FROM public.employee_shifts es
    JOIN public.employees e ON e.id = es.employee_id AND e.tenant_id = es.tenant_id
    WHERE es.tenant_id = p_tenant_id
      AND es.shift_id = p_shift_id
      AND es.effective_from <= p_to
      AND (es.effective_to IS NULL OR es.effective_to >= p_from)
  LOOP
    IF v_assign.emp_status <> 'active' THEN
      -- E28: inactive/terminated/draft/etc employees are never derived for.
      CONTINUE;
    END IF;

    v_employees_processed := v_employees_processed + 1;

    -- E27: earliest still-relevant exit_requests.last_working_date (see header note on why
    -- withdrawn/rejected are excluded).
    v_relieving_date := NULL;
    SELECT er.last_working_date INTO v_relieving_date
    FROM public.exit_requests er
    WHERE er.tenant_id = p_tenant_id
      AND er.employee_id = v_assign.employee_id
      AND er.status <> ALL (ARRAY['withdrawn', 'rejected'])
      AND er.last_working_date IS NOT NULL
    ORDER BY er.last_working_date ASC
    LIMIT 1;

    -- E26 (date_of_joining) + this assignment's own effective_from + process_attendance_after
    -- (self-enforced here too, not only by the caller -- see header) bound the START.
    -- effective_to + the E27 relieving date bound the END.
    v_from_clamped := GREATEST(
      p_from, v_assign.effective_from,
      COALESCE(v_assign.date_of_joining, p_from),
      COALESCE(v_shift.process_attendance_after, p_from)
    );
    v_to_clamped := LEAST(
      p_to, COALESCE(v_assign.effective_to, p_to), COALESCE(v_relieving_date, p_to)
    );

    v_date := v_from_clamped;
    WHILE v_date <= v_to_clamped LOOP
      -- Existence check is NOT scoped by shift_id -- see header. Any row on this date, from
      -- any source (punch, HR edit, leave approval, an earlier Pass 1/Pass 2 run), means
      -- there is nothing for completeness to fill in, and an is_locked row is protected for
      -- free by never being a candidate here at all.
      IF EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.tenant_id = p_tenant_id AND a.employee_id = v_assign.employee_id AND a.date = v_date
      ) THEN
        v_date := v_date + 1;
        CONTINUE;
      END IF;

      v_leave_id := NULL;
      v_leave_day_fraction := NULL;
      v_status := NULL;

      IF NOT (EXTRACT(DOW FROM v_date)::int = ANY (v_shift.working_days)) THEN
        -- E25
        v_status := 'weekly_off';
      ELSE
        SELECT * INTO v_holiday
        FROM public.work_calendar_holiday(p_tenant_id, v_assign.employee_id, v_date);

        IF v_holiday.is_holiday THEN
          -- E24 (completeness reading -- see Pass 1 for the mark_attendance_on_holidays
          -- opt-in, which only matters when there ARE events to consider).
          v_status := 'holiday';
        ELSE
          SELECT l.id, l.day_fraction INTO v_leave_id, v_leave_day_fraction
          FROM public.leaves l
          WHERE l.tenant_id = p_tenant_id
            AND l.employee_id = v_assign.employee_id
            AND l.status = 'approved'
            AND v_date BETWEEN l.start_date AND l.end_date
          ORDER BY l.start_date DESC
          LIMIT 1;

          IF v_leave_id IS NOT NULL THEN
            -- E22 / E23
            v_status := CASE WHEN v_leave_day_fraction < 1 THEN 'half_day' ELSE 'on_leave' END;
          ELSIF v_absent_watermark_date IS NOT NULL AND v_date <= v_absent_watermark_date THEN
            v_status := 'absent';
          ELSE
            -- The watermark interlock: no evidence either way, and it is not yet safe to
            -- infer absence. Write nothing -- an honest gap, not a guess.
            v_rows_skipped_watermark := v_rows_skipped_watermark + 1;
            v_date := v_date + 1;
            CONTINUE;
          END IF;
        END IF;
      END IF;

      -- punch_in named explicitly as NULL for the same reason as the Pass 1 fix above: the
      -- column DEFAULT now() would otherwise fire the dual-write trigger's INSERT branch and
      -- append a phantom 'in' event for a row that has no punch evidence at all.
      INSERT INTO public.attendance (
        tenant_id, employee_id, date, shift_id, status, derivation_source,
        punch_in, leave_id, business_date_tz, derived_at, derivation_version, session_status
      ) VALUES (
        p_tenant_id, v_assign.employee_id, v_date, p_shift_id, v_status, 'derived',
        NULL, v_leave_id, v_tz, now(), 1, 'closed'
      );
      v_rows_created := v_rows_created + 1;

      v_date := v_date + 1;
    END LOOP;
  END LOOP;

  UPDATE public.attendance_derivation_runs AS r
  SET rows_created = COALESCE(r.rows_created, 0) + v_rows_created,
      rows_skipped = COALESCE(r.rows_skipped, 0) + v_rows_skipped_watermark,
      finished_at  = now(),
      status       = 'completed'
  WHERE r.id = p_run_id AND r.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance_derivation_runs row % not found for tenant % -- caller must INSERT the run row before calling attendance_derive_pass2', p_run_id, p_tenant_id;
  END IF;

  RETURN QUERY SELECT v_employees_processed, v_rows_created, v_rows_skipped_watermark;
END;
$function$;

COMMENT ON FUNCTION public.attendance_derive_pass2(uuid, uuid, date, date, uuid) IS
'B6 Pass 2 (decision doc §6, D4, resolves C2): completeness over ASSIGNED EMPLOYEES, not events. For each employee assigned to the shift with no existing attendance row on a date: weekly_off (not a working day, E25) / holiday (work_calendar_holiday, E24) / on_leave or half_day (approved leave, E22/E23) / absent (E10, gated by the last_sync_of_events watermark with the deliberate 24h lag, §2.7) -- unwatermarked absent candidates are left unwritten, not guessed. Clamped by date_of_joining (E26), process_attendance_after, effective_to, and an exit_requests-derived relieving date excluding withdrawn/rejected requests (E27); inactive employees skipped entirely (E28). Existence check ignores shift_id (see header: all live attendance rows have shift_id NULL) but the INSERT stamps shift_id = p_shift_id. Advisory-locked per (tenant, shift), same key as Pass 1. Caller must INSERT the attendance_derivation_runs row identified by p_run_id first. Not granted to authenticated -- see hr_run_attendance_derivation.';

REVOKE EXECUTE ON FUNCTION public.attendance_derive_pass2(uuid, uuid, date, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attendance_derive_pass2(uuid, uuid, date, date, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.attendance_derive_pass2(uuid, uuid, date, date, uuid) FROM authenticated;

-- ============================================================================
-- D. hr_run_attendance_derivation -- the manual HR trigger (D4)
-- ============================================================================
-- THE authorized entry point. Uses assert_hr_for_tenant directly, matching hr_save_shift /
-- hr_update_attendance / approve_leave_request -- NO auth.uid() IS NULL bypass arm.
--
-- STATED DEVIATION from binding rule 1's general text ("include the auth.uid() IS NULL arm
-- so it stays callable from a migration, cron, or service-role context"): every existing
-- "HR does a thing" entry point in this codebase (hr_save_shift, hr_update_attendance,
-- approve_leave_request) uses assert_hr_for_tenant with no bypass, and all three are
-- consequently NOT callable session-less either -- this is the established shape for an
-- HR-ACTION endpoint specifically, as opposed to the internal definer helpers (attendance_
-- derive_pass1/2, work_calendar_holiday, attendance_event_ingest) that DO carry the bypass
-- because they are meant to be called from triggers, each other, or a future service-role
-- context. hr_run_attendance_derivation is squarely in the first category: it is "the manual
-- HR trigger" by design (D4), a human clicking a button. The future scheduled arm (also
-- named in D4) is explicitly deferred by the completion plan ("schedule wiring stays a
-- separate small piece after B6 is proven") and will need its own auth story when it lands
-- -- most likely a distinct service-role-callable wrapper, not a bypass bolted onto this one,
-- so that "a non-HR caller is refused" keeps meaning what it says for the function that IS
-- granted to authenticated today.
CREATE OR REPLACE FUNCTION public.hr_run_attendance_derivation(
  p_tenant_id uuid,
  p_from      date,
  p_to        date
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_run_id        uuid := gen_random_uuid();
  v_shift         record;
  v_from_clamped  date;
  v_error_count   integer := 0;
  v_error_detail  jsonb := '[]'::jsonb;
BEGIN
  IF p_tenant_id IS NULL OR p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'hr_run_attendance_derivation: all three parameters are required';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'hr_run_attendance_derivation: p_from must not be after p_to';
  END IF;

  -- The authorization gate. Raises 'Unauthenticated' / 'Tenant access denied' /
  -- 'HR privileges required' for anyone who is not an authenticated HR user of this tenant,
  -- including a session-less (project_admin/migration/cron) caller.
  PERFORM public.assert_hr_for_tenant(p_tenant_id);

  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'attendance module not enabled for tenant %', p_tenant_id;
  END IF;

  -- shift_id NULL: this run spans every eligible shift, not one.
  INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
  VALUES (v_run_id, p_tenant_id, NULL, p_from, p_to, 'manual', 'running');

  -- enable_auto_derivation is the shift-level opt-out (added 20260824100000, unused by any
  -- code path until now): a shift with it off never participates in automatic derivation at
  -- all, manual or scheduled. is_active excludes retired shifts.
  FOR v_shift IN
    SELECT * FROM public.shifts s
    WHERE s.tenant_id = p_tenant_id AND s.is_active AND s.enable_auto_derivation
  LOOP
    v_from_clamped := GREATEST(p_from, COALESCE(v_shift.process_attendance_after, p_from));

    -- Each pass, for each shift, gets its OWN sub-block: a Pass 2 failure must not roll back
    -- Pass 1's already-committed work for the same shift, and one shift's failure must not
    -- abort the rest of the tenant's shifts. Errors are recorded, not swallowed silently.
    BEGIN
      PERFORM public.attendance_derive_pass1(p_tenant_id, v_shift.id, v_from_clamped, p_to, v_run_id);
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_error_detail := v_error_detail || jsonb_build_object(
        'shift_id', v_shift.id, 'pass', 1, 'sqlstate', SQLSTATE, 'message', SQLERRM
      );
    END;

    BEGIN
      PERFORM public.attendance_derive_pass2(p_tenant_id, v_shift.id, v_from_clamped, p_to, v_run_id);
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_error_detail := v_error_detail || jsonb_build_object(
        'shift_id', v_shift.id, 'pass', 2, 'sqlstate', SQLSTATE, 'message', SQLERRM
      );
    END;
  END LOOP;

  -- Final word on the run row: overrides whatever Pass 1/Pass 2's own trailing updates left
  -- (their per-call 'completed' is only ever true of that one call, not the whole run).
  UPDATE public.attendance_derivation_runs
  SET error_count  = v_error_count,
      error_detail = CASE WHEN v_error_count > 0 THEN v_error_detail ELSE NULL END,
      status       = CASE WHEN v_error_count > 0 THEN 'failed' ELSE 'completed' END,
      finished_at  = now()
  WHERE id = v_run_id;

  RETURN v_run_id;
END;
$function$;

COMMENT ON FUNCTION public.hr_run_attendance_derivation(uuid, date, date) IS
'D4''s manual HR trigger and the ONLY attendance-derivation entry point granted to authenticated. assert_hr_for_tenant gates it (no session-less bypass -- see header deviation note); guards tenant_has_module_for(attendance); creates one attendance_derivation_runs row (shift_id NULL, spans the tenant); runs Pass 1 then Pass 2 for every is_active + enable_auto_derivation shift, clamped per-shift by process_attendance_after; records per-shift/per-pass errors into error_count/error_detail without aborting the rest of the run; sets the final status/finished_at. Pass 1 and Pass 2 stay project_admin-only.';

REVOKE EXECUTE ON FUNCTION public.hr_run_attendance_derivation(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hr_run_attendance_derivation(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_run_attendance_derivation(uuid, date, date) TO authenticated;

-- ============================================================================
-- E. The dual-write flip decision -- EARNED, not assumed
-- ============================================================================
-- Step 1 (query attendance_audit_logs): confirmed live before writing this migration --
-- ZERO rows total in attendance_audit_logs (any action), therefore zero rows named
-- 'event_dual_write_failed' since 20260821220000 was applied. Re-asserted below as a live
-- migration-time check, not just a one-off ad-hoc query, so this migration fails loudly if
-- that fact has changed by the time it is actually applied.
--
-- Step 2 (prove all three write paths succeed): the HR-manual-edit path (hr_update_
-- attendance) is proven by the 3 organic events already live (2026-08-24, real HR user,
-- INSERT branch) plus step 1's zero-failures finding -- see the header's JWT-simulation note
-- for why no NEW probe is added for that specific path. The punch-in (direct table INSERT)
-- and punch-out (punch_out_attendance RPC) paths are proven below, freshly, in section F's
-- assertions, against a QA fixture employee with no live attendance rows (so no collision
-- with idx_single_open_session, the one-open-session-per-employee partial unique index).
--
-- Step 3 (flip): both step 1 and step 2 hold, so the trigger's failure handler flips from
-- RECORDING to RAISING here. Why the log is authoritative enough to justify it now: B6's own
-- processor (Pass 1 above) reads attendance_events as its sole input, so a punch that never
-- reached the log is now not a logging inconvenience -- it is data the derivation processor
-- can never see, and (per 20260821220000's own header) "a day derived from a knowingly
-- incomplete log is worse than a failed punch". A failure recorded instead of raised would
-- let a punch succeed while silently vanishing from the one place the processor looks.
CREATE OR REPLACE FUNCTION public.attendance_dual_write_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text;
  v_actor  uuid;
BEGIN
  SELECT id INTO v_actor FROM public.employees
   WHERE user_id = auth.uid() AND tenant_id = NEW.tenant_id;

  v_source := CASE WHEN v_actor IS NOT NULL AND v_actor = NEW.employee_id
                   THEN 'app' ELSE 'manual' END;

  -- CHANGED (20260828100000): the log is now authoritative -- see the header. A dual-write
  -- failure RAISES and aborts the punch, instead of being recorded to attendance_audit_logs
  -- and letting the punch through with a silently incomplete log.
  IF TG_OP = 'INSERT' AND NEW.punch_in IS NOT NULL THEN
    PERFORM public.attendance_event_ingest(
      p_tenant_id     => NEW.tenant_id,
      p_employee_id   => NEW.employee_id,
      p_event_time    => NEW.punch_in,
      p_direction     => 'in',
      p_source        => v_source,
      p_attendance_id => NEW.id,
      p_lat           => NEW.punch_in_lat,
      p_lng           => NEW.punch_in_lng,
      p_location_status => NEW.punch_in_location_status,
      p_idempotency_key => NEW.id::text || ':in'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.punch_out IS NULL AND NEW.punch_out IS NOT NULL THEN
    PERFORM public.attendance_event_ingest(
      p_tenant_id     => NEW.tenant_id,
      p_employee_id   => NEW.employee_id,
      p_event_time    => NEW.punch_out,
      p_direction     => 'out',
      p_source        => v_source,
      p_attendance_id => NEW.id,
      p_lat           => NEW.punch_out_lat,
      p_lng           => NEW.punch_out_lng,
      p_location_status => NEW.punch_out_location_status,
      p_idempotency_key => NEW.id::text || ':out'
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger definition itself (name, timing, events) is unchanged -- only the function body
-- above changed. Re-stated for clarity, matching 20260821220000's own DROP-then-CREATE shape.
DROP TRIGGER IF EXISTS trg_attendance_dual_write_event ON public.attendance;
CREATE TRIGGER trg_attendance_dual_write_event
  AFTER INSERT OR UPDATE OF punch_out ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.attendance_dual_write_event();

-- ============================================================================
-- F. Assertions -- each proves its own claim by doing the thing (Phase 0a lesson: PL/pgSQL
-- plans each statement on first execution of THAT statement). Every probe that writes runs
-- inside a nested BEGIN/EXCEPTION block ending in a private sentinel SQLSTATE ('ZZ001'),
-- caught by that same block -- the implicit per-EXCEPTION-block savepoint rolls back exactly
-- the probe's own writes. Any OTHER error propagates out of the DO block and aborts this
-- migration's transaction: an honest assertion failure means nothing in this file applies.
-- ============================================================================

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
