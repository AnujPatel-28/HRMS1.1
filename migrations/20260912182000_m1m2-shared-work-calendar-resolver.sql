-- migration: P2-01 -- consolidate the shared tenant date/calendar primitive
-- Source: prompts/p2-01_work_calendar_resolver_2026-09-14.md
--
-- Consolidation, not a rebuild. tenant_business_date / work_calendar_holiday /
-- work_calendar_working_days already exist on the branch (see 20260821180000,
-- 20260824110000, 20260828110000). This migration:
--
--   1. Fixes the one real defect: tenant_business_date was gated on the `attendance` module,
--      so any tenant with Attendance disabled (a Leave-only fixture, per contracts.md S12.7)
--      got NULL for every business date. work_calendar_holiday and work_calendar_working_days
--      were never gated on any module. That was an *inconsistency*, not two valid designs.
--
--      Decision (stated, not incidental): this primitive set is infrastructure. It is gated on
--      tenant access only (can_access_tenant), never on module entitlement. Consumers own their
--      own module gating -- attendance_run_scheduled_derivation already filters its tenant loop
--      on tenant_has_module_for(..., 'attendance') before it ever calls tenant_business_date, so
--      dropping the redundant gate inside the primitive changes nothing for that caller. The
--      `work_calendar` module key in public.modules governs the Shift/Calendar/Holiday *UI*
--      (ShiftManagement.tsx, Calendar.tsx, HolidayList.tsx), not this DB-level resolver -- those
--      screens already gate themselves; the resolver underneath them must not also gate, or a
--      Leave-only or Projects-only tenant loses correct business dates for no reason.
--
--      This is a BODY-ONLY CREATE OR REPLACE on the exact existing (uuid, timestamptz) signature
--      -- deliberately. An earlier draft of this migration added an optional trailing
--      p_employee_id parameter (see item 2 below, "REJECTED"), on the assumption that
--      CREATE OR REPLACE FUNCTION with only an appended DEFAULT argument replaces the function
--      in place. Verified empirically against this database before applying anything (two probe
--      functions, `a int` then `a int, b int DEFAULT 0`): Postgres resolves function identity by
--      name *and* input argument types, so this created a SECOND function
--      (`_p2_probe(int)` and `_p2_probe(int,int)` both existed, count=2) rather than replacing
--      the first. Applied to tenant_business_date that would have left the attendance-gated
--      2-arg function live -- still called by attendance_run_scheduled_derivation's exact
--      2-positional-arg call and possibly by PostgREST's ambiguous resolution of the frontend's
--      named-arg call -- while a new, ungated 3-arg function also existed. Two sources of
--      business date, disagreeing silently: exactly the failure this consolidation exists to
--      prevent. The brief's own constraint (S6, "CREATE OR REPLACE cannot change a signature")
--      was correct as written; this comment records why it mattered concretely, not just as a
--      rule to take on faith.
--
--   2. REJECTED: extending tenant_business_date additively with an optional p_employee_id to
--      resolve a multi-location tenant's timezone from the employee's location (S3.1). Not done
--      here -- see item 1. Recorded instead as a known limitation, owner P1-03/P2-02 (the next
--      lanes consuming this primitive): tenant_business_date resolves one timezone per tenant
--      (tenants.timezone) even though public.locations.timezone exists and a tenant can have
--      offices in more than one zone; an employee in a non-default-timezone location gets a
--      business date computed against the wrong zone. Fixing this correctly needs a NEW function
--      (not a signature change to this one) plus a migration of the one caller that would adopt
--      it -- PunchInOut.tsx currently calls tenant_business_date(p_tenant_id) with no employee
--      context. Left as a new-function-plus-caller-migration decision for whichever lane needs
--      location grain, not invented here.
--
--   3. Documents, via COMMENT ON FUNCTION, what was previously only implicit:
--        - the module-gating decision above;
--        - the auth.uid() IS NULL branch is a deliberate service-context escape for
--          SECURITY DEFINER callers running with no JWT (background/scheduled jobs such as
--          attendance_run_scheduled_derivation's internal PERFORMs); anon is never granted
--          EXECUTE on any of the three, so this is not an anon hole;
--        - the three-tier holiday precedence work_calendar_holiday already implements:
--          shift-assigned holiday_calendar_days (source='shift') beats employee-assigned
--          holiday_calendar_days (source='employee') beats the tenant-default `holidays` table
--          (source='tenant_default'). `holidays` is not legacy and is not being replaced here.
--
-- tenant_business_date below is the exact live pg_get_functiondef() output with only the module
-- gate clause removed; no other statement changed. work_calendar_holiday and
-- work_calendar_working_days are untouched (comment-only, same signatures as live).
--
-- No BEGIN/COMMIT here: the CLI wraps each migration in its own transaction.

CREATE OR REPLACE FUNCTION public.tenant_business_date(p_tenant_id uuid, p_instant timestamp with time zone DEFAULT now())
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL OR (SELECT public.can_access_tenant(p_tenant_id))
    THEN (
      SELECT (p_instant AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date
      FROM public.tenants t
      WHERE t.id = p_tenant_id
    )
    ELSE NULL
  END;
$function$;

REVOKE ALL ON FUNCTION public.tenant_business_date(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_business_date(uuid, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.work_calendar_holiday(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_calendar_holiday(uuid, uuid, date) TO authenticated;

REVOKE ALL ON FUNCTION public.work_calendar_working_days(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_calendar_working_days(uuid, uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.tenant_business_date(uuid, timestamptz) IS
  'P2-01 shared tenant business-date primitive. Infrastructure: gated on tenant access '
  '(can_access_tenant) only, never on module entitlement -- every consuming module enforces its '
  'own state; do not add a tenant_has_module_for(...) check here. auth.uid() IS NULL is a '
  'deliberate service-context escape for SECURITY DEFINER callers with no JWT (scheduled/'
  'background jobs); anon holds no EXECUTE, so this is not reachable unauthenticated. DST: '
  'correct by construction -- the input is an unambiguous timestamptz instant, and AT TIME ZONE '
  'on an instant never hits the local-wall-clock ambiguity/gap that only exists converting the '
  'other direction (local time -> instant). Known limitation, owner P1-03/P2-02: resolves one '
  'timezone per tenant (tenants.timezone); does not consider a multi-location tenant''s '
  'per-employee locations.timezone. Fixing that is a new function plus a caller migration, not a '
  'signature change to this one -- see migration header for why an additive parameter was '
  'rejected here.';

COMMENT ON FUNCTION public.work_calendar_holiday(uuid, uuid, date) IS
  'P2-01 shared holiday primitive. Infrastructure: gated on tenant access (can_access_tenant) '
  'only, never on module entitlement -- see tenant_business_date comment for why. Three-tier '
  'precedence, most specific wins: (1) source=''shift'' -- the employee''s effective shift has '
  'shifts.holiday_calendar_id set and holiday_calendar_days has a row for the date; (2) '
  'source=''employee'' -- no shift-tier hit, but employees.holiday_calendar_id is set and '
  'holiday_calendar_days has a row for the date; (3) source=''tenant_default'' -- no named-'
  'calendar hit at either tier, fall back to the tenant-default public.holidays table. '
  'public.holidays is not legacy: it is tier 3 of this resolver, not a table being replaced by '
  'holiday_calendars/holiday_calendar_days, and most populated tenants use it exclusively. '
  'auth.uid() IS NULL is the same deliberate service-context escape as tenant_business_date.';

COMMENT ON FUNCTION public.work_calendar_working_days(uuid, uuid, date, date) IS
  'P2-01 shared working-day-count primitive. Infrastructure: gated on tenant access '
  '(can_access_tenant) only, never on module entitlement -- see tenant_business_date comment. '
  'Counts dates in [p_start, p_end] whose DOW is in the employee''s effective shift.working_days '
  '(default ARRAY[1,2,3,4,5,6], i.e. Mon-Sat, when no shift assignment resolves) and which '
  'work_calendar_holiday does not report as a holiday for that employee/date -- a half-day '
  'holiday is excluded exactly like a full holiday at this binary in/out grain. auth.uid() IS '
  'NULL is the same deliberate service-context escape as tenant_business_date.';
