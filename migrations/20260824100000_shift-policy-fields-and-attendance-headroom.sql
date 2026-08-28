-- Phase 0 of the attendance completion plan (doc/attendance_completion_plan_2026-08-24.md).
-- Finishes B4 (decision doc §8): B4 shipped attendance_resolve_shift and the overlap
-- exclusion constraint (employee_shifts_no_overlap_excl) in 20260821230000, but left the
-- §5.3 policy carrier columns on `shifts` entirely absent. B6 (the derivation processor,
-- Phase 2-3) reads shift.process_attendance_after, shift.last_sync_of_events, both
-- working-hour thresholds and both D7 modes -- none of which exist yet. This migration adds
-- them, closes the two schema blockers that silently break Pass 1/Pass 2 derivation
-- (doc §1), and extends hr_save_shift + the frontend so HR can reach the new columns instead
-- of them being dead config.
--
-- Authority: `new update doc/attendance_shift_v2_decision_doc.md` -- §2.3 (status ordering),
-- §2.4 (the 2x2 working-hours matrix / D7), §5.3 (the exact column list), §7 E5 (circular
-- shift), §10 (rules for future agents).

-- ============================================================================
-- A1. shifts -- the §5.3 policy carrier
-- ============================================================================
-- `holiday_calendar_id` is deliberately NOT added here -- it references a table
-- (holiday_calendars) that does not exist until Phase 1 (doc plan, Phase 0 section,
-- final bullet). Adding a nullable FK to a nonexistent table is not possible anyway;
-- stated so the omission reads as planned, not missed.

ALTER TABLE public.shifts
  -- Both threshold columns default to 0, which in the §2.3 ordering
  -- (`hours < absent_threshold -> Absent`, `hours < half_day_threshold -> Half Day`)
  -- means neither comparison can ever be true for a non-negative hour count -- i.e. "never
  -- auto-mark absent/half-day by hours worked". This is Frappe's own default and it is the
  -- correct one here for a second reason beyond matching Frappe: these columns exist today
  -- but NOTHING reads them yet (B6, the derivation processor, is Phase 2-3). A nonzero
  -- default would be silently-armed policy on a live payroll-adjacent system with no code
  -- path to explain or audit what tripped it. 0 preserves today's behaviour exactly and
  -- makes the feature strictly opt-in, per shift, once B6 ships and HR chooses a value.
  ADD COLUMN IF NOT EXISTS working_hours_threshold_for_absent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS working_hours_threshold_for_half_day numeric NOT NULL DEFAULT 0,

  -- D7: real biometric devices (cheap ZKTeco units especially) do not reliably report
  -- IN vs OUT direction. `alternating` (pair consecutive punches by position, not by
  -- claimed direction) is what makes those devices usable, so it is the default rather
  -- than `strict_log_type` (§2.4).
  ADD COLUMN IF NOT EXISTS determine_check_in_and_check_out text NOT NULL DEFAULT 'alternating',
  ADD COLUMN IF NOT EXISTS working_hours_calculation_based_on text NOT NULL DEFAULT 'first_last',

  ADD COLUMN IF NOT EXISTS enable_late_entry_marking boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS late_entry_grace_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS enable_early_exit_marking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_exit_grace_minutes integer NOT NULL DEFAULT 10,

  ADD COLUMN IF NOT EXISTS enable_auto_derivation boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mark_attendance_on_holidays boolean NOT NULL DEFAULT false,

  -- The watermark pair (§2.7). Nullable and unset by design: process_attendance_after
  -- protects imported/legacy history from being clobbered by a replay, and
  -- last_sync_of_events is the safety interlock the derivation processor (B6) advances
  -- itself. Neither has a sensible default today because nothing writes or reads them yet;
  -- an HR-facing control for a watermark with no consuming processor would be a switch
  -- that does nothing, which is worse than no switch. Column added now so B6 does not need
  -- its own migration just to get storage; NOT exposed via hr_save_shift or the UI in this
  -- phase -- see the note above CREATE FUNCTION hr_save_shift below.
  ADD COLUMN IF NOT EXISTS process_attendance_after date,
  ADD COLUMN IF NOT EXISTS last_sync_of_events timestamptz,

  -- D1: per-tenant/per-shift punch source policy. All five sources allowed by default,
  -- i.e. a no-op relative to today (every source is accepted today because nothing enforces
  -- this column yet -- enforcement is B8, deferred per the plan).
  ADD COLUMN IF NOT EXISTS allowed_punch_sources text[] NOT NULL DEFAULT ARRAY['app','device','kiosk','manual','import'];

