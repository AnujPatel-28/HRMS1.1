-- Phase 2 of the attendance completion plan (doc/attendance_completion_plan_2026-08-24.md).
-- B6 part 1 (decision doc §8): the derivation processor, Pass 1 only (events -> present /
-- half_day / absent / on_leave). Pass 2 (completeness / absent-marking over ASSIGNED
-- EMPLOYEES, watermarks, the manual HR trigger) is Phase 3 and is NOT in this file.
--
-- Authority: `new update doc/attendance_shift_v2_decision_doc.md` §2.2 (grouping and
-- half-day halving), §2.3 (status ordering, D6), §2.4 (the 2x2 working-hours matrix, D7),
-- §2.6 (leave overrides, D8), §5.2 (the attendance columns), §5.5 (attendance_derivation_runs),
-- §6 (the algorithm), §7 E1/E2/E9-E14/E17/E19-E24/E41/E42, §10 (rules for future agents).
--
-- Applied head at planning time: 20260824110000. This file is 20260825100000 (assigned;
-- the plan doc's own 20260824120000 would sort before that head's date has since become
-- true history -- the honest timestamp is used instead, per the brief).
--
-- ============================================================================
-- DEVIATION 1: NO half-day LEAVE OVERRIDE (E23) -- SCHEMA DOES NOT CARRY THE CONCEPT
-- ============================================================================
-- D8 / §7 E23 say approved leave overrides status to `on_leave`, or to `half_day` when the
-- leave itself is a half-day leave. Verified live: neither `leaves` nor `leave_types` has any
-- half-day column (checked information_schema.columns for both tables before writing this).
-- There is nothing to read. This migration implements the full-day half of D8 only (E22):
-- an approved leave covering the business date sets status='on_leave' and leave_id. E23 stays
-- unimplemented until a half-day-leave column exists somewhere upstream -- noted here rather
-- than silently dropped, and NOT invented as a side effect of this migration (that would be
-- scope creep into leave's data model from an attendance migration).
--
-- ============================================================================
-- DEVIATION 2: WATERMARKS (process_attendance_after / last_sync_of_events) ARE NOT CHECKED
-- HERE -- THEY ARE PASS 2 / PHASE 3'S JOB
-- ============================================================================
-- §6's pseudocode hangs both watermark guards off the top-level `derive_attendance` wrapper,
-- which fronts BOTH passes. But the completion plan's own phase split (§ Phase 3, "Watermarks")
-- assigns them there, and this migration's brief lists neither watermark among Pass 1's
-- deliverables. The risk they exist to prevent is specific to Pass 2 (marking someone absent
-- for a day whose device logs have not arrived yet, or before legacy history's cutoff) --
-- Pass 1 only ever touches events that already exist and are already queued
-- (`attendance_id IS NULL`), so there is nothing for a Pass-1-only watermark to protect against
-- that filtering by `p_from`/`p_to` does not already cover. `p_from`/`p_to` are taken as
-- explicit, caller-supplied business dates (never `current_date`/`now()::date`, per D9);
-- clamping them to `process_attendance_after` is the caller's (Phase 3's HR-trigger wrapper)
-- responsibility once it exists.
--
-- ============================================================================
-- DEVIATION 3: attendance_derive_pass1 IS NOT GRANTED TO `authenticated` IN THIS PHASE
-- ============================================================================
-- The function is SECURITY DEFINER and, per binding rule 1, fences the tenant and the
-- attendance module explicitly -- but it does NOT check is_hr(). Derivation is meant to be an
-- HR-triggered or scheduled operation, not something any employee can invoke to rewrite their
-- own attendance history. The actual HR-facing entry point (`hr_run_attendance_derivation`,
-- with its own authorization) is Phase 3's job. Granting broad EXECUTE here, before that
-- wrapper's is_hr() check exists, would let any authenticated employee call this function
-- directly via PostgREST RPC and rewrite attendance rows for their own tenant. So: no GRANT to
-- authenticated. Callable today only by the function owner (project_admin) -- i.e. from a
-- migration, `db query`, or a future service-role/definer wrapper -- which matches "no
-- frontend work this phase".
--
-- ============================================================================
-- WHY Pass 1 NEVER TOUCHES punch_in / punch_out
-- ============================================================================
-- `attendance` carries a dual-write trigger (20260821220000) that fires AFTER INSERT, and
-- AFTER UPDATE OF punch_out, re-emitting events from the attendance row. If Pass 1's own
-- upsert set punch_in/punch_out, every derived row would loop straight back through that
-- trigger. It doesn't, because Pass 1 deliberately never sets or updates either column --
-- consistent with decision doc §5.2's own note that "punch_in/punch_out stay as the
-- app-session view" while `in_time`/`out_time` (new, below) are the derived values. The
-- trigger's INSERT branch requires NEW.punch_in IS NOT NULL (false for every Pass-1 row); its
-- UPDATE branch only fires when punch_out is named in the SET list (never is, here). No
-- circularity, verified by construction rather than by a runtime guard.

-- ============================================================================
-- A. §5.2 columns on `attendance`
-- ============================================================================
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS derivation_source text,
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_entry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_exit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_time timestamptz,
  ADD COLUMN IF NOT EXISTS out_time timestamptz,
  ADD COLUMN IF NOT EXISTS leave_id uuid REFERENCES public.leaves(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS policy_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS business_date_tz text,
  ADD COLUMN IF NOT EXISTS derived_at timestamptz,
  ADD COLUMN IF NOT EXISTS derivation_version integer;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_derivation_source_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_derivation_source_check
  CHECK (derivation_source IS NULL OR derivation_source = ANY (ARRAY['derived', 'manual', 'correction', 'import', 'leave']));

-- is_late (pre-existing, untouched) is the OLD cutoff-time lateness model; late_entry (new,
-- above) is the D6 hours/grace-based model Pass 1 writes. Both models are live side by side
-- until B7 cuts the SPA over to derived rows -- see the same note already left on
-- late_mark_grace_override in 20260824100000. Do not merge them here.
COMMENT ON COLUMN public.attendance.is_late IS
'Legacy cutoff-time lateness flag, unrelated to the new late_entry column (D6, hours/grace-period based, written by attendance_derive_pass1). Both models coexist until B7 cuts the SPA over to derived rows -- see 20260824100000''s note above late_mark_grace_override. Do not merge or delete either column here.';

-- ============================================================================
-- B. attendance_derivation_runs (§5.5) -- one row per processor run, so a job that silently
--    stops (C4 / E43) is visible instead of inferred from an absence of new attendance rows.
--    RLS ships in this same migration (D10).
-- ============================================================================
CREATE TABLE public.attendance_derivation_runs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  shift_id          uuid references public.shifts(id) on delete set null,
  from_date         date not null,
  to_date           date not null,
  trigger           text not null default 'manual',
  events_processed  integer not null default 0,
  rows_created      integer not null default 0,
  rows_updated      integer not null default 0,
  rows_skipped      integer not null default 0,
  error_count       integer not null default 0,
  error_detail      jsonb,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running',

  CONSTRAINT attendance_derivation_runs_trigger_check CHECK (trigger = ANY (ARRAY['schedule', 'manual', 'replay'])),
  CONSTRAINT attendance_derivation_runs_status_check CHECK (status = ANY (ARRAY['running', 'completed', 'failed']))
);

CREATE INDEX idx_attendance_derivation_runs_tenant_id ON public.attendance_derivation_runs (tenant_id);
CREATE INDEX idx_attendance_derivation_runs_shift_id ON public.attendance_derivation_runs (shift_id);

-- RLS -- the same five-policy shape as holiday_calendars (20260824110000), gated on
-- `attendance` (not `work_calendar`): this table is the attendance processor's own log, not
-- calendar infrastructure.
ALTER TABLE public.attendance_derivation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_derivation_runs_all_read ON public.attendance_derivation_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY attendance_derivation_runs_hr_write ON public.attendance_derivation_runs
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_hr()))
  WITH CHECK ((SELECT public.is_hr()));

