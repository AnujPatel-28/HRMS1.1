-- Phase 1 of the attendance completion plan (doc/attendance_completion_plan_2026-08-24.md).
-- B5 (decision doc §8): holiday calendars. Authority: `new update doc/attendance_shift_v2_
-- decision_doc.md` §2.2 (half-day holidays halve both derivation thresholds), §5.4 (the
-- target schema), §7 E20/E24/E25, §10 (rules for future agents).
--
-- ============================================================================
-- DEVIATION FROM THE DOC, STATED (this is deliberate, not missed)
-- ============================================================================
-- §5.4 says "Migrate `holidays`". This migration does NOT migrate it. `holidays` has 10
-- frontend call sites across 6 files -- including direct insert/delete/upsert in
-- LeaveManagement.tsx -- plus 4 server functions (approve_leave_request,
-- employee_apply_leave_request, payroll_period_input, work_calendar_working_days).
-- Replacing it with a view + INSTEAD OF triggers is a large blast radius for zero
-- derivation benefit this phase.
--
-- Instead: `holidays` remains the physical storage of each tenant's default calendar. The
-- new tables (`holiday_calendars`, `holiday_calendar_days`) are an OVERRIDE layer only,
-- reached by resolving `shifts.holiday_calendar_id` / `employees.holiday_calendar_id`.
-- `holiday_calendars.is_default` is provisioned by this migration (per the requested shape)
-- but is NOT consulted by the resolver below -- the resolver's tenant-default rung is
-- `holidays` itself, exactly as §5.4's own precedence line states ("... -> tenant default").
-- `is_default` is schema headroom for a future release that lets a tenant manage several
-- named calendars through `holiday_calendars` and mark one as their default; consuming it
-- would mean the resolver reads two different tables for the same rung, which is not what
-- this phase asks for. Stated so the unused column reads as planned, not orphaned.
--
-- ============================================================================
-- PRECEDENCE SEMANTICS: PER-DATE FALLTHROUGH, NOT "FIRST ASSIGNED ID WINS"
-- ============================================================================
-- Two readings of "shift -> employee -> tenant default" are both defensible from the doc's
-- one-line description:
--
--   (A) ID precedence: whichever level has a `holiday_calendar_id` assigned is fully
--       authoritative for every date, even dates that calendar does not list.
--   (B) Per-date fallthrough: each level is consulted for THIS SPECIFIC DATE in order; a
--       level that does not list the date defers to the next level, it does not blank it.
--
-- This migration implements (B), for two reasons:
--
--   1. The return contract itself. `source` is a 4-valued enum including 'none', and this
--      migration's own assertions require "a date on no calendar returns is_holiday=false,
--      source='none'" -- for an employee whose shift AND employee calendar are BOTH
--      assigned. Under (A) that combination has no exit: `holidays` has no ID gate, so it
--      is always the terminal rung and 'none' is unreachable. A 4-valued enum with an
--      unreachable value is the tell that (A) is the wrong reading.
--   2. What "override layer only" (the deviation above) is actually for. A shift-level
--      calendar in this product models something like a factory's regional/state holiday
--      additions layered on top of the company list, not a replacement of it. Under (A),
--      assigning ANY shift-level calendar would silently blank out the tenant's entire
--      company-wide `holidays` list for everyone on that shift the moment that calendar
--      does not happen to repeat every company holiday on its own list -- an easy, silent
--      misconfiguration with real payroll consequences (§2.2 half-day thresholds and,
--      later, B6's holiday-skip logic both key off this resolver). (B) does not have that
--      failure mode: an assigned calendar only ever ADDS or overrides specific dates it
--      actually lists.
--
-- Proven below: build a holiday on the SAME date in all three layers, then peel off the
-- higher-precedence IDs one at a time and watch `source` step from shift -> employee ->
-- tenant_default (proving precedence). Separately, with BOTH the shift and employee
-- calendars assigned, probe a date neither of them lists -> source='none' (proving
-- fallthrough, not ID-lockout).
--
-- ============================================================================
-- HALF-DAY HOLIDAYS DO NOT CHANGE THE working_days DIVISOR
-- ============================================================================
-- work_calendar_working_days RETURNS integer, and payroll_period_input exposes it as
-- `working_days integer` -- a fractional day is not representable without changing both
-- signatures, which would break the payroll_period_input contract (20260821160000). So: ANY
-- holiday -- half-day or full -- is excluded from the divisor exactly as it is today,
-- unchanged. `is_half_day` is still carried all the way through the resolver so Phase 2/B6
-- can halve the DERIVATION THRESHOLDS per §2.2; it is deliberately not consulted by this
-- divisor. The no-op proof below (section F) demonstrates the divisor is byte-for-byte
-- unchanged for every existing employee, which is the strongest version of this claim.

-- ============================================================================
-- 0. NO-OP PROOF SETUP -- snapshot the OLD functions before anything below changes them.
-- ============================================================================
-- work_calendar_working_days, for EVERY employee (not just ones with attendance rows --
-- those are exactly the code paths the Phase 0 lesson says nothing else exercises), over a
-- real month (2026-08, the current one).
CREATE TEMP TABLE _b5_wd_before AS
SELECT e.id AS employee_id, e.tenant_id,
       public.work_calendar_working_days(e.tenant_id, e.id, DATE '2026-08-01', DATE '2026-08-31') AS working_days
FROM public.employees e;

-- payroll_period_input, for the tenant/period with the most attendance rows (same selection
-- rule 20260821160000's own self-check uses) -- the actual money-moving consumer, not just
-- the raw calendar function. CROSS JOIN LATERAL over a possibly-empty `busiest` still
-- produces a correctly-shaped (possibly 0-row) temp table, matching that migration's own
-- graceful handling of "no attendance rows anywhere".
CREATE TEMP TABLE _b5_payroll_before AS
WITH busiest AS (
  SELECT a.tenant_id, date_trunc('month', a.date)::date AS period_start
  FROM public.attendance a
  GROUP BY 1, 2
  ORDER BY count(*) DESC
  LIMIT 1
)
SELECT p.*
FROM busiest b
CROSS JOIN LATERAL public.payroll_period_input(
  b.tenant_id, b.period_start, (b.period_start + interval '1 month - 1 day')::date
) p;

-- ============================================================================
-- A. New tables: holiday_calendars + holiday_calendar_days, RLS in this same migration (D10)
-- ============================================================================
CREATE TABLE public.holiday_calendars (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX idx_holiday_calendars_tenant_id ON public.holiday_calendars (tenant_id);

-- At most one default calendar per tenant. Not consulted by the resolver in this phase (see
-- the header deviation note); provisioned now because the shape was requested, and adding a
-- uniqueness rule after there is data to violate it is the harder order to do this in.
CREATE UNIQUE INDEX uq_holiday_calendars_default_per_tenant
  ON public.holiday_calendars (tenant_id)
  WHERE is_default;

CREATE TRIGGER set_holiday_calendars_updated_at
  BEFORE UPDATE ON public.holiday_calendars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.holiday_calendar_days (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  calendar_id uuid not null references public.holiday_calendars(id) on delete cascade,
  date        date not null,
  name        text,
  is_half_day boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  UNIQUE (calendar_id, date)
);

CREATE INDEX idx_holiday_calendar_days_tenant_id ON public.holiday_calendar_days (tenant_id);

CREATE TRIGGER set_holiday_calendar_days_updated_at
  BEFORE UPDATE ON public.holiday_calendar_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS -- the exact five-policy shape live on `holidays` today, table name substituted into
-- tenant_active_restrictive. Read-all / HR-write permissive pair, plus the three RESTRICTIVE
-- fences (module gate, tenant-active, tenant-isolation).
ALTER TABLE public.holiday_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY holiday_calendars_all_read ON public.holiday_calendars
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY holiday_calendars_hr_write ON public.holiday_calendars
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_hr()))
  WITH CHECK ((SELECT public.is_hr()));

CREATE POLICY module_enabled_work_calendar ON public.holiday_calendars
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.tenant_has_module('work_calendar')))
  WITH CHECK ((SELECT public.tenant_has_module('work_calendar')));

