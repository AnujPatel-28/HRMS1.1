-- Extract the Work Calendar as CORE infrastructure.
--
-- ============================================================================
-- THE PATTERN THIS FIXES — THIRD OCCURRENCE
-- ============================================================================
-- Shared substrate keeps getting packaged as a sellable module:
--
--   1. `policy_center` — the only home of the statutory settings payroll and attendance
--      read. Gated off, both silently ran on hardcoded defaults. Made core 20260821150000.
--   2. `holidays` — filed under the `leave` module, yet payroll and attendance both need
--      the holiday calendar to know which days are working days. This is why payroll
--      charged employees for public holidays when Leave was disabled.
--   3. The weekly-off pattern — buried in `shifts` (attendance module) and, worse, ignored
--      entirely: getWorkingDays() hardcodes SUNDAY as the only weekly off.
--
-- A work calendar is not a feature anyone buys. It is the denominator: which days a given
-- employee was expected to work. Attendance measures against it, leave deducts from it,
-- payroll divides by it. It has to be available to every tenant whatever their module mix.
--
-- ============================================================================
-- IS THIS SAFE? YES, AND VERIFIABLY SO — TODAY
-- ============================================================================
-- working_days divides gross pay, so getting this wrong moves money. Every shift in the
-- database currently has working_days = {1,2,3,4,5,6} (Mon-Sat, Sunday off), which is
-- exactly what the hardcoded Sunday assumption produces. So this change is a NO-OP for
-- every payslip that exists today, and the assertion at the bottom proves it rather than
-- asserting it.
--
-- That is precisely why now is the moment. The first tenant on a Fri/Sat weekend or a
-- five-day week would otherwise have been paid on a wrong divisor, silently.

-- ---------------------------------------------------------------------------
-- 1. work_calendar joins the registry as a CORE module
-- ---------------------------------------------------------------------------
INSERT INTO public.modules (key, name, description, is_core, sort_order)
VALUES (
  'work_calendar',
  'Work Calendar',
  'Working days, weekly-off patterns and holidays. Core infrastructure: attendance measures against it, leave deducts from it, payroll divides by it.',
  true,
  0
)
ON CONFLICT (key) DO UPDATE SET is_core = true;

-- Holidays move from the leave module to the work calendar. Same RESTRICTIVE shape, same
-- tenant fence, only the entitlement key changes — and because work_calendar is core,
-- tenant_has_module() short-circuits true without consulting tenant_modules at all.
DROP POLICY IF EXISTS module_enabled_leave ON public.holidays;
CREATE POLICY module_enabled_work_calendar ON public.holidays
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.tenant_has_module('work_calendar')))
  WITH CHECK ((SELECT public.tenant_has_module('work_calendar')));

-- ---------------------------------------------------------------------------
-- 2. work_calendar_working_days(tenant, employee, start, end)
-- ---------------------------------------------------------------------------
-- The single authoritative answer to "how many days was this employee expected to work in
-- this period". Per EMPLOYEE, not per tenant, because two people on different shifts have
-- different weekly offs and therefore different divisors.
--
-- Resolves the shift PER DAY, not once for the period: employee_shifts is effective-dated
-- (effective_from / effective_to), so an employee who moves from a six-day to a five-day
-- shift mid-month must be counted correctly on each side of the change. Taking one shift
-- for the whole period would silently misprice exactly the month in which a roster change
-- happened — the month most likely to be queried.
--
-- Fallback when an employee has no shift assignment at all is ARRAY[1,2,3,4,5,6], matching
-- both the hardcoded client behaviour and the COALESCE already used in
-- approve_leave_request(). Consistent by construction rather than by coincidence.
--
-- SECURITY DEFINER is required and deliberate: it reads `shifts` and `employee_shifts`
-- (attendance-gated) and `holidays`, and the whole point is that the calendar answers
-- correctly whatever the tenant's module mix. Definer bypasses RLS, so the tenant fence is
-- restored EXPLICITLY via can_access_tenant() below — without that this would be a
-- cross-tenant read, since p_tenant_id is caller-supplied.
--
-- The `auth.uid() IS NULL` arm is not a loophole. A session-less caller is already
-- project_admin — a migration, a cron job, a service-role edge function — which can read
-- every one of these tables directly, so admitting it here grants nothing it did not have.
-- Without that arm the calendar is unusable from exactly those contexts, which the
-- assertion at the bottom of this migration discovered by failing closed on its first run.
-- The same convention is already used by enforce_employee_update_restrictions().
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
      -- A holiday falling on a rest day is not subtracted twice: it was never a working day
      -- for this employee to begin with. The old client formula had to special-case
      -- "holidays not on Sunday" for exactly this reason; asking per-day removes the need.
      AND NOT EXISTS (
        SELECT 1 FROM public.holidays h
        WHERE h.tenant_id = p_tenant_id AND h.date = g.day::date
      )
  ) ELSE NULL END;