CREATE POLICY module_enabled_attendance ON public.attendance_derivation_runs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.tenant_has_module('attendance')))
  WITH CHECK ((SELECT public.tenant_has_module('attendance')));

CREATE POLICY tenant_active_restrictive ON public.attendance_derivation_runs
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(attendance_derivation_runs.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(attendance_derivation_runs.tenant_id)));

CREATE POLICY tenant_isolation ON public.attendance_derivation_runs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

-- ============================================================================
-- C. attendance_calculate_working_hours -- the §2.4 2x2 matrix
-- ============================================================================
-- Pure function: no table access, no SECURITY DEFINER, deterministic on its inputs. Takes the
-- ordered punch stream for ONE (employee, shift_start) group as a jsonb array of
-- {"event_time": <timestamptz-ish text>, "direction": "in"|"out"|null} objects (any input
-- order -- sorted internally) plus the two D7 mode strings, and returns the computed hours,
-- the derived in/out instants, and a flags object surfacing punch-log anomalies (E11, E13) for
-- Pass 2 and HR to see later.
--
-- THE FOUR CELLS
--   alternating   + first_last  : last.time - first.time, ignoring direction and pairing
--                                  entirely.
--   alternating   + every_pair  : sum over consecutive pairs (1,2),(3,4),... by POSITION,
--                                  ignoring direction (D7 -- cheap devices don't report it).
--   strict_log_type + every_pair: walk the log; each valid in->out closes a pair and is
--                                  summed. A second IN before a matching OUT is a duplicate
--                                  and is ignored, keeping the earlier IN open (E13). A stray
--                                  OUT with no open IN is likewise ignored.
--   strict_log_type + first_last: the walk above still runs (so its flags fire), but hours are
--                                  the literal "first IN -> last OUT" (earliest in-direction
--                                  event to latest out-direction event), per §2.4 -- pairing
--                                  validity does not affect this cell's calculation, only its
--                                  flags.
--
-- An odd-length punch stream under `alternating` always sets flags.odd_punch_count (both calc
-- modes -- it is a data-quality signal regardless of whether anything is numerically dropped).
-- Only `every_pair` actually excludes the trailing unpaired punch from the sum, which is when
-- flags.unpaired_punch_ignored_at additionally records its timestamp (E11).
CREATE OR REPLACE FUNCTION public.attendance_calculate_working_hours(
  p_events jsonb,
  p_determine_check_in_and_check_out text,
  p_working_hours_calculation_based_on text
)
 RETURNS TABLE (
   hours    numeric,
   in_time  timestamptz,
   out_time timestamptz,
   flags    jsonb
 )
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_times timestamptz[];
  v_dirs  text[];
  v_n     integer;
  i       integer;
  v_hours numeric := 0;
  v_in    timestamptz;
  v_out   timestamptz;
  v_flags jsonb := '{}'::jsonb;
  -- strict_log_type walk state
  v_state            text := 'seek_in';
  v_cur_in           timestamptz;
  v_first_in         timestamptz;
  v_last_out         timestamptz;
  v_dup_in_count     integer := 0;
  v_stray_out_count  integer := 0;
BEGIN
  IF p_determine_check_in_and_check_out NOT IN ('alternating', 'strict_log_type') THEN
    RAISE EXCEPTION 'invalid determine_check_in_and_check_out: %', p_determine_check_in_and_check_out;
  END IF;
  IF p_working_hours_calculation_based_on NOT IN ('first_last', 'every_pair') THEN
    RAISE EXCEPTION 'invalid working_hours_calculation_based_on: %', p_working_hours_calculation_based_on;
  END IF;

  SELECT array_agg((e->>'event_time')::timestamptz ORDER BY (e->>'event_time')::timestamptz),
         array_agg(e->>'direction'                 ORDER BY (e->>'event_time')::timestamptz)
    INTO v_times, v_dirs
  FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb)) e;

  v_n := COALESCE(array_length(v_times, 1), 0);

  IF v_n = 0 THEN
    RETURN QUERY SELECT 0::numeric, NULL::timestamptz, NULL::timestamptz, jsonb_build_object('no_events', true);
    RETURN;
  END IF;

  IF p_determine_check_in_and_check_out = 'alternating' THEN
    IF v_n % 2 <> 0 THEN
      v_flags := v_flags || jsonb_build_object('odd_punch_count', true);
    END IF;

    IF p_working_hours_calculation_based_on = 'first_last' THEN
      v_in    := v_times[1];
      v_out   := v_times[v_n];
      v_hours := GREATEST(EXTRACT(EPOCH FROM (v_out - v_in)) / 3600, 0);
    ELSE -- every_pair: sum consecutive pairs by position, direction ignored entirely
      v_in := v_times[1];
      i := 1;
      WHILE i + 1 <= v_n LOOP
        v_hours := v_hours + GREATEST(EXTRACT(EPOCH FROM (v_times[i + 1] - v_times[i])) / 3600, 0);
        v_out := v_times[i + 1];
        i := i + 2;
      END LOOP;
      IF v_n % 2 <> 0 THEN
        v_flags := v_flags || jsonb_build_object('unpaired_punch_ignored_at', to_jsonb(v_times[v_n]));
        IF v_n = 1 THEN
          v_out := NULL; -- the single punch was entirely unpaired; nothing was ever closed
        END IF;
      END IF;
    END IF;

  ELSE -- strict_log_type: walk the log per §2.4
    FOR i IN 1 .. v_n LOOP
      IF v_dirs[i] = 'in' THEN
        IF v_first_in IS NULL THEN
          v_first_in := v_times[i];
        END IF;
        IF v_state = 'seek_in' THEN
          v_cur_in := v_times[i];
          v_state  := 'seek_out';
        ELSE
          v_dup_in_count := v_dup_in_count + 1; -- E13: second IN in a row, ignored
        END IF;
      ELSIF v_dirs[i] = 'out' THEN
        IF v_state = 'seek_out' THEN
          v_hours    := v_hours + GREATEST(EXTRACT(EPOCH FROM (v_times[i] - v_cur_in)) / 3600, 0);
          v_last_out := v_times[i];
          v_state    := 'seek_in';
          v_cur_in   := NULL;
        ELSE
          v_stray_out_count := v_stray_out_count + 1; -- OUT with no open IN, ignored
        END IF;
      ELSE
        v_flags := v_flags || jsonb_build_object('null_direction_ignored', true);
      END IF;
    END LOOP;

    IF v_dup_in_count > 0 THEN
      v_flags := v_flags || jsonb_build_object('duplicate_in_ignored_count', v_dup_in_count);
    END IF;
    IF v_stray_out_count > 0 THEN
      v_flags := v_flags || jsonb_build_object('stray_out_ignored_count', v_stray_out_count);
    END IF;

    IF p_working_hours_calculation_based_on = 'every_pair' THEN
      v_in  := v_first_in;
      v_out := v_last_out;
      -- v_hours already accumulated by the walk above
    ELSE -- first_last: earliest IN -> latest OUT, regardless of pairing validity
      SELECT min(v_times[k]) FILTER (WHERE v_dirs[k] = 'in'),
             max(v_times[k]) FILTER (WHERE v_dirs[k] = 'out')
        INTO v_in, v_out
      FROM generate_series(1, v_n) AS k;

      IF v_in IS NOT NULL AND v_out IS NOT NULL AND v_out > v_in THEN
        v_hours := EXTRACT(EPOCH FROM (v_out - v_in)) / 3600;
      ELSE
        v_hours := 0;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT COALESCE(v_hours, 0), v_in, v_out, v_flags;