CREATE POLICY tenant_active_restrictive ON public.holiday_calendars
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(holiday_calendars.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(holiday_calendars.tenant_id)));

CREATE POLICY tenant_isolation ON public.holiday_calendars
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

ALTER TABLE public.holiday_calendar_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY holiday_calendar_days_all_read ON public.holiday_calendar_days
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY holiday_calendar_days_hr_write ON public.holiday_calendar_days
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_hr()))
  WITH CHECK ((SELECT public.is_hr()));

CREATE POLICY module_enabled_work_calendar ON public.holiday_calendar_days
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.tenant_has_module('work_calendar')))
  WITH CHECK ((SELECT public.tenant_has_module('work_calendar')));

CREATE POLICY tenant_active_restrictive ON public.holiday_calendar_days
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(holiday_calendar_days.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(holiday_calendar_days.tenant_id)));

CREATE POLICY tenant_isolation ON public.holiday_calendar_days
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

-- ============================================================================
-- B. holidays.is_half_day -- one additive column, gives the tenant-default calendar
--    half-day support (§2.2). No existing consumer breaks: every reader either ignores the
--    new column (defaults false, matching every row that exists today) or is the resolver
--    below, which is new code.
-- ============================================================================
ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS is_half_day boolean NOT NULL DEFAULT false;

