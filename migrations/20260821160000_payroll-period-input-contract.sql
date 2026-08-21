-- The inter-module contract: what payroll consumes from attendance and leave.
--
-- ONE seam, THREE consumers:
--   1. Internal   — RunPayroll reads this instead of five raw tables.
--   2. Export     — a tenant running their OWN payroll gets this as CSV.
--   3. Import     — a tenant using their OWN attendance system feeds this shape back in,
--                   and our payroll runs off it unchanged.
--
-- Defining it now, before attendance is rebuilt, is the point. A CSV export IS a published
-- interface the moment a tenant's payroll consumes it; derived from an explicit contract it
-- stays stable, invented ad hoc at export time it becomes an accidental one nobody can
-- change. The field list below is derived from what RunPayroll.tsx and payroll-calc.ts
-- actually use today, not from imagination.
--
-- ============================================================================
-- THE GOVERNING PRINCIPLE: THIS CARRIES FACTS, NOT POLICY
-- ============================================================================
-- Facts cross the seam. Policy stays with the consumer.
--
--   crosses:  overtime HOURS, late-mark COUNT, day counts by status
--   does not: overtime AMOUNT, late-mark DEDUCTION, LOP amount, the anomaly
--             normalization rule, the late-mark threshold
--
-- Anything requiring a salary, a rate, or a tenant policy setting is payroll's business. If
-- amounts crossed this seam, a tenant feeding us their own attendance CSV would have to
-- reproduce our pay rules to fill in the columns — which defeats the purpose. Facts are
-- things their system already knows.
--
-- ============================================================================
-- UNKNOWN IS NOT ZERO — THE MOST IMPORTANT PROPERTY HERE
-- ============================================================================
-- An employee with NO attendance rows in the period gets NO ROW from this function. They do
-- NOT get a row of zeros.
--
-- That distinction is the whole reason this exists. Treating an empty result as a real zero
-- is what made payroll pay every employee zero when attendance was disabled, and what
-- charged employees for public holidays when leave was disabled. `days_present = 0` means
-- "we know they were present zero days". No row means "we do not know". A consumer MUST
-- handle the second case by refusing to compute, never by substituting the first.
--
-- This is also why the module preflight in RunPayroll stays IN FRONT of this function
-- rather than being replaced by it: a query cannot distinguish "module disabled" from
-- "genuinely no data", and those need different messages to the user.