END;
$function$;

COMMENT ON FUNCTION public.attendance_calculate_working_hours(jsonb, text, text) IS
'The §2.4 2x2 working-hours matrix (determine_check_in_and_check_out x working_hours_calculation_based_on, D7). Pure/deterministic: no table access. p_events is a jsonb array of {event_time, direction} for one (employee, shift_start) group, any order. flags surfaces punch-log anomalies (odd_punch_count / unpaired_punch_ignored_at for E11, duplicate_in_ignored_count / stray_out_ignored_count for E13-style walks) for Pass 2 and HR.';

REVOKE EXECUTE ON FUNCTION public.attendance_calculate_working_hours(jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attendance_calculate_working_hours(jsonb, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.attendance_calculate_working_hours(jsonb, text, text) TO authenticated;

-- ============================================================================
-- D. attendance_derive_pass1 -- events -> present / half_day / absent / on_leave
-- ============================================================================
-- SECURITY DEFINER: reads shifts, employee_shifts (via attendance_resolve_shift/ingest,
-- already resolved onto the events), holidays/holiday_calendar_days (via work_calendar_holiday),
-- leaves, and attendance_events; writes attendance and attendance_derivation_runs. Per binding
-- rule 1, definer bypasses all 34 module_enabled_* RESTRICTIVE policies and every tenant fence
-- by table ownership, so both are restored explicitly below: can_access_tenant(p_tenant_id)
-- with the auth.uid() IS NULL arm (so this stays callable from a migration/cron/service-role
-- context, matching work_calendar_working_days), and tenant_has_module_for(p_tenant_id,
-- 'attendance') for the one module-gated seam this function touches (work_calendar is core,
-- see 20260824110000, so no separate gate is needed for the holiday resolver).
--
-- p_shift_id is REQUIRED, not an "all shifts" wildcard: thresholds, D7 modes and grace periods
-- all live on one shift row, and the decision doc's own §6 pseudocode signature
-- (`derive_attendance(tenant_id, shift_id, ...)`) is per-shift, matching Frappe's
-- shift_type.process_auto_attendance() running on one Shift Type doc at a time. Call once per
-- shift to cover a tenant.
--
-- GROUPING IS BY (employee_id, shift_start), NEVER BY CALENDAR DATE -- this is the entire
-- night-shift solution (§2.2): a 22:00 punch and the 02:00-next-day punch that closes it were
-- already stamped with the SAME shift_start by attendance_resolve_shift at ingest, so they
-- collapse into one group here regardless of which calendar date each event_time falls on.
--
-- Advisory lock per (tenant, shift) (E42): pg_advisory_xact_lock is scoped to the CURRENT
-- transaction and released automatically at commit/rollback, so a crash mid-run (E41) never
-- leaves a stale lock. Two concurrent calls for the same (tenant, shift) serialize; unrelated
-- shifts/tenants proceed independently (hashtext on each half of the key separately, not the
-- concatenation, so no cross-tenant hash collision risk beyond an ordinary 32-bit collision on
-- BOTH halves at once).
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

    -- D8: approved leave overrides the derived status. Half-day leave (E23) is not
    -- representable in the current schema -- see the header deviation note.
    v_leave_id := NULL;
    SELECT l.id INTO v_leave_id
    FROM public.leaves l
    WHERE l.tenant_id = p_tenant_id
      AND l.employee_id = v_group.employee_id
      AND l.status = 'approved'
      AND v_local_date BETWEEN l.start_date AND l.end_date
    ORDER BY l.start_date DESC
    LIMIT 1;

    IF v_leave_id IS NOT NULL THEN
      v_status := 'on_leave';
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
      INSERT INTO public.attendance (
        tenant_id, employee_id, date, shift_id, status, derivation_source,
        late_entry, early_exit, in_time, out_time, work_hours, leave_id,
        shift_snapshot, policy_snapshot, business_date_tz, derived_at, derivation_version,
        session_status
      ) VALUES (
        p_tenant_id, v_group.employee_id, v_local_date, p_shift_id, v_status, 'derived',
        v_late_entry, v_early_exit, v_calc.in_time, v_calc.out_time, v_calc.hours, v_leave_id,
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
  -- table column -- caught by this migration's own apply attempt (Postgres error 42702).
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
'B6 Pass 1 (decision doc §6): groups unprocessed attendance_events by (employee_id, shift_start) -- never by calendar date, which is the night-shift solution (§2.2) -- computes hours via attendance_calculate_working_hours, derives present/half_day/absent by D6 ordering (absent threshold first, thresholds halved on a half-day holiday), lets an approved leave override to on_leave (D8, full-day only -- see this migration''s header on E23), upserts attendance skipping is_locked rows (D5), and stamps attendance_id onto every event in the group. Advisory-locked per (tenant, shift) (E42). Caller must INSERT the attendance_derivation_runs row identified by p_run_id first; this function only updates it. Pass 2 (completeness/absent-marking over assigned employees, watermarks) is Phase 3 and is not implemented here. Not granted to authenticated in this phase -- see header deviation 3.';

REVOKE EXECUTE ON FUNCTION public.attendance_derive_pass1(uuid, uuid, date, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attendance_derive_pass1(uuid, uuid, date, date, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.attendance_derive_pass1(uuid, uuid, date, date, uuid) FROM authenticated;

-- ============================================================================
-- E. Assertions -- each proves its own claim by doing the thing, per the Phase 0a lesson
-- (PL/pgSQL plans each statement on first execution of THAT statement). attendance_events has
-- 0 live rows, so every probe below manufactures its own events. Each top-level DO block wraps
-- its writes in a nested BEGIN/EXCEPTION ending in a private sentinel SQLSTATE ('ZZ001'),
-- caught by that same block -- Postgres's implicit per-EXCEPTION-block savepoint rolls back
-- exactly the probe's own writes. Any OTHER error propagates out of the DO block and aborts
-- this migration's transaction: an honest assertion failure means nothing in this file applies.
-- ============================================================================

-- --------------------------------------------------------------------
-- E1. Columns and table shape exist (cheap sanity check before the behavioural probes).
-- --------------------------------------------------------------------
DO $shape_check$
DECLARE
  v_missing_cols text;
  v_missing_pol  text;
BEGIN
  SELECT string_agg(missing_col, ', ') INTO v_missing_cols
  FROM (
    SELECT unnest(ARRAY[
      'derivation_source', 'is_locked', 'late_entry', 'early_exit', 'in_time', 'out_time',
      'leave_id', 'shift_snapshot', 'policy_snapshot', 'business_date_tz', 'derived_at',
      'derivation_version'
    ]) AS missing_col
    EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance'
  ) x;
  IF v_missing_cols IS NOT NULL THEN
    RAISE EXCEPTION 'E1 FAILED: attendance missing columns: %', v_missing_cols;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.attendance_derivation_runs'::regclass) THEN
    RAISE EXCEPTION 'E1 FAILED: attendance_derivation_runs does not have RLS enabled';
  END IF;

  SELECT string_agg(missing_policy, ', ') INTO v_missing_pol
  FROM (
    SELECT unnest(ARRAY[
      'attendance_derivation_runs_all_read', 'attendance_derivation_runs_hr_write',
      'module_enabled_attendance', 'tenant_active_restrictive', 'tenant_isolation'
    ]) AS missing_policy
    EXCEPT
    SELECT polname FROM pg_policy WHERE polrelid = 'public.attendance_derivation_runs'::regclass
  ) x;
  IF v_missing_pol IS NOT NULL THEN
    RAISE EXCEPTION 'E1 FAILED: attendance_derivation_runs missing policies: %', v_missing_pol;
  END IF;

  RAISE NOTICE 'E1 verified: all 12 §5.2 columns exist on attendance; attendance_derivation_runs has RLS + all 5 policies';
END
$shape_check$;

-- --------------------------------------------------------------------
-- E2. attendance_calculate_working_hours -- pure-function matrix probes. No table writes, so
-- no rollback machinery is needed: a failed assertion just RAISEs directly.
-- --------------------------------------------------------------------
DO $calc_check$
DECLARE
  v_r record;
BEGIN
  -- alternating + first_last: hours = last - first.
  SELECT * INTO v_r FROM public.attendance_calculate_working_hours(
    '[{"event_time":"2026-01-01T09:00:00+05:30","direction":null},{"event_time":"2026-01-01T18:00:00+05:30","direction":null}]'::jsonb,
    'alternating', 'first_last'
  );
  IF v_r.hours <> 9 OR v_r.in_time <> '2026-01-01T09:00:00+05:30'::timestamptz OR v_r.out_time <> '2026-01-01T18:00:00+05:30'::timestamptz THEN
    RAISE EXCEPTION 'E2a FAILED (alternating/first_last): hours=%, in=%, out=%', v_r.hours, v_r.in_time, v_r.out_time;
  END IF;
  RAISE NOTICE 'E2a verified: alternating + first_last hours = last - first = 9';

  -- alternating + every_pair, E14 (unpaid-lunch case): 09-13 and 14-18 sum to 8, excluding
  -- the 13-14 lunch gap entirely.
  SELECT * INTO v_r FROM public.attendance_calculate_working_hours(
    '[{"event_time":"2026-01-01T09:00:00+05:30","direction":null},
      {"event_time":"2026-01-01T13:00:00+05:30","direction":null},
      {"event_time":"2026-01-01T14:00:00+05:30","direction":null},
      {"event_time":"2026-01-01T18:00:00+05:30","direction":null}]'::jsonb,
    'alternating', 'every_pair'
  );
  IF v_r.hours <> 8 THEN
    RAISE EXCEPTION 'E2b FAILED (E14, every_pair sums pairs): expected 8, got %', v_r.hours;
  END IF;
  RAISE NOTICE 'E2b verified: alternating + every_pair sums multiple pairs (E14) = 8 (4h + 4h, unpaid lunch excluded)';

  -- alternating + every_pair, E11: odd count (3 punches) -> last punch ignored for hours, flagged.
  SELECT * INTO v_r FROM public.attendance_calculate_working_hours(
    '[{"event_time":"2026-01-01T09:00:00+05:30","direction":null},
      {"event_time":"2026-01-01T13:00:00+05:30","direction":null},
      {"event_time":"2026-01-01T14:00:00+05:30","direction":null}]'::jsonb,
    'alternating', 'every_pair'
  );
  IF v_r.hours <> 4
     OR (v_r.flags->>'odd_punch_count')::boolean IS NOT TRUE
     OR v_r.flags->>'unpaired_punch_ignored_at' IS NULL THEN
    RAISE EXCEPTION 'E2c FAILED (E11, odd punch count): hours=%, flags=%', v_r.hours, v_r.flags;
  END IF;
  RAISE NOTICE 'E2c verified (E11): odd punch count -> hours=4 (3rd punch ignored), flags=%', v_r.flags;

  -- strict_log_type + every_pair, E13: a duplicate IN in a row is ignored (second IN dropped,
  -- earlier IN stays open), flagged.
  SELECT * INTO v_r FROM public.attendance_calculate_working_hours(
    '[{"event_time":"2026-01-01T09:00:00+05:30","direction":"in"},
      {"event_time":"2026-01-01T09:05:00+05:30","direction":"in"},
      {"event_time":"2026-01-01T17:00:00+05:30","direction":"out"}]'::jsonb,
    'strict_log_type', 'every_pair'
  );
  IF v_r.hours <> 8 OR (v_r.flags->>'duplicate_in_ignored_count')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'E2d FAILED (E13, duplicate IN ignored): hours=%, flags=%', v_r.hours, v_r.flags;
  END IF;
  RAISE NOTICE 'E2d verified (E13): duplicate IN ignored per the walk -> hours=8 (09:00-17:00), flags=%', v_r.flags;
END
$calc_check$;

-- --------------------------------------------------------------------
-- E3. THE single most important test: a night shift's 22:00 + next-day-02:00 punches produce
-- ONE attendance row dated the shift's own start date (E1/E2). Same block also proves
-- idempotency (D5, a second Pass 1 call over the same window is a pure no-op) and that
-- attendance_derivation_runs records correct counts for BOTH calls (§5.5) -- all against the
-- one real assigned cross-midnight shift in this database (same assignment 20260821230000's
-- own probe used).
-- --------------------------------------------------------------------
DO $night_check$
DECLARE
  v_tenant       uuid;
  v_employee     uuid;
  v_shift        uuid;
  v_from         date;
  v_ev1          uuid;
  v_ev2          uuid;
  v_run1         uuid := gen_random_uuid();
  v_run2         uuid := gen_random_uuid();
  v_result       record;
  v_att_id       uuid;
  v_att_date     date;
  v_derived_at_1 timestamptz;
  v_version_1    integer;
  v_derived_at_2 timestamptz;
  v_version_2    integer;
  v_row_count    integer;
  v_stamped      integer;
BEGIN
  SELECT es.tenant_id, es.employee_id, s.id, es.effective_from
    INTO v_tenant, v_employee, v_shift, v_from
  FROM public.employee_shifts es
  JOIN public.shifts s ON s.id = es.shift_id
  WHERE s.end_time < s.start_time
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'E3 probe setup failed: expected the assigned cross-midnight shift 20260821230000''s own probe used to still exist -- investigate';
  END IF;

  BEGIN
    -- 22:00 the first evening and 02:00 the following morning, both within the single-day
    -- assignment's actual (margin-widened) window -- see 20260821230000's own probe for why.
    v_ev1 := public.attendance_event_ingest(
      v_tenant, v_employee, (v_from::timestamp + TIME '22:00:00') AT TIME ZONE 'Asia/Kolkata',
      NULL, 'device', 'E3-probe-in'
    );
    v_ev2 := public.attendance_event_ingest(
      v_tenant, v_employee, ((v_from + 1)::timestamp + TIME '02:00:00') AT TIME ZONE 'Asia/Kolkata',
      NULL, 'device', 'E3-probe-out'
    );

    IF v_ev1 IS NULL OR v_ev2 IS NULL THEN
      RAISE EXCEPTION 'E3 probe setup failed: attendance_event_ingest returned NULL (unexpected duplicate?)';
    END IF;

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run1, v_tenant, v_shift, v_from, v_from + 1, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_from, v_from + 1, v_run1);

    IF v_result.groups_processed <> 1 OR v_result.rows_created <> 1 OR v_result.rows_updated <> 0
       OR v_result.rows_skipped <> 0 OR v_result.events_processed <> 2 THEN
      RAISE EXCEPTION 'E3 FAILED: unexpected first-run counts: %', v_result;
    END IF;

    -- E1/E2: exactly one attendance row, dated the shift's OWN start date (v_from), not the
    -- calendar date either punch actually fell on.
    SELECT count(*) INTO v_row_count
    FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_from;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'E3 (E1/E2) FAILED: expected exactly 1 attendance row dated %, found %', v_from, v_row_count;
    END IF;

    SELECT id, date, derived_at, derivation_version INTO v_att_id, v_att_date, v_derived_at_1, v_version_1
    FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_from;

    RAISE NOTICE 'E3 (E1/E2) verified: night-shift punches at 22:00 and next-day 02:00 produced ONE attendance row, id=%, date=% (shift start date, not either punch''s own calendar date)', v_att_id, v_att_date;

    -- Both events stamped with THIS row's id -- the one permitted mutation of the log (D11).
    SELECT count(*) INTO v_stamped
    FROM public.attendance_events WHERE id IN (v_ev1, v_ev2) AND attendance_id = v_att_id;
    IF v_stamped <> 2 THEN
      RAISE EXCEPTION 'E3 FAILED: expected both probe events stamped with attendance_id %, got % stamped', v_att_id, v_stamped;
    END IF;
    RAISE NOTICE 'E3 verified: both events stamped attendance_id = %', v_att_id;

    -- attendance_derivation_runs row 1: correct counts, status completed.
    PERFORM 1 FROM public.attendance_derivation_runs
    WHERE id = v_run1 AND status = 'completed' AND finished_at IS NOT NULL
      AND rows_created = 1 AND rows_updated = 0 AND rows_skipped = 0 AND events_processed = 2;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E3 FAILED: attendance_derivation_runs row % does not have the expected first-run counts', v_run1;
    END IF;
    RAISE NOTICE 'E3 verified: attendance_derivation_runs row % has correct counts (created=1, updated=0, skipped=0, events=2, status=completed)', v_run1;

    -- D5 idempotency: re-run over the SAME window. The events are already stamped
    -- (attendance_id IS NULL is the queue filter), so the second call must find ZERO groups
    -- and touch NOTHING -- the strongest possible proof that re-running converges rather than
    -- duplicating or re-deriving.
    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run2, v_tenant, v_shift, v_from, v_from + 1, 'replay', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_from, v_from + 1, v_run2);

    IF v_result.groups_processed <> 0 OR v_result.rows_created <> 0 OR v_result.rows_updated <> 0
       OR v_result.rows_skipped <> 0 OR v_result.events_processed <> 0 THEN
      RAISE EXCEPTION 'D5 IDEMPOTENCY FAILED: second run over the same window did work: %', v_result;
    END IF;

    SELECT derived_at, derivation_version INTO v_derived_at_2, v_version_2
    FROM public.attendance WHERE id = v_att_id;

    IF v_derived_at_2 IS DISTINCT FROM v_derived_at_1 OR v_version_2 IS DISTINCT FROM v_version_1 THEN
      RAISE EXCEPTION 'D5 IDEMPOTENCY FAILED: attendance row % was touched by the second run (derived_at % -> %, version % -> %)',
        v_att_id, v_derived_at_1, v_derived_at_2, v_version_1, v_version_2;
    END IF;

    PERFORM 1 FROM public.attendance_derivation_runs
    WHERE id = v_run2 AND status = 'completed' AND finished_at IS NOT NULL
      AND rows_created = 0 AND rows_updated = 0 AND rows_skipped = 0 AND events_processed = 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E3 FAILED: attendance_derivation_runs row % (replay) does not have the expected all-zero counts', v_run2;
    END IF;

    RAISE NOTICE 'D5 idempotency verified: re-running over the same window did zero work (row %, still derivation_version=%, derived_at unchanged); run row % recorded the no-op correctly', v_att_id, v_version_1, v_run2;

    RAISE EXCEPTION 'E3 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'E3 probe writes rolled back (2 events, 1 attendance row, 2 derivation_runs rows)';
  END;