-- crosses_midnight uses `<=`, not the doc's `<` (§5.3 table), to match
-- attendance_resolve_shift's own cross-midnight branch in 20260821230000:
--   "CASE WHEN a.end_time > a.start_time THEN (same-day) ELSE (next-day) END"
-- i.e. resolution already treats end_time = start_time as a wrap-to-next-day (a
-- degenerate 24h shift), not a same-day one. Using `<` here would make this column
-- disagree with the function that actually computes the boundary.
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS crosses_midnight boolean GENERATED ALWAYS AS (end_time <= start_time) STORED;

-- Enum-style CHECKs for the two D7 mode columns.
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_determine_check_in_and_check_out_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_determine_check_in_and_check_out_check
  CHECK (determine_check_in_and_check_out IN ('alternating', 'strict_log_type'));

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_working_hours_calculation_based_on_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_working_hours_calculation_based_on_check
  CHECK (working_hours_calculation_based_on IN ('first_last', 'every_pair'));

-- NOTE on late_mark_grace_override (added 20260821230000, still live, untouched here):
-- it is a per-shift override of the *company-wide* late-mark grace period used by the
-- CURRENT cutoff-time lateness logic. late_entry_grace_minutes (added above) is the
-- Frappe-shaped D7 field the derivation processor (B6) will read, computed against
-- hours/shift_start rather than a cutoff time. The two fields serve two different
-- lateness models that are live side by side until B7 cuts the SPA over to derived rows.
-- Reconciling or retiring one of them is explicitly out of scope for this migration --
-- surgical change only. Left as a comment, not a TODO column, so it is not lost.

-- ============================================================================
-- A2. Circular shift CHECK (E5, Frappe validate_circular_shift)
-- ============================================================================
-- Total scheduled span + both margins must be < 1440 minutes, or the shift's actual
-- (margin-widened) window overlaps itself and attendance_resolve_shift's boundary math
-- (20260821230000) becomes undefined -- a punch could simultaneously fall inside and
-- outside the "same" shift depending on which day's instance you widen from.
--
-- Cross-midnight arithmetic: `end_time - start_time` on two `time` values yields an
-- interval that is NEGATIVE when end_time <= start_time (e.g. 05:00 - 18:00 = -13:00:00).
-- Adding 1440 minutes recovers the true wrapped span (11h here). This mirrors
-- attendance_resolve_shift's own CASE on end_time vs start_time, not a new formula.
--
-- Verified against live data before adding: every one of the 6 existing shifts has a
-- scheduled span + margins of at most 780 minutes (the Night Shift: 660 scheduled +
-- 60 + 60 margins), well under 1440. This CHECK is therefore a no-op today -- it only
-- starts rejecting the first shift someone tries to save with an impossibly wide window.
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_circular_shift_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_circular_shift_check
  CHECK (
    (
      CASE WHEN end_time <= start_time
        THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60 + 1440
        ELSE EXTRACT(EPOCH FROM (end_time - start_time)) / 60
      END
    ) + COALESCE(punch_in_opens_minutes_before, 60) + punch_out_closes_minutes_after < 1440
  );

-- ============================================================================
-- A3. attendance.shift_id + the unique key that makes "one row per employee per day
--     per shift" (§2.6) representable
-- ============================================================================
-- Preflight: confirm no existing (tenant_id, employee_id, date, shift) combination would
-- collide under the new key before dropping the old one. Every row today has shift_id
-- NULL (the column doesn't exist until this statement), so every row collapses to the
-- same coalesced key per (tenant_id, employee_id, date) -- exactly the old key's shape.
-- Checked explicitly rather than assumed, per the brief.
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.shifts(id);

DO $preflight$
DECLARE
  v_collisions integer;
BEGIN
  SELECT count(*) INTO v_collisions
  FROM (
    SELECT tenant_id, employee_id, date,
           COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid) AS shift_key
    FROM public.attendance
    GROUP BY tenant_id, employee_id, date,
             COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)
    HAVING count(*) > 1
  ) collided;

  IF v_collisions > 0 THEN
    RAISE EXCEPTION 'cannot replace attendance unique key: % existing (tenant,employee,date,shift) collisions found -- investigate before applying', v_collisions;
  END IF;