$function$;

REVOKE EXECUTE ON FUNCTION public.work_calendar_working_days(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.work_calendar_working_days(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.work_calendar_working_days(uuid, uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.work_calendar_working_days(uuid, uuid, date, date) IS
'Authoritative count of days an employee was expected to work in a period. Per employee, resolving the effective-dated shift PER DAY, minus holidays. Core infrastructure -- answers correctly regardless of module mix. Returns NULL if an authenticated caller cannot access the tenant; a session-less (project_admin) caller is allowed, since it can read the underlying tables anyway.';

-- ---------------------------------------------------------------------------
-- 3. The contract now sources working_days from the calendar
-- ---------------------------------------------------------------------------
-- payroll_period_input previously computed working_days itself as
-- days - sundays - non-sunday-holidays, tenant-wide. That was the second source of truth
-- for the same fact, and the one that ignored shifts. Replaced with a call to the calendar,
-- which also makes the figure per-employee.
--
-- Note this REMOVES payroll's dependency on the Leave module: holidays are core now, so
-- `attendance + payroll` without leave is a supported combination and no longer produces
-- holiday deductions. The frontend preflight is relaxed to match in the same commit.
--
-- Only the working_days and holidays_in_period expressions change; every other column and
-- the unknown-is-not-zero property are unchanged. Restated in full because the CTE that
-- computed sundays is now dead and leaving it would mislead.
CREATE OR REPLACE FUNCTION public.payroll_period_input(
  p_tenant_id    uuid,
  p_period_start date,
  p_period_end   date
)
 RETURNS TABLE (
   tenant_id              uuid,
   employee_id            uuid,
   period_start           date,
   period_end             date,
   days_in_period         integer,
   working_days           integer,
   holidays_in_period     integer,
   days_present           numeric,
   days_absent            numeric,
   half_days              numeric,
   paid_leave_days        numeric,
   unpaid_leave_days      numeric,
   late_mark_count        integer,
   overtime_hours         numeric,
   overtime_regular_hours numeric,
   has_attendance_anomaly boolean,
   source                 text
 )
 LANGUAGE sql
 STABLE
AS $function$
  WITH period AS (
    SELECT
      (p_period_end - p_period_start + 1)::integer AS days_in_period,
      (
        SELECT count(*)::integer
        FROM public.holidays h
        WHERE h.tenant_id = p_tenant_id
          AND h.date BETWEEN p_period_start AND p_period_end
      ) AS holiday_count
  ),
  leave_days AS (
    SELECT DISTINCT l.employee_id, d::date AS leave_date
    FROM public.leaves l
    JOIN public.leave_types lt ON lt.id = l.leave_type_id
    CROSS JOIN LATERAL generate_series(
      GREATEST(l.start_date, p_period_start),
      LEAST(l.end_date, p_period_end),
      interval '1 day'
    ) d
    WHERE l.tenant_id = p_tenant_id
      AND l.status = 'approved'
      AND lt.is_paid = false
      AND l.start_date <= p_period_end
      AND l.end_date   >= p_period_start
  ),
  att AS (
    SELECT
      a.employee_id,
      count(*) FILTER (WHERE a.status = 'present')   AS days_present,
      count(*) FILTER (WHERE a.status = 'absent')    AS days_absent,
      count(*) FILTER (WHERE a.status = 'half_day')  AS half_days,
      count(*) FILTER (
        WHERE a.status = 'on_leave'
          AND NOT EXISTS (
            SELECT 1 FROM leave_days ld
            WHERE ld.employee_id = a.employee_id AND ld.leave_date = a.date
          )
      )                                              AS paid_leave_days,
      count(*) FILTER (
        WHERE a.status = 'on_leave'
          AND EXISTS (
            SELECT 1 FROM leave_days ld
            WHERE ld.employee_id = a.employee_id AND ld.leave_date = a.date
          )
      )                                              AS unpaid_leave_days,
      count(*) FILTER (
        WHERE a.is_late AND a.status NOT IN ('absent', 'half_day')
      )                                              AS late_mark_count
    FROM public.attendance a
    WHERE a.tenant_id = p_tenant_id
      AND a.date BETWEEN p_period_start AND p_period_end
    GROUP BY a.employee_id
  ),
  ot AS (
    SELECT
      o.employee_id,
      COALESCE(sum(o.overtime_hours), 0) AS overtime_hours,
      COALESCE(sum(o.regular_hours), 0)  AS overtime_regular_hours
    FROM public.overtime_records o
    WHERE o.tenant_id = p_tenant_id
      AND o.approved
      AND o.date BETWEEN p_period_start AND p_period_end
    GROUP BY o.employee_id
  )
  SELECT
    p_tenant_id,
    att.employee_id,
    p_period_start,
    p_period_end,
    period.days_in_period,
    COALESCE(public.work_calendar_working_days(p_tenant_id, att.employee_id, p_period_start, p_period_end), 0),
    period.holiday_count,
    att.days_present::numeric,
    att.days_absent::numeric,
    att.half_days::numeric,
    att.paid_leave_days::numeric,
    att.unpaid_leave_days::numeric,
    att.late_mark_count::integer,
    COALESCE(ot.overtime_hours, 0)::numeric,
    COALESCE(ot.overtime_regular_hours, 0)::numeric,
    (att.days_present + att.days_absent + att.half_days
       + att.paid_leave_days + att.unpaid_leave_days)
      > COALESCE(public.work_calendar_working_days(p_tenant_id, att.employee_id, p_period_start, p_period_end), 0),
    'computed'::text
  FROM att
  CROSS JOIN period
  LEFT JOIN ot ON ot.employee_id = att.employee_id;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Prove the calendar reproduces the old formula on today's data
-- ---------------------------------------------------------------------------
-- The claim being tested is the one that matters: no payslip changes. For every employee
-- with attendance data, the new per-employee calendar must equal the old tenant-wide
-- formula (days - sundays - non-sunday holidays), because every shift is currently Mon-Sat.
-- If a shift is ever changed to a different pattern this assertion will start failing on a
-- replay, which is correct — at that point the numbers SHOULD differ.
DO $check$
DECLARE
  r          record;
  v_old      integer;
  v_new      integer;
  v_checked  integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT
      a.tenant_id,
      a.employee_id,
      date_trunc('month', a.date)::date AS period_start
    FROM public.attendance a
  LOOP
    v_old := (r.period_start + interval '1 month - 1 day')::date - r.period_start + 1
             - (SELECT count(*) FROM generate_series(r.period_start, (r.period_start + interval '1 month - 1 day')::date, interval '1 day') d
                WHERE EXTRACT(DOW FROM d) = 0)
             - (SELECT count(*) FROM public.holidays h
                WHERE h.tenant_id = r.tenant_id
                  AND h.date BETWEEN r.period_start AND (r.period_start + interval '1 month - 1 day')::date
                  AND EXTRACT(DOW FROM h.date) <> 0);

    v_new := public.work_calendar_working_days(
      r.tenant_id, r.employee_id, r.period_start, (r.period_start + interval '1 month - 1 day')::date);

    IF v_new IS DISTINCT FROM v_old THEN
      RAISE EXCEPTION 'work calendar changes pay: tenant % employee % period % -> old % vs new %. Every shift should be Mon-Sat today; investigate before applying.',
        r.tenant_id, r.employee_id, r.period_start, v_old, v_new;
    END IF;

    v_checked := v_checked + 1;
  END LOOP;

  RAISE NOTICE 'work calendar verified against the old formula on % employee-periods: identical', v_checked;
END
$check$;