END
$night_check$;

-- --------------------------------------------------------------------
-- E4. Status ordering (D6, absent-threshold-first), half-day-holiday threshold halving (§2.2),
-- and late-but-full-hours (D6: independent flag, not a status) -- all against the QA
-- Attendance Only fixture (module-independence: this tenant has ONLY attendance + core
-- modules enabled), with the shift's thresholds temporarily overridden inside the same
-- rolled-back probe.
-- --------------------------------------------------------------------
DO $threshold_check$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_shift    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee uuid := '11111111-1111-4111-8111-000000000011';
  v_date_e19 date := DATE '2099-03-02'; -- plain day, 3h worked, thresholds 2/4 -> half_day
  v_date_e20 date := DATE '2099-03-03'; -- half-day holiday, thresholds halved to 1/2, 3h -> present
  v_date_e21 date := DATE '2099-03-04'; -- late (15m > 10m grace) but 8h45m worked -> present + late_entry
  v_run      uuid := gen_random_uuid();
  v_result   record;
  v_row      record;
BEGIN
  BEGIN
    -- mark_attendance_on_holidays must be true for E20 to reach the halving logic at all: per
    -- the decision doc's own §2.2 pseudocode, the holiday skip ("if holiday and not
    -- mark_auto_attendance_on_holidays: skip") fires for BOTH full and half-day holidays --
    -- the halving line is only ever reached for a survivor of that skip. Does not affect
    -- e19/e21 below (neither date is a holiday at all, so the skip condition is false for them
    -- regardless of this flag).
    UPDATE public.shifts
    SET working_hours_threshold_for_absent = 2, working_hours_threshold_for_half_day = 4,
        mark_attendance_on_holidays = true
    WHERE id = v_shift;

    INSERT INTO public.holidays (tenant_id, name, date, type, is_half_day)
    VALUES (v_tenant, 'E4 probe half-day holiday (rolled back)', v_date_e20, 'company', true);

    PERFORM public.attendance_event_ingest(v_tenant, v_employee, (v_date_e19::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E19-in');
    PERFORM public.attendance_event_ingest(v_tenant, v_employee, (v_date_e19::timestamp + TIME '12:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E19-out');

    PERFORM public.attendance_event_ingest(v_tenant, v_employee, (v_date_e20::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E20-in');
    PERFORM public.attendance_event_ingest(v_tenant, v_employee, (v_date_e20::timestamp + TIME '12:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E20-out');

    PERFORM public.attendance_event_ingest(v_tenant, v_employee, (v_date_e21::timestamp + TIME '09:15:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E21-in');
    PERFORM public.attendance_event_ingest(v_tenant, v_employee, (v_date_e21::timestamp + TIME '18:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E21-out');

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run, v_tenant, v_shift, v_date_e19, v_date_e21, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_date_e19, v_date_e21, v_run);
    IF v_result.groups_processed <> 3 OR v_result.rows_created <> 3 THEN
      RAISE EXCEPTION 'E4 FAILED: expected 3 groups / 3 rows created, got %', v_result;
    END IF;

    SELECT status, work_hours INTO v_row FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date_e19;
    IF v_row.status <> 'half_day' OR v_row.work_hours <> 3 THEN
      RAISE EXCEPTION 'E19 FAILED: expected half_day/3h (absent_threshold=2 checked first, 3 >= 2 so not absent; 3 < 4 so half_day), got status=%, hours=%', v_row.status, v_row.work_hours;
    END IF;
    RAISE NOTICE 'E19 verified: 3h worked against thresholds absent=2/half_day=4 (absent checked first, D6) -> half_day';

    SELECT status, work_hours INTO v_row FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date_e20;
    IF v_row.status <> 'present' OR v_row.work_hours <> 3 THEN
      RAISE EXCEPTION 'E20 FAILED: expected present/3h (half-day holiday halves thresholds to absent=1/half_day=2; 3 >= 2 -> present), got status=%, hours=%', v_row.status, v_row.work_hours;
    END IF;
    RAISE NOTICE 'E20 verified: same 3h worked, but on a half-day holiday -> thresholds halved (1/2) -> present (§2.2)';

    SELECT status, work_hours, late_entry INTO v_row FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date_e21;
    IF v_row.status <> 'present' OR v_row.late_entry IS NOT TRUE THEN
      RAISE EXCEPTION 'E21 FAILED: expected present AND late_entry=true (D6: independent flag, not a status), got status=%, late_entry=%, hours=%', v_row.status, v_row.late_entry, v_row.work_hours;
    END IF;
    RAISE NOTICE 'E21 verified: arrived 15min late (> 10min grace) but worked % hours -> present AND late_entry=true (D6: flag, not a status)', v_row.work_hours;

    RAISE EXCEPTION 'E4 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'E4 probe writes rolled back (shift thresholds, holiday row, 6 events, 3 attendance rows, 1 run row)';
  END;
END
$threshold_check$;

-- --------------------------------------------------------------------
-- E5 (E22). Approved leave overrides the derived status to on_leave, leave_id is set, and the
-- punch events on that day are retained as evidence (D8) -- stamped onto the on_leave row,
-- not discarded or left dangling.
-- --------------------------------------------------------------------
DO $leave_check$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_shift    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee uuid := '11111111-1111-4111-8111-000000000012';
  v_date     date := DATE '2099-05-11';
  v_leave_id uuid;
  v_ev1      uuid;
  v_ev2      uuid;
  v_run      uuid := gen_random_uuid();
  v_result   record;
  v_row      record;
BEGIN
  BEGIN
    INSERT INTO public.leaves (tenant_id, employee_id, leave_type, start_date, end_date, total_days, reason, status)
    VALUES (v_tenant, v_employee, 'casual', v_date, v_date, 1, 'E22 probe leave (rolled back)', 'approved')
    RETURNING id INTO v_leave_id;

    v_ev1 := public.attendance_event_ingest(v_tenant, v_employee, (v_date::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E22-in');
    v_ev2 := public.attendance_event_ingest(v_tenant, v_employee, (v_date::timestamp + TIME '12:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E22-out');

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run, v_tenant, v_shift, v_date, v_date, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_date, v_date, v_run);
    IF v_result.rows_created <> 1 THEN
      RAISE EXCEPTION 'E22 FAILED: expected 1 row created, got %', v_result;
    END IF;

    SELECT status, leave_id INTO v_row FROM public.attendance
    WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date;

    IF v_row.status <> 'on_leave' OR v_row.leave_id IS DISTINCT FROM v_leave_id THEN
      RAISE EXCEPTION 'E22 FAILED: expected on_leave with leave_id=%, got status=%, leave_id=%', v_leave_id, v_row.status, v_row.leave_id;
    END IF;

    PERFORM 1 FROM public.attendance_events
    WHERE id IN (v_ev1, v_ev2) AND attendance_id = (SELECT id FROM public.attendance WHERE tenant_id = v_tenant AND employee_id = v_employee AND shift_id = v_shift AND date = v_date)
    HAVING count(*) = 2;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E22 FAILED: punch events on the leave day were not retained/stamped as evidence';
    END IF;

    RAISE NOTICE 'E22 verified: approved leave overrides derived status -> on_leave, leave_id=% set, both punch events retained and stamped as evidence (D8)', v_leave_id;

    RAISE EXCEPTION 'E22 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'E22 probe writes rolled back (1 leave, 2 events, 1 attendance row, 1 run row)';
  END;
END
$leave_check$;

-- --------------------------------------------------------------------
-- E6 (D5). An is_locked attendance row is never overwritten by derivation, and its group's
-- events are left unstamped (still queued) rather than silently consumed.
-- --------------------------------------------------------------------
DO $locked_check$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_shift    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee uuid := '11111111-1111-4111-8111-000000000011';
  v_date     date := DATE '2099-06-08';
  v_locked_id uuid;
  v_ev        uuid;
  v_run       uuid := gen_random_uuid();
  v_result    record;
  v_row       record;
BEGIN
  BEGIN
    INSERT INTO public.attendance (
      tenant_id, employee_id, date, shift_id, status, derivation_source, work_hours,
      is_locked, session_status
    ) VALUES (
      v_tenant, v_employee, v_date, v_shift, 'present', 'manual', 99,
      true, 'closed'
    ) RETURNING id INTO v_locked_id;

    v_ev := public.attendance_event_ingest(v_tenant, v_employee, (v_date::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E-lock-in');

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run, v_tenant, v_shift, v_date, v_date, 'manual', 'running');

    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant, v_shift, v_date, v_date, v_run);
    IF v_result.rows_skipped <> 1 OR v_result.rows_created <> 0 OR v_result.rows_updated <> 0 THEN
      RAISE EXCEPTION 'D5 (is_locked) FAILED: expected 1 skipped / 0 created / 0 updated, got %', v_result;
    END IF;

    SELECT status, work_hours, derivation_source, is_locked INTO v_row
    FROM public.attendance WHERE id = v_locked_id;
    IF v_row.status <> 'present' OR v_row.work_hours <> 99 OR v_row.derivation_source <> 'manual' OR v_row.is_locked IS NOT TRUE THEN
      RAISE EXCEPTION 'D5 (is_locked) FAILED: locked row was modified: %', v_row;
    END IF;

    PERFORM 1 FROM public.attendance_events WHERE id = v_ev AND attendance_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'D5 (is_locked) FAILED: the locked group''s event was stamped despite the row being locked';
    END IF;

    RAISE NOTICE 'D5 verified: is_locked row untouched (status=present, work_hours=99, derivation_source=manual unchanged); its event was left unstamped and still queued';

    RAISE EXCEPTION 'E-lock probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'is_locked probe writes rolled back (1 attendance row, 1 event, 1 run row)';
  END;
END
$locked_check$;

-- --------------------------------------------------------------------
-- E7. Module independence: Pass 1 produces IDENTICAL derivation results for an employee under
-- QA Attendance Only (attendance + core modules ONLY -- no leave, no payroll) versus the same
-- shape of employee/events under QA Full Suite (every module on). Proves attendance derivation
-- reads nothing payroll- or leave-shaped beyond the leaves table itself (which both tenants
-- have core access to regardless -- work_calendar/holidays/leaves data existing is not the
-- same thing as the payroll or leave MODULE being enabled).
-- --------------------------------------------------------------------
DO $module_independence_check$
DECLARE
  v_tenant_a   uuid := '11111111-1111-4111-8111-000000000001'; -- QA Attendance Only
  v_shift_a    uuid := '11111111-1111-4111-8111-000000000004';
  v_employee_a uuid := '11111111-1111-4111-8111-000000000011';
  v_tenant_c   uuid := '33333333-3333-4333-8333-000000000001'; -- QA Full Suite
  v_shift_c    uuid := '33333333-3333-4333-8333-000000000004';
  v_employee_c uuid := '33333333-3333-4333-8333-000000000011';
  v_date       date := DATE '2099-04-10';
  v_run_a      uuid := gen_random_uuid();
  v_run_c      uuid := gen_random_uuid();
  v_result     record;
  v_row_a      record;
  v_row_c      record;
BEGIN
  BEGIN
    PERFORM public.attendance_event_ingest(v_tenant_a, v_employee_a, (v_date::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E7-a-in');
    PERFORM public.attendance_event_ingest(v_tenant_a, v_employee_a, (v_date::timestamp + TIME '18:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E7-a-out');

    PERFORM public.attendance_event_ingest(v_tenant_c, v_employee_c, (v_date::timestamp + TIME '09:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E7-c-in');
    PERFORM public.attendance_event_ingest(v_tenant_c, v_employee_c, (v_date::timestamp + TIME '18:00:00') AT TIME ZONE 'Asia/Kolkata', NULL, 'device', 'E7-c-out');

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run_a, v_tenant_a, v_shift_a, v_date, v_date, 'manual', 'running');
    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant_a, v_shift_a, v_date, v_date, v_run_a);
    IF v_result.rows_created <> 1 THEN
      RAISE EXCEPTION 'E7 FAILED (QA Attendance Only): expected 1 row created, got %', v_result;
    END IF;

    INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run_c, v_tenant_c, v_shift_c, v_date, v_date, 'manual', 'running');
    SELECT * INTO v_result FROM public.attendance_derive_pass1(v_tenant_c, v_shift_c, v_date, v_date, v_run_c);
    IF v_result.rows_created <> 1 THEN
      RAISE EXCEPTION 'E7 FAILED (QA Full Suite): expected 1 row created, got %', v_result;
    END IF;

    SELECT status, work_hours, late_entry, early_exit,
           (in_time AT TIME ZONE 'Asia/Kolkata') AS in_local, (out_time AT TIME ZONE 'Asia/Kolkata') AS out_local
    INTO v_row_a FROM public.attendance
    WHERE tenant_id = v_tenant_a AND employee_id = v_employee_a AND shift_id = v_shift_a AND date = v_date;

    SELECT status, work_hours, late_entry, early_exit,
           (in_time AT TIME ZONE 'Asia/Kolkata') AS in_local, (out_time AT TIME ZONE 'Asia/Kolkata') AS out_local
    INTO v_row_c FROM public.attendance
    WHERE tenant_id = v_tenant_c AND employee_id = v_employee_c AND shift_id = v_shift_c AND date = v_date;

    IF v_row_a.status IS DISTINCT FROM v_row_c.status
       OR v_row_a.work_hours IS DISTINCT FROM v_row_c.work_hours
       OR v_row_a.late_entry IS DISTINCT FROM v_row_c.late_entry
       OR v_row_a.early_exit IS DISTINCT FROM v_row_c.early_exit
       OR v_row_a.in_local IS DISTINCT FROM v_row_c.in_local
       OR v_row_a.out_local IS DISTINCT FROM v_row_c.out_local THEN
      RAISE EXCEPTION 'E7 FAILED: derivation diverged between module mixes. QA-A: %, QA-C: %', v_row_a, v_row_c;
    END IF;

    IF v_row_a.status <> 'present' OR v_row_a.work_hours <> 9 THEN
      RAISE EXCEPTION 'E7 FAILED: unexpected baseline result itself: %', v_row_a;
    END IF;

    RAISE NOTICE 'E7 verified: Pass 1 produced IDENTICAL results (status=%, hours=%, late_entry=%, early_exit=%) for QA Attendance Only and QA Full Suite from the same event pattern -- derivation does not depend on the leave/payroll module mix', v_row_a.status, v_row_a.work_hours, v_row_a.late_entry, v_row_a.early_exit;

    RAISE EXCEPTION 'E7 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'E7 probe writes rolled back (4 events, 2 attendance rows, 2 run rows)';
  END;
END
$module_independence_check$;

DO $final$
BEGIN
  RAISE NOTICE 'Phase 2 (B6 part 1, derivation Pass 1) assertions complete: E1 (shape), E2a-d (calculate_working_hours matrix incl. E11/E13/E14), E3 (E1/E2 night shift, D5 idempotency, derivation_runs counts), E4 (E19/E20/E21: D6 ordering, half-day-holiday halving, late-flag-not-status), E5 (E22 leave override + evidence retention), E6 (D5 is_locked), E7 (module independence) -- all verified.';
END
$final$;