END
$preflight$;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_employee_id_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_tenant_employee_date_shift_key
  ON public.attendance (
    tenant_id, employee_id, date,
    (COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

-- ============================================================================
-- A4. attendance_status_check widened for the non-working-day statuses (§5.2)
-- ============================================================================
-- `absent` already exists as an allowed value -- the gap D4 fixes is that nothing ever
-- writes it. The genuinely new values are holiday / weekly_off / work_from_home, so
-- reports can tell a non-working day apart from an unexplained absence (E24, E25).
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_status_check
  CHECK (status = ANY (ARRAY['present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'work_from_home']));

-- ============================================================================
-- B. hr_save_shift extended
-- ============================================================================
-- DEVIATION FROM THE BRIEF, with reason: the brief says CREATE OR REPLACE with new
-- trailing defaulted parameters "does not create a second overload as long as you keep
-- the leading params identical". Verified empirically against this live database before
-- writing this migration (scratch function, dropped afterward) -- that claim is FALSE.
-- Postgres's function identity is (name, full parameter type list); adding parameters,
-- even all-defaulted trailing ones, produces a DIFFERENT identity and therefore a second,
-- coexisting function (confirmed: two distinct oids, both independently callable/
-- grantable). CREATE OR REPLACE only replaces a function whose parameter type list is
-- byte-for-byte the same as an existing one. Leaving both would mean the old 10-arg
-- function stays live, callable, and ignorant of every new column -- silently reintroducing
-- exactly the "dead config HR cannot reach" problem this migration exists to close, plus a
-- second surface someone could call by accident.
--
-- Fix: DROP the exact old signature, then CREATE the extended one under the same name.
-- Grants are NOT preserved across a drop+create (they're a fresh pg_proc row), so they are
-- reissued explicitly below to match the REVOKE/GRANT pattern already applied to this
-- function in 20260817130000_revoke-public-execute-on-secdef-functions.sql (PUBLIC and
-- anon revoked, authenticated granted) -- otherwise a bare CREATE FUNCTION defaults to
-- PUBLIC EXECUTE and would silently re-widen the surface that migration closed.
--
-- Confirmed via grep across src/ and functions/ before dropping: the ONLY caller in this
-- codebase is src/hr/ShiftManagement.tsx, calling via named JSON parameters (db.rpc), which
-- resolves correctly against the wider signature since every new parameter has a default
-- and the leading 10 parameter names/types/order are unchanged. No positional caller exists
-- anywhere in this repo (checked functions/ too -- hr_save_shift has no server-only caller).
--
-- Every existing behaviour is preserved unchanged: tenant fence + HR check via
-- assert_hr_for_tenant, name/working-days validation, the row lock before is_default
-- reassignment, insert-vs-update branching, and the audit_logs write. Only new fields and
-- their validation are added.
DROP FUNCTION IF EXISTS public.hr_save_shift(
  uuid, uuid, text, time without time zone, time without time zone, integer[],
  time without time zone, integer, integer, boolean
);

CREATE FUNCTION public.hr_save_shift(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_name text,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_working_days integer[],
  p_half_day_cutoff_override time without time zone,
  p_punch_in_opens_minutes_before integer,
  p_late_mark_grace_override integer,
  p_is_default boolean,
  p_working_hours_threshold_for_absent numeric DEFAULT 0,
  p_working_hours_threshold_for_half_day numeric DEFAULT 0,
  p_determine_check_in_and_check_out text DEFAULT 'alternating',
  p_working_hours_calculation_based_on text DEFAULT 'first_last',
  p_enable_late_entry_marking boolean DEFAULT true,
  p_late_entry_grace_minutes integer DEFAULT 10,
  p_enable_early_exit_marking boolean DEFAULT false,
  p_early_exit_grace_minutes integer DEFAULT 10,
  p_enable_auto_derivation boolean DEFAULT true,
  p_mark_attendance_on_holidays boolean DEFAULT false,
  p_allowed_punch_sources text[] DEFAULT ARRAY['app','device','kiosk','manual','import']
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_shift_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Shift name is required';
  END IF;

  IF p_working_days IS NULL OR array_length(p_working_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one working day';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_working_days) AS day_value WHERE day_value < 0 OR day_value > 6) THEN
    RAISE EXCEPTION 'Working days must be between 0 and 6';
  END IF;

  IF p_determine_check_in_and_check_out IS NOT NULL
     AND p_determine_check_in_and_check_out NOT IN ('alternating', 'strict_log_type') THEN
    RAISE EXCEPTION 'determine_check_in_and_check_out must be alternating or strict_log_type';
  END IF;

  IF p_working_hours_calculation_based_on IS NOT NULL
     AND p_working_hours_calculation_based_on NOT IN ('first_last', 'every_pair') THEN
    RAISE EXCEPTION 'working_hours_calculation_based_on must be first_last or every_pair';
  END IF;

  PERFORM 1 FROM shifts WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF p_is_default THEN
    UPDATE shifts
    SET is_default = false,
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND is_default = true
      AND (p_shift_id IS NULL OR id <> p_shift_id);
  END IF;

  IF p_shift_id IS NULL THEN
    INSERT INTO shifts (
      tenant_id, name, start_time, end_time, working_days,
      half_day_cutoff_override, punch_in_opens_minutes_before,
      late_mark_grace_override, is_default, is_active, created_at, updated_at,
      working_hours_threshold_for_absent, working_hours_threshold_for_half_day,
      determine_check_in_and_check_out, working_hours_calculation_based_on,
      enable_late_entry_marking, late_entry_grace_minutes,
      enable_early_exit_marking, early_exit_grace_minutes,
      enable_auto_derivation, mark_attendance_on_holidays, allowed_punch_sources
    )
    VALUES (
      p_tenant_id, trim(p_name), p_start_time, p_end_time, p_working_days,
      p_half_day_cutoff_override, COALESCE(p_punch_in_opens_minutes_before, 60),
      p_late_mark_grace_override, COALESCE(p_is_default, false), true, now(), now(),
      COALESCE(p_working_hours_threshold_for_absent, 0),
      COALESCE(p_working_hours_threshold_for_half_day, 0),
      COALESCE(p_determine_check_in_and_check_out, 'alternating'),
      COALESCE(p_working_hours_calculation_based_on, 'first_last'),
      COALESCE(p_enable_late_entry_marking, true),
      COALESCE(p_late_entry_grace_minutes, 10),
      COALESCE(p_enable_early_exit_marking, false),
      COALESCE(p_early_exit_grace_minutes, 10),
      COALESCE(p_enable_auto_derivation, true),
      COALESCE(p_mark_attendance_on_holidays, false),
      COALESCE(p_allowed_punch_sources, ARRAY['app','device','kiosk','manual','import'])
    )
    RETURNING id INTO v_shift_id;
  ELSE
    UPDATE shifts
    SET name = trim(p_name),
        start_time = p_start_time,
        end_time = p_end_time,
        working_days = p_working_days,
        half_day_cutoff_override = p_half_day_cutoff_override,
        punch_in_opens_minutes_before = COALESCE(p_punch_in_opens_minutes_before, 60),
        late_mark_grace_override = p_late_mark_grace_override,
        is_default = COALESCE(p_is_default, false),
        is_active = true,
        updated_at = now(),
        working_hours_threshold_for_absent = COALESCE(p_working_hours_threshold_for_absent, 0),
        working_hours_threshold_for_half_day = COALESCE(p_working_hours_threshold_for_half_day, 0),
        determine_check_in_and_check_out = COALESCE(p_determine_check_in_and_check_out, 'alternating'),
        working_hours_calculation_based_on = COALESCE(p_working_hours_calculation_based_on, 'first_last'),
        enable_late_entry_marking = COALESCE(p_enable_late_entry_marking, true),
        late_entry_grace_minutes = COALESCE(p_late_entry_grace_minutes, 10),
        enable_early_exit_marking = COALESCE(p_enable_early_exit_marking, false),
        early_exit_grace_minutes = COALESCE(p_early_exit_grace_minutes, 10),
        enable_auto_derivation = COALESCE(p_enable_auto_derivation, true),
        mark_attendance_on_holidays = COALESCE(p_mark_attendance_on_holidays, false),
        allowed_punch_sources = COALESCE(p_allowed_punch_sources, ARRAY['app','device','kiosk','manual','import'])
    WHERE tenant_id = p_tenant_id
      AND id = p_shift_id
    RETURNING id INTO v_shift_id;

    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'Shift not found';
    END IF;
  END IF;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.saved', 'shifts', v_shift_id,
    jsonb_build_object('name', trim(p_name), 'is_default', COALESCE(p_is_default, false), 'correlation_id', v_correlation_id)
  );

  RETURN v_shift_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.hr_save_shift(
  uuid, uuid, text, time without time zone, time without time zone, integer[],
  time without time zone, integer, integer, boolean,
  numeric, numeric, text, text, boolean, integer, boolean, integer, boolean, boolean, text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_save_shift(
  uuid, uuid, text, time without time zone, time without time zone, integer[],
  time without time zone, integer, integer, boolean,
  numeric, numeric, text, text, boolean, integer, boolean, integer, boolean, boolean, text[]
) TO authenticated;

-- ============================================================================
-- A5. Assertions -- each proves its own claim by doing the thing.
-- ============================================================================
-- Every probe that writes runs inside a nested BEGIN/EXCEPTION block that always ends by
-- raising a private sentinel SQLSTATE ('ZZ001'), caught immediately by that same block.
-- Postgres gives every EXCEPTION block an implicit savepoint, so catching the sentinel
-- rolls back exactly the probe's own writes and nothing else -- the ALTER TABLE / CREATE
-- FUNCTION statements above this DO block are untouched either way. Any OTHER error
-- (e.g. the second attendance insert failing because the unique key still blocks it) is
-- NOT the sentinel, is not caught, and propagates out of the whole DO block -- which aborts
-- this migration's transaction. That is the safety net: an honest assertion failure here
-- means nothing in this file gets applied.
DO $check$
DECLARE
  v_tenant       uuid;
  v_shift_a      uuid;
  v_shift_b      uuid;
  v_employee     uuid;
  v_date         date := '2099-06-15';
  v_bad_shift    uuid;
  v_constraint   text;
  v_probe_shift  uuid;
  v_row          record;
BEGIN
  -- --------------------------------------------------------------------
  -- Probe 1 (proves A3): two different shifts, one employee, one date,
  -- both insert into attendance without a unique-key collision.
  -- --------------------------------------------------------------------
  SELECT s1.tenant_id, s1.id, s2.id
    INTO v_tenant, v_shift_a, v_shift_b
  FROM public.shifts s1
  JOIN public.shifts s2 ON s2.tenant_id = s1.tenant_id AND s2.id <> s1.id
  ORDER BY s1.tenant_id
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'A3 probe setup failed: expected a tenant with >= 2 shifts (tenant 97da3641 verified to have Morning + Night Shift before writing this migration) -- assumption broke, investigate';
  END IF;

  SELECT id INTO v_employee
  FROM public.employees
  WHERE tenant_id = v_tenant AND status = 'active'
  LIMIT 1;

  IF v_employee IS NULL THEN
    RAISE EXCEPTION 'A3 probe setup failed: expected an active employee under tenant % -- assumption broke, investigate', v_tenant;
  END IF;

  -- session_status is set to 'closed' on both rows explicitly: idx_single_open_session
  -- is a real, unrelated invariant (one OPEN punch session per tenant+employee at a time,
  -- pre-existing, out of Phase 0's scope) that two default-'open' probe rows for the same
  -- employee would otherwise trip. Closed sessions are the right shape for these rows
  -- anyway -- they are historical/derived-style rows, not live punches.
  BEGIN
    INSERT INTO public.attendance (tenant_id, employee_id, date, status, shift_id, session_status)
    VALUES (v_tenant, v_employee, v_date, 'present', v_shift_a, 'closed');
    INSERT INTO public.attendance (tenant_id, employee_id, date, status, shift_id, session_status)
    VALUES (v_tenant, v_employee, v_date, 'present', v_shift_b, 'closed');

    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'A3 verified: two shifts (% and %) for employee % on % both inserted into attendance under the new (tenant,employee,date,shift) key',
      v_shift_a, v_shift_b, v_employee, v_date;
  END;

  -- --------------------------------------------------------------------
  -- Probe 2 (proves A4): a weekly_off status row inserts.
  -- --------------------------------------------------------------------
  BEGIN
    INSERT INTO public.attendance (tenant_id, employee_id, date, status, session_status)
    VALUES (v_tenant, v_employee, v_date + 1, 'weekly_off', 'closed');

    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'A4 verified: a weekly_off status row inserts into attendance';
  END;

  -- --------------------------------------------------------------------
  -- Probe 3 (proves A2): a shift whose scheduled span + both margins is >= 1440
  -- minutes is rejected, and specifically BY THE CIRCULAR-SHIFT CHECK -- not by
  -- shifts_determine_check_in_and_check_out_check or
  -- shifts_working_hours_calculation_based_on_check, the two other CHECKs this
  -- migration adds to the same table. 09:00 -> 08:59 the next day is a 1439-minute
  -- scheduled span (crosses midnight); + the default 60/60 margins = 1559 minutes.
  -- --------------------------------------------------------------------
  BEGIN
    INSERT INTO public.shifts (tenant_id, name, start_time, end_time)
    VALUES (v_tenant, 'Circular shift probe (rolled back)', '09:00', '08:59')
    RETURNING id INTO v_bad_shift;

    RAISE EXCEPTION 'circular shift CHECK did not fire: a 1559-minute effective shift (1439 scheduled + 60 + 60 margins) was accepted';
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint <> 'shifts_circular_shift_check' THEN
        RAISE EXCEPTION 'shift was rejected, but by constraint % instead of shifts_circular_shift_check -- the circular-shift CHECK itself may not be firing', v_constraint;
      END IF;
      RAISE NOTICE 'A2 verified: a shift with a 1559-minute effective span (>= 1440) was rejected by shifts_circular_shift_check';
  END;

  -- --------------------------------------------------------------------
  -- Probe 4 (proves A1): every new column exists with the stated effective default.
  -- Read via information_schema for existence/type, and via an actual inserted-and-
  -- read-back row for the DEFAULT values themselves, rather than string-comparing
  -- information_schema.columns.column_default (whose text rendering of literals/arrays
  -- is a brittle thing to assert against).
  -- --------------------------------------------------------------------
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'shifts'
        AND column_name IN (
          'working_hours_threshold_for_absent', 'working_hours_threshold_for_half_day',
          'determine_check_in_and_check_out', 'working_hours_calculation_based_on',
          'enable_late_entry_marking', 'late_entry_grace_minutes',
          'enable_early_exit_marking', 'early_exit_grace_minutes',
          'enable_auto_derivation', 'mark_attendance_on_holidays',
          'process_attendance_after', 'last_sync_of_events',
          'allowed_punch_sources', 'crosses_midnight'
        )) <> 14 THEN
    RAISE EXCEPTION 'A1 verification failed: not all 14 §5.3 columns exist on shifts';
  END IF;

  BEGIN
    INSERT INTO public.shifts (tenant_id, name, start_time, end_time)
    VALUES (v_tenant, 'Default-value probe (rolled back)', '10:00', '19:00')
    RETURNING id INTO v_probe_shift;

    SELECT * INTO v_row FROM public.shifts WHERE id = v_probe_shift;

    IF v_row.working_hours_threshold_for_absent IS DISTINCT FROM 0
       OR v_row.working_hours_threshold_for_half_day IS DISTINCT FROM 0
       OR v_row.determine_check_in_and_check_out IS DISTINCT FROM 'alternating'
       OR v_row.working_hours_calculation_based_on IS DISTINCT FROM 'first_last'
       OR v_row.enable_late_entry_marking IS DISTINCT FROM true
       OR v_row.late_entry_grace_minutes IS DISTINCT FROM 10
       OR v_row.enable_early_exit_marking IS DISTINCT FROM false
       OR v_row.early_exit_grace_minutes IS DISTINCT FROM 10
       OR v_row.enable_auto_derivation IS DISTINCT FROM true
       OR v_row.mark_attendance_on_holidays IS DISTINCT FROM false
       OR v_row.process_attendance_after IS NOT NULL
       OR v_row.last_sync_of_events IS NOT NULL
       OR v_row.allowed_punch_sources IS DISTINCT FROM ARRAY['app','device','kiosk','manual','import']
       OR v_row.crosses_midnight IS DISTINCT FROM (v_row.end_time <= v_row.start_time) THEN
      RAISE EXCEPTION 'A1 verification failed: an inserted shift''s defaulted column values do not match the stated defaults (row: %)', to_jsonb(v_row);
    END IF;

    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'A1 verified: all 14 §5.3 columns exist and a freshly inserted shift carries exactly the stated defaults, including crosses_midnight = (end_time <= start_time) = %', v_row.crosses_midnight;
  END;

  RAISE NOTICE 'Phase 0 assertions complete: A1, A2, A3, A4 all verified.';
END
$check$;