-- ---------------------------------------------------------------------------
-- payroll_period_input(tenant, period_start, period_end)
-- ---------------------------------------------------------------------------
-- A function rather than a view because the shape is inherently parameterized by period; a
-- bare view would have to materialise every month that ever existed.
--
-- SECURITY INVOKER (the default, stated here deliberately): tenant isolation and module
-- entitlement then come from the existing RLS on `attendance`, `leaves` and `holidays` for
-- free. Making it DEFINER would bypass all 34 module_enabled_* RESTRICTIVE policies —
-- tables are owned by project_admin with relforcerowsecurity = false, and Postgres exempts
-- an owner from its own RLS — and this function must not become another hole of that kind.
--
-- Period bounds are INCLUSIVE at both ends, matching the gte/lte the client already uses.
-- Any CSV import must validate the same way or a boundary day silently moves.
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
      -- Non-Sunday holidays in range. Counted separately so working_days below stays
      -- readable and so the count itself can be shown to a user for parity checking.
      (
        SELECT count(*)::integer
        FROM public.holidays h
        WHERE h.tenant_id = p_tenant_id
          AND h.date BETWEEN p_period_start AND p_period_end
          AND EXTRACT(DOW FROM h.date) <> 0
      ) AS holiday_count,
      -- Sundays in range.
      (
        SELECT count(*)::integer
        FROM generate_series(p_period_start, p_period_end, interval '1 day') d
        WHERE EXTRACT(DOW FROM d) = 0
      ) AS sunday_count
  ),
  -- ⚠️ KNOWN LIMITATION, replicated deliberately rather than fixed here.
  -- working_days hardcodes SUNDAY as the only weekly off, exactly as getWorkingDays() does
  -- in payroll-calc.ts. It ignores `shifts.working_days`, so a tenant on a Fri/Sat weekend,
  -- a six-day week, or per-employee rosters gets the wrong denominator — and this figure
  -- divides gross pay, so the error is monetary.
  --
  -- Not corrected in this migration because changing it would silently alter live payslip
  -- amounts. It is the strongest argument for extracting a shared Work Calendar (shifts +
  -- week-off pattern + holidays + timezone) as core infrastructure: this contract keeps its
  -- shape when that lands, and only the computation behind working_days changes.
  leave_days AS (
    -- Which on_leave dates are UNPAID, resolved through leave_types.is_paid rather than the
    -- leave_type text. The literal string 'unpaid' in leaves.leave_type is NOT consulted for
    -- pay anywhere, and must not start being consulted here.
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
      count(*) FILTER (WHERE a.status = 'present')                        AS days_present,
      count(*) FILTER (WHERE a.status = 'absent')                         AS days_absent,
      count(*) FILTER (WHERE a.status = 'half_day')                       AS half_days,
      -- An on_leave day with no matching UNPAID leave row counts as PAID. This preserves
      -- today's behaviour exactly, including its weak spot: an on_leave day with no `leaves`
      -- row AT ALL also lands here as paid. Preserved rather than tightened because changing
      -- it moves money; flagged so the next reader knows it is a default, not a derivation.
      count(*) FILTER (
        WHERE a.status = 'on_leave'
          AND NOT EXISTS (
            SELECT 1 FROM leave_days ld
            WHERE ld.employee_id = a.employee_id AND ld.leave_date = a.date
          )
      )                                                                   AS paid_leave_days,
      count(*) FILTER (
        WHERE a.status = 'on_leave'
          AND EXISTS (
            SELECT 1 FROM leave_days ld
            WHERE ld.employee_id = a.employee_id AND ld.leave_date = a.date
          )
      )                                                                   AS unpaid_leave_days,
      -- Raw count only. The threshold and the per-unit deduction hours are tenant POLICY and
      -- stay with the consumer, per the governing principle above.
      count(*) FILTER (
        WHERE a.is_late AND a.status NOT IN ('absent', 'half_day')
      )                                                                   AS late_mark_count
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
    GREATEST(period.days_in_period - period.sunday_count - period.holiday_count, 0)::integer,
    period.holiday_count,
    att.days_present::numeric,
    att.days_absent::numeric,
    att.half_days::numeric,
    att.paid_leave_days::numeric,
    att.unpaid_leave_days::numeric,
    att.late_mark_count::integer,
    COALESCE(ot.overtime_hours, 0)::numeric,
    COALESCE(ot.overtime_regular_hours, 0)::numeric,
    -- Reported, never applied. payroll-calc.ts normalizes over-counted days silently and
    -- then DROPS the flag before the payslip is written, so an impossible timesheet leaves
    -- no trace on the record it produced. Surfacing it here gives the consumer — ours or a
    -- tenant's own payroll — the chance to refuse or to flag rather than quietly absorb it.
    (att.days_present + att.days_absent + att.half_days
       + att.paid_leave_days + att.unpaid_leave_days)
      > GREATEST(period.days_in_period - period.sunday_count - period.holiday_count, 0),
    -- Provenance. 'computed' = derived from attendance rows in this system. When CSV import
    -- lands, imported periods carry 'imported' and payroll treats them identically. Present
    -- from day one because retrofitting provenance means backfilling every row and touching
    -- every consumer.
    'computed'::text
  FROM att
  CROSS JOIN period
  LEFT JOIN ot ON ot.employee_id = att.employee_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.payroll_period_input(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.payroll_period_input(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.payroll_period_input(uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.payroll_period_input(uuid, date, date) IS
'Inter-module contract: the per-employee, per-period attendance and leave facts payroll consumes. Carries FACTS, not policy (hours and counts, never amounts or thresholds). No row = no data, which is NOT the same as a row of zeros; consumers must refuse to compute rather than substitute zero. Bounds inclusive. Also the shape of the CSV export/import used to interoperate with a tenant''s own attendance or payroll system.';

-- ---------------------------------------------------------------------------
-- Prove it reproduces what RunPayroll computes today
-- ---------------------------------------------------------------------------
-- Run as project_admin, which bypasses RLS, so this checks the ARITHMETIC against the raw
-- tables. It does not and cannot check the RLS path — that needs a real session.
DO $check$
DECLARE
  v_tenant uuid;
  v_start  date;
  v_end    date;
  v_rows   int;
  v_direct int;
BEGIN
  SELECT a.tenant_id, date_trunc('month', a.date)::date
    INTO v_tenant, v_start
  FROM public.attendance a
  GROUP BY 1, 2
  ORDER BY count(*) DESC
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE NOTICE 'payroll_period_input: no attendance rows anywhere, arithmetic check skipped';
    RETURN;
  END IF;

  v_end := (v_start + interval '1 month - 1 day')::date;

  SELECT count(*) INTO v_rows
  FROM public.payroll_period_input(v_tenant, v_start, v_end);

  -- One row per employee who has ANY attendance row in the period, and no others.
  SELECT count(DISTINCT a.employee_id) INTO v_direct
  FROM public.attendance a
  WHERE a.tenant_id = v_tenant AND a.date BETWEEN v_start AND v_end;

  IF v_rows <> v_direct THEN
    RAISE EXCEPTION 'payroll_period_input returned % rows, expected % (one per employee with attendance data)', v_rows, v_direct;
  END IF;

  -- Day counts must reconcile to the raw row count exactly: every attendance row lands in
  -- exactly one bucket. A mismatch means a status value exists that the CASE arms miss.
  PERFORM 1
  FROM public.payroll_period_input(v_tenant, v_start, v_end) i
  JOIN (
    SELECT a.employee_id, count(*) AS n
    FROM public.attendance a
    WHERE a.tenant_id = v_tenant AND a.date BETWEEN v_start AND v_end
    GROUP BY 1
  ) raw ON raw.employee_id = i.employee_id
  WHERE raw.n <> (i.days_present + i.days_absent + i.half_days
                  + i.paid_leave_days + i.unpaid_leave_days);

  IF FOUND THEN
    RAISE EXCEPTION 'payroll_period_input day buckets do not reconcile to raw attendance row counts — an unhandled status value exists';
  END IF;

  RAISE NOTICE 'payroll_period_input verified: % employee rows for % .. %', v_rows, v_start, v_end;
END
$check$;