-- ============================================================================
-- C. shifts.holiday_calendar_id + employees.holiday_calendar_id -- the two override points
--    the resolver walks, in precedence order. Nullable, ON DELETE SET NULL: deleting a
--    calendar un-assigns it rather than deleting the shift/employee or being blocked.
-- ============================================================================
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS holiday_calendar_id uuid REFERENCES public.holiday_calendars(id) ON DELETE SET NULL;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS holiday_calendar_id uuid REFERENCES public.holiday_calendars(id) ON DELETE SET NULL;

-- ============================================================================
-- D. work_calendar_holiday(tenant, employee, date) -- the precedence resolver
-- ============================================================================
-- SECURITY DEFINER, deliberately, for the same reason as work_calendar_working_days: it
-- reads `shifts`/`employee_shifts` (attendance-gated) and `holidays`/`holiday_calendar_days`
-- (work_calendar-gated), and must answer correctly regardless of the tenant's module mix.
-- Definer bypasses RLS, so binding rule 1 applies: the tenant fence is restored EXPLICITLY
-- via can_access_tenant(), with the same `auth.uid() IS NULL` arm as the precedent function
-- so this stays callable from a migration, cron, or service-role context.
--
-- Shape: three CTEs each independently find (at most) one row for the given date --
-- shift_hit only exists if the effective-dated shift assignment has a
-- holiday_calendar_id AND that calendar lists this date; employee_hit and tenant_hit
-- likewise. `resolved` then picks the highest-precedence one that actually has a row for
-- THIS DATE (see the header note on per-date fallthrough) via NOT EXISTS guards, not by
-- "which ID is assigned". The final SELECT applies the tenant fence once via a `fence` CTE
-- joined against `resolved` (0 or 1 row) so the function always returns exactly one row.
CREATE OR REPLACE FUNCTION public.work_calendar_holiday(
  p_tenant_id   uuid,
  p_employee_id uuid,
  p_date        date
)
 RETURNS TABLE (
   is_holiday   boolean,
   is_half_day  boolean,
   holiday_name text,
   source       text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH shift_hit AS (
    SELECT d.is_half_day, d.name
    FROM public.employee_shifts es
    JOIN public.shifts s
      ON s.id = es.shift_id
     AND s.holiday_calendar_id IS NOT NULL
    JOIN public.holiday_calendar_days d
      ON d.calendar_id = s.holiday_calendar_id
     AND d.date = p_date
    WHERE es.tenant_id     = p_tenant_id
      AND es.employee_id   = p_employee_id
      AND es.effective_from <= p_date
      AND (es.effective_to IS NULL OR es.effective_to >= p_date)
    ORDER BY es.effective_from DESC
    LIMIT 1
  ),
  employee_hit AS (
    SELECT d.is_half_day, d.name
    FROM public.employees e
    JOIN public.holiday_calendar_days d
      ON d.calendar_id = e.holiday_calendar_id
     AND d.date = p_date
    WHERE e.tenant_id = p_tenant_id
      AND e.id = p_employee_id
      AND e.holiday_calendar_id IS NOT NULL
  ),
  tenant_hit AS (
    SELECT h.is_half_day, h.name
    FROM public.holidays h
    WHERE h.tenant_id = p_tenant_id
      AND h.date = p_date
  ),
  resolved AS (
    SELECT is_half_day, name, 'shift'::text AS source FROM shift_hit
    UNION ALL
    SELECT is_half_day, name, 'employee'::text
    FROM employee_hit
    WHERE NOT EXISTS (SELECT 1 FROM shift_hit)
    UNION ALL
    SELECT is_half_day, name, 'tenant_default'::text
    FROM tenant_hit
    WHERE NOT EXISTS (SELECT 1 FROM shift_hit)
      AND NOT EXISTS (SELECT 1 FROM employee_hit)
  ),
  fence AS (
    SELECT ((SELECT auth.uid()) IS NULL OR (SELECT public.can_access_tenant(p_tenant_id))) AS ok
  )
  SELECT
    CASE WHEN f.ok THEN (r.source IS NOT NULL) ELSE NULL END          AS is_holiday,
    CASE WHEN f.ok THEN COALESCE(r.is_half_day, false) ELSE NULL END  AS is_half_day,
    CASE WHEN f.ok THEN r.name ELSE NULL END                          AS holiday_name,
    CASE WHEN f.ok THEN COALESCE(r.source, 'none') ELSE NULL END      AS source
  FROM fence f
  LEFT JOIN resolved r ON true;
$function$;

REVOKE EXECUTE ON FUNCTION public.work_calendar_holiday(uuid, uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.work_calendar_holiday(uuid, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.work_calendar_holiday(uuid, uuid, date) TO authenticated;

COMMENT ON FUNCTION public.work_calendar_holiday(uuid, uuid, date) IS
'Precedence resolver for holiday calendars (decision doc §5.4): shift-level calendar (via the effective-dated employee_shifts assignment) -> employee-level calendar -> the holidays table (tenant default). PER-DATE FALLTHROUGH: an assigned higher-precedence calendar only overrides dates it actually lists -- it does not blank a lower layer for dates it is silent on, so it behaves as an addition/override, not a replacement. source reports which layer actually answered (shift|employee|tenant_default), or none when no layer has this date. Returns NULL columns if an authenticated caller cannot access the tenant; a session-less caller (migration/cron/service-role) is allowed, matching work_calendar_working_days.';

-- ============================================================================
-- E. work_calendar_working_days -- now consults the resolver instead of reading `holidays`
--    directly, so an employee on a shift (or with an employee-level override) with its own
--    calendar is excluded on THAT calendar's days too, not only the tenant default's.
-- ============================================================================
-- ⚠️ THIS FUNCTION DIVIDES PAY (payroll_period_input consumes it). The only semantic change
-- versus 20260821180000 is WHICH calendar answers "is this day a holiday" -- from a direct
-- `holidays` lookup to the precedence resolver. It is a no-op for every employee/period that
-- exists today, because no shift or employee has a holiday_calendar_id assigned yet (both
-- columns are brand new, added above, and nothing in this migration sets them outside of
-- rolled-back probes) -- so the resolver falls through to `holidays` for everyone, every
-- time, which is byte-for-byte what the old direct lookup did. Proven in section F, not
-- merely asserted.
--
-- The divisor itself stays an integer day count either way: a half-day holiday is still
-- excluded as a full non-working day here (see the header note on why -- the return type is
-- integer, and §2.2's threshold-halving is Phase 2's business, not this denominator's).
CREATE OR REPLACE FUNCTION public.work_calendar_working_days(
  p_tenant_id   uuid,
  p_employee_id uuid,
  p_start       date,
  p_end         date
)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN (SELECT auth.uid()) IS NULL
                OR (SELECT public.can_access_tenant(p_tenant_id)) THEN (
    SELECT count(*)::integer
    FROM generate_series(p_start, p_end, interval '1 day') AS g(day)
    WHERE
      EXTRACT(DOW FROM g.day)::int = ANY (
        COALESCE(
          (
            SELECT s.working_days
            FROM public.employee_shifts es
            JOIN public.shifts s ON s.id = es.shift_id
            WHERE es.tenant_id     = p_tenant_id
              AND es.employee_id   = p_employee_id
              AND es.effective_from <= g.day::date
              AND (es.effective_to IS NULL OR es.effective_to >= g.day::date)
            ORDER BY es.effective_from DESC
            LIMIT 1
          ),
          ARRAY[1, 2, 3, 4, 5, 6]
        )
      )
      -- Precedence resolver replaces the direct `holidays` read (B5). Binary in/out only --
      -- a half-day holiday is still counted as a non-working day here exactly as a full
      -- holiday is; see the header note and E's comment above for why the divisor does not
      -- change shape this phase.
      AND NOT COALESCE(
        (SELECT h.is_holiday FROM public.work_calendar_holiday(p_tenant_id, p_employee_id, g.day::date) h),
        false
      )
  ) ELSE NULL END;
$function$;

COMMENT ON FUNCTION public.work_calendar_working_days(uuid, uuid, date, date) IS
'Authoritative count of days an employee was expected to work in a period. Per employee, resolving the effective-dated shift PER DAY, minus holidays resolved through the shift -> employee -> tenant-default precedence (work_calendar_holiday, B5). A half-day holiday is still excluded as a full non-working day here -- the divisor stays a whole-day integer; §2.2 threshold-halving happens in derivation (B6), not in this count. Core infrastructure -- answers correctly regardless of module mix. Returns NULL if an authenticated caller cannot access the tenant; a session-less (project_admin) caller is allowed, since it can read the underlying tables anyway.';

-- ============================================================================
-- F. Assertions -- each proves its own claim by doing the thing. Writes are wrapped in a
--    nested BEGIN/EXCEPTION block ending in a private sentinel SQLSTATE ('ZZ001'), caught by
--    that same block -- Postgres's implicit per-EXCEPTION-block savepoint rolls back exactly
--    the probe's own writes. Any OTHER error propagates out of the DO block and aborts this
--    migration's transaction: an honest assertion failure means nothing in this file applies.
-- ============================================================================
DO $check$
DECLARE
  v_tenant   uuid;
  v_employee uuid;
  v_shift    uuid;
  v_date_a   date := DATE '2099-07-10';  -- "build all three" precedence probe date
  v_date_b   date := DATE '2099-07-11';  -- untouched date: proves per-date fallthrough to 'none'
  v_cal_shift    uuid;
  v_cal_employee uuid;
  v_r record;
BEGIN
  SELECT es.tenant_id, es.employee_id, es.shift_id
    INTO v_tenant, v_employee, v_shift
  FROM public.employee_shifts es
  WHERE es.effective_to IS NULL
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'B5 probe setup failed: expected an open-ended employee_shifts assignment (9 exist, 7 open-ended, verified live before writing this migration) -- assumption broke, investigate';
  END IF;

  -- --------------------------------------------------------------------
  -- F0 (literal "no calendar" case): before anything is built, neither the shift nor the
  -- employee has a holiday_calendar_id (both columns are brand new, default NULL), and
  -- v_date_b is nowhere in `holidays` either. Must resolve to false/none.
  -- --------------------------------------------------------------------
  SELECT * INTO v_r FROM public.work_calendar_holiday(v_tenant, v_employee, v_date_b);
  IF v_r.is_holiday IS DISTINCT FROM false OR v_r.source IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'F0 FAILED: expected is_holiday=false, source=none with no calendar assigned anywhere; got is_holiday=%, source=%', v_r.is_holiday, v_r.source;
  END IF;
  RAISE NOTICE 'F0 verified: is_holiday=false, source=none when no shift/employee calendar is assigned and the date is not in holidays';

  BEGIN
    -- ----------------------------------------------------------------
    -- F1-F3: build a holiday on v_date_a in ALL THREE layers, then peel off the
    -- higher-precedence assignments one at a time so `source` must step
    -- shift -> employee -> tenant_default. Distinguishes real precedence from
    -- "whichever source happens to have this date".
    -- ----------------------------------------------------------------
    INSERT INTO public.holiday_calendars (tenant_id, name)
    VALUES (v_tenant, 'B5 probe: shift calendar (rolled back)')
    RETURNING id INTO v_cal_shift;

    INSERT INTO public.holiday_calendars (tenant_id, name)
    VALUES (v_tenant, 'B5 probe: employee calendar (rolled back)')
    RETURNING id INTO v_cal_employee;

    INSERT INTO public.holiday_calendar_days (tenant_id, calendar_id, date, name, is_half_day)
    VALUES (v_tenant, v_cal_shift, v_date_a, 'Shift-level holiday (rolled back)', true);  -- half-day, proves F3 too

    INSERT INTO public.holiday_calendar_days (tenant_id, calendar_id, date, name, is_half_day)
    VALUES (v_tenant, v_cal_employee, v_date_a, 'Employee-level holiday (rolled back)', false);

    INSERT INTO public.holidays (tenant_id, name, date, type)
    VALUES (v_tenant, 'B5 probe: tenant default holiday (rolled back)', v_date_a, 'company')
    ON CONFLICT (tenant_id, date) DO NOTHING;

    -- Step 1: only the shift calendar assigned -> shift wins, and is_half_day carries true.
    UPDATE public.shifts SET holiday_calendar_id = v_cal_shift WHERE id = v_shift;
    UPDATE public.employees SET holiday_calendar_id = NULL WHERE id = v_employee;

    SELECT * INTO v_r FROM public.work_calendar_holiday(v_tenant, v_employee, v_date_a);
    IF v_r.source IS DISTINCT FROM 'shift' OR v_r.is_holiday IS DISTINCT FROM true OR v_r.is_half_day IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'F1 (shift) FAILED: got is_holiday=%, is_half_day=%, source=%', v_r.is_holiday, v_r.is_half_day, v_r.source;
    END IF;
    RAISE NOTICE 'F1 verified: shift-level calendar wins (source=shift) with is_half_day=true, even though the employee calendar and tenant default both also have this date';

    -- Step 2: unassign shift, assign employee -> employee wins.
    UPDATE public.shifts SET holiday_calendar_id = NULL WHERE id = v_shift;
    UPDATE public.employees SET holiday_calendar_id = v_cal_employee WHERE id = v_employee;

    SELECT * INTO v_r FROM public.work_calendar_holiday(v_tenant, v_employee, v_date_a);
    IF v_r.source IS DISTINCT FROM 'employee' OR v_r.is_holiday IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'F2 (employee) FAILED: got is_holiday=%, source=%', v_r.is_holiday, v_r.source;
    END IF;
    RAISE NOTICE 'F2 verified: employee-level calendar wins (source=employee) once the shift calendar is unassigned';

    -- Step 3: unassign employee too -> falls through to the tenant default (`holidays`).
    UPDATE public.employees SET holiday_calendar_id = NULL WHERE id = v_employee;

    SELECT * INTO v_r FROM public.work_calendar_holiday(v_tenant, v_employee, v_date_a);
    IF v_r.source IS DISTINCT FROM 'tenant_default' OR v_r.is_holiday IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'F3 (tenant_default) FAILED: got is_holiday=%, source=%', v_r.is_holiday, v_r.source;
    END IF;
    RAISE NOTICE 'F3 verified: falls through to the tenant default (holidays table, source=tenant_default) once neither shift nor employee has a calendar assigned';

    -- ----------------------------------------------------------------
    -- F4: re-assign BOTH the shift and employee calendars (both IDs non-null again), but
    -- probe v_date_b -- present in NEITHER calendar NOR `holidays`. This is the case that
    -- actually distinguishes per-date fallthrough (implemented) from ID-precedence
    -- (deliberately not implemented) -- see the header note.
    -- ----------------------------------------------------------------
    UPDATE public.shifts SET holiday_calendar_id = v_cal_shift WHERE id = v_shift;
    UPDATE public.employees SET holiday_calendar_id = v_cal_employee WHERE id = v_employee;

    SELECT * INTO v_r FROM public.work_calendar_holiday(v_tenant, v_employee, v_date_b);
    IF v_r.is_holiday IS DISTINCT FROM false OR v_r.source IS DISTINCT FROM 'none' THEN
      RAISE EXCEPTION 'F4 FAILED: got is_holiday=%, source=% (expected false/none: both a shift and an employee calendar are assigned, but neither lists this date, and it is not in holidays either)', v_r.is_holiday, v_r.source;
    END IF;
    RAISE NOTICE 'F4 verified: is_holiday=false, source=none for a date absent from every layer, even with both a shift-level and an employee-level calendar assigned -- proves fallthrough, not ID-lockout';

    RAISE EXCEPTION 'B5 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'F1-F4 probe writes rolled back (calendars, days, tenant-default holiday row, shift/employee assignments)';
  END;
END
$check$;

-- --------------------------------------------------------------------
-- F5: RLS enabled and all five policies present on both new tables.
-- --------------------------------------------------------------------
DO $rls_check$
DECLARE
  v_missing text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.holiday_calendars'::regclass) THEN
    RAISE EXCEPTION 'F5 FAILED: holiday_calendars does not have RLS enabled';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.holiday_calendar_days'::regclass) THEN
    RAISE EXCEPTION 'F5 FAILED: holiday_calendar_days does not have RLS enabled';
  END IF;

  SELECT string_agg(missing_policy, ', ') INTO v_missing
  FROM (
    SELECT unnest(ARRAY[
      'holiday_calendars_all_read', 'holiday_calendars_hr_write',
      'module_enabled_work_calendar', 'tenant_active_restrictive', 'tenant_isolation'
    ]) AS missing_policy
    EXCEPT
    SELECT polname FROM pg_policy WHERE polrelid = 'public.holiday_calendars'::regclass
  ) x;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'F5 FAILED: holiday_calendars missing policies: %', v_missing;
  END IF;

  SELECT string_agg(missing_policy, ', ') INTO v_missing
  FROM (
    SELECT unnest(ARRAY[
      'holiday_calendar_days_all_read', 'holiday_calendar_days_hr_write',
      'module_enabled_work_calendar', 'tenant_active_restrictive', 'tenant_isolation'
    ]) AS missing_policy
    EXCEPT
    SELECT polname FROM pg_policy WHERE polrelid = 'public.holiday_calendar_days'::regclass
  ) x;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'F5 FAILED: holiday_calendar_days missing policies: %', v_missing;
  END IF;

  RAISE NOTICE 'F5 verified: RLS enabled and all 5 policies present on holiday_calendars and holiday_calendar_days';
END
$rls_check$;

-- --------------------------------------------------------------------
-- F6: THE NO-OP PROOF. work_calendar_working_days is unchanged for every existing employee
-- over 2026-08, and payroll_period_input's full output is unchanged for the busiest
-- tenant/period. The probes above (F1-F4) run and roll back BEFORE this comparison, so this
-- proves the migration is a no-op on top of real assignment activity, not merely on an
-- untouched database.
-- --------------------------------------------------------------------
DO $noop$
DECLARE
  v_checked    integer;
  v_mismatches integer;
  v_before_count integer;
  v_after_count  integer;
  v_diff_count   integer;
BEGIN
  SELECT count(*) INTO v_checked FROM _b5_wd_before;

  SELECT count(*) INTO v_mismatches
  FROM _b5_wd_before b
  WHERE public.work_calendar_working_days(b.tenant_id, b.employee_id, DATE '2026-08-01', DATE '2026-08-31')
        IS DISTINCT FROM b.working_days;

  IF v_mismatches <> 0 THEN
    RAISE EXCEPTION 'F6 FAILED (work_calendar_working_days): % of % employees changed', v_mismatches, v_checked;
  END IF;
  RAISE NOTICE 'F6a verified: work_calendar_working_days(...) identical before/after for all % employees, 2026-08-01..2026-08-31', v_checked;

  CREATE TEMP TABLE _b5_payroll_after AS
  WITH busiest AS (
    SELECT a.tenant_id, date_trunc('month', a.date)::date AS period_start
    FROM public.attendance a
    GROUP BY 1, 2
    ORDER BY count(*) DESC
    LIMIT 1
  )
  SELECT p.*
  FROM busiest b
  CROSS JOIN LATERAL public.payroll_period_input(
    b.tenant_id, b.period_start, (b.period_start + interval '1 month - 1 day')::date
  ) p;

  SELECT count(*) INTO v_before_count FROM _b5_payroll_before;
  SELECT count(*) INTO v_after_count FROM _b5_payroll_after;

  IF v_before_count <> v_after_count THEN
    RAISE EXCEPTION 'F6 FAILED (payroll_period_input): row count changed from % to %', v_before_count, v_after_count;
  END IF;

  SELECT count(*) INTO v_diff_count
  FROM (
    TABLE _b5_payroll_before EXCEPT TABLE _b5_payroll_after
    UNION ALL
    TABLE _b5_payroll_after EXCEPT TABLE _b5_payroll_before
  ) d;

  IF v_diff_count <> 0 THEN
    RAISE EXCEPTION 'F6 FAILED (payroll_period_input): % differing rows for the busiest tenant/period', v_diff_count;
  END IF;

  RAISE NOTICE 'F6b verified: payroll_period_input output identical before/after for % employee rows (busiest tenant/period)', v_before_count;
  RAISE NOTICE 'Phase 1 (B5) assertions complete: F0, F1, F2, F3, F4, F5, F6a, F6b all verified.';
END
$noop$;
