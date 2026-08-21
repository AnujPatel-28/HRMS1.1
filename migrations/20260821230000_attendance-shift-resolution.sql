-- B4 — shift resolution. Fills the columns B3 deliberately left NULL.
-- Authority: decision doc §2.5 (Frappe's shift_assignment.py, verified from source) and §5.1.
--
-- THE HARD PROBLEM, in the doc's own words: given a punch at 23:30 on the 5th, which shift
-- does it belong to? Get this wrong and every night shift is attributed to the wrong day,
-- which means the wrong working day, the wrong late mark, and eventually the wrong pay.
--
-- B3 left shift_start / shift_end / shift_actual_* NULL rather than guessing, precisely so
-- this algorithm could land in one place. This is that place.

-- ---------------------------------------------------------------------------
-- 1. The missing margin
-- ---------------------------------------------------------------------------
-- `punch_in_opens_minutes_before` exists (default 60); there is no counterpart for the other
-- end, so a punch-out after the scheduled end had no window to fall inside. Added
-- symmetrically. 60 minutes matches the in-margin's default, so no existing shift changes
-- shape relative to what an operator would already expect.
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS punch_out_closes_minutes_after integer NOT NULL DEFAULT 60;

-- ---------------------------------------------------------------------------
-- 2. attendance_resolve_shift(tenant, employee, event_time)
-- ---------------------------------------------------------------------------
-- Returns the shift a timestamp belongs to, with its scheduled and actual (margin-widened)
-- windows, or offshift = true when nothing claims it.
--
-- HOW IT WORKS
--   1. Convert the instant to the TENANT'S local date. shifts.start_time/end_time are
--      `time without time zone` — wall-clock, not UTC — so they only mean anything against
--      a timezone. tenants.timezone (default Asia/Kolkata) supplies it.
--   2. Consider THREE candidate dates: yesterday, today, tomorrow (local). A shift plus its
--      margins can spill into either neighbouring day, which is §2.5's ±1 day rule. A
--      23:30 punch may belong to a shift that started at 18:00 today, and a 02:00 punch may
--      belong to one that started at 18:00 YESTERDAY.
--   3. Cross-midnight: when end_time <= start_time the shift ends on the following day.
--   4. Widen by the margins to get the actual window.
--   5. Trim overlaps so two grace windows cannot both claim the same instant.
--   6. Take the earliest-starting window that contains the instant.
--
-- FALLBACK ORDER, per §2.5: explicit assignment -> the tenant's default shift -> offshift.
--
-- ⚠️ ONE DELIBERATE SIMPLIFICATION, stated rather than hidden.
-- §2.5's `_adjust_overlapping_shifts` is iterative: it walks the sorted list mutating each
-- neighbour in turn, so an adjustment can cascade through three or more overlapping shifts.
-- The window-function form below compares each candidate against its IMMEDIATE neighbours
-- only. For two overlapping shifts — the case the doc calls out, a 06:00-14:00 with a 60m
-- out-margin against a 14:00-22:00 with a 60m in-margin — it produces exactly the same
-- answer, because the scheduled boundary still wins over the margin. It would diverge only
-- with three or more mutually overlapping shifts on one day for one employee, which no
-- tenant here has (every employee has at most one assignment in force at a time). If
-- rotating rosters arrive (D3 calls them an extension point, not v1), revisit this.
CREATE OR REPLACE FUNCTION public.attendance_resolve_shift(
  p_tenant_id   uuid,
  p_employee_id uuid,
  p_event_time  timestamptz
)
 RETURNS TABLE (
   shift_id           uuid,
   shift_start        timestamptz,
   shift_end          timestamptz,
   shift_actual_start timestamptz,
   shift_actual_end   timestamptz,
   offshift           boolean
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tz         text;
  v_local_date date;
BEGIN
  SELECT COALESCE(t.timezone, 'Asia/Kolkata') INTO v_tz
  FROM public.tenants t WHERE t.id = p_tenant_id;

  IF v_tz IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz, true;
    RETURN;
  END IF;

  v_local_date := (p_event_time AT TIME ZONE v_tz)::date;

  RETURN QUERY
  WITH candidate_dates AS (
    SELECT d::date AS shift_date
    FROM generate_series(v_local_date - 1, v_local_date + 1, interval '1 day') d
  ),
  -- Explicit assignments first; the tenant default only if the employee has none in force.
  applicable_shifts AS (
    SELECT s.*, cd.shift_date, 1 AS priority
    FROM candidate_dates cd
    JOIN public.employee_shifts es
      ON es.tenant_id = p_tenant_id
     AND es.employee_id = p_employee_id
     AND es.effective_from <= cd.shift_date
     AND (es.effective_to IS NULL OR es.effective_to >= cd.shift_date)
    JOIN public.shifts s ON s.id = es.shift_id
    UNION ALL
    SELECT s.*, cd.shift_date, 2 AS priority
    FROM candidate_dates cd
    JOIN public.shifts s
      ON s.tenant_id = p_tenant_id AND s.is_default AND COALESCE(s.is_active, true)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.employee_shifts es2
      WHERE es2.tenant_id = p_tenant_id
        AND es2.employee_id = p_employee_id
        AND es2.effective_from <= cd.shift_date
        AND (es2.effective_to IS NULL OR es2.effective_to >= cd.shift_date)
    )
  ),
  windows AS (
    SELECT
      a.id AS s_id,
      a.priority,
      ((a.shift_date + a.start_time) AT TIME ZONE v_tz) AS s_start,
      CASE
        WHEN a.end_time > a.start_time
          THEN ((a.shift_date + a.end_time) AT TIME ZONE v_tz)
        ELSE ((a.shift_date + 1 + a.end_time) AT TIME ZONE v_tz)
      END AS s_end,
      COALESCE(a.punch_in_opens_minutes_before, 60)  AS in_margin,
      COALESCE(a.punch_out_closes_minutes_after, 60) AS out_margin
    FROM applicable_shifts a
  ),
  widened AS (
    SELECT
      w.*,
      w.s_start - make_interval(mins => w.in_margin)  AS a_start,
      w.s_end   + make_interval(mins => w.out_margin) AS a_end
    FROM windows w
  ),
  -- Trim so a grace window cannot reach into a neighbour's SCHEDULED time. The scheduled
  -- boundary wins over the margin, which is what makes the assignment deterministic.
  trimmed AS (
    SELECT
      t.s_id, t.priority, t.s_start, t.s_end,
      GREATEST(t.a_start, COALESCE(LAG(t.s_end)  OVER w, t.a_start)) AS a_start,
      LEAST   (t.a_end,   COALESCE(LEAD(t.s_start) OVER w, t.a_end))  AS a_end
    FROM widened t
    WINDOW w AS (ORDER BY t.a_start)
  )
  SELECT
    tr.s_id, tr.s_start, tr.s_end, tr.a_start, tr.a_end, false
  FROM trimmed tr
  WHERE p_event_time >= tr.a_start AND p_event_time <= tr.a_end
  ORDER BY tr.priority, tr.a_start
  LIMIT 1;

  -- Nothing claimed it: offshift, and excluded from derivation (§2.5).
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz, true;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.attendance_resolve_shift(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attendance_resolve_shift(uuid, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.attendance_resolve_shift(uuid, uuid, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ingest now stamps the resolved window
-- ---------------------------------------------------------------------------
-- B3's ingest set shift_id from the effective-dated assignment and left the windows NULL.
-- It now calls the resolver, so every event lands with its grouping key populated —
-- shift_start is what the processor groups by in B5, and night shifts depend on it.
CREATE OR REPLACE FUNCTION public.attendance_event_ingest(
  p_tenant_id       uuid,
  p_employee_id     uuid,
  p_event_time      timestamptz,
  p_direction       text DEFAULT NULL,
  p_source          text DEFAULT 'app',
  p_source_ref      text DEFAULT NULL,
  p_attendance_id   uuid DEFAULT NULL,
  p_lat             numeric DEFAULT NULL,
  p_lng             numeric DEFAULT NULL,
  p_location_accuracy numeric DEFAULT NULL,
  p_location_status text DEFAULT NULL,
  p_selfie_id       uuid DEFAULT NULL,
  p_evidence        jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id  uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event_id uuid;
  v_creator  uuid;
  v_r        record;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible';
  END IF;

  SELECT * INTO v_r
  FROM public.attendance_resolve_shift(p_tenant_id, p_employee_id, p_event_time);

  SELECT id INTO v_creator FROM public.employees
   WHERE user_id = (SELECT auth.uid()) AND tenant_id = p_tenant_id;

  INSERT INTO public.attendance_events (
    tenant_id, employee_id, event_time, direction, source, source_ref,
    shift_id, shift_start, shift_end, shift_actual_start, shift_actual_end, offshift,
    attendance_id, lat, lng, location_accuracy, location_status,
    selfie_id, evidence, idempotency_key, correlation_id, created_by
  ) VALUES (
    p_tenant_id, p_employee_id, p_event_time, p_direction, p_source, p_source_ref,
    v_r.shift_id, v_r.shift_start, v_r.shift_end, v_r.shift_actual_start, v_r.shift_actual_end,
    COALESCE(v_r.offshift, true),
    p_attendance_id, p_lat, p_lng, p_location_accuracy, p_location_status,
    p_selfie_id, p_evidence, p_idempotency_key, p_correlation_id, v_creator
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Backfill events written by B3
-- ---------------------------------------------------------------------------
-- Small today (B3 shipped hours ago) but the log is append-only, so a half-resolved log
-- would stay half-resolved forever unless it is repaired here.
-- The resolver is LATERAL over a subquery rather than over the UPDATE target: an UPDATE's
-- target table is not in scope for a LATERAL in its own FROM clause.
UPDATE public.attendance_events e
SET shift_id           = x.shift_id,
    shift_start        = x.shift_start,
    shift_end          = x.shift_end,
    shift_actual_start = x.shift_actual_start,
    shift_actual_end   = x.shift_actual_end,
    offshift           = COALESCE(x.offshift, true)
FROM (
  SELECT ev.id AS event_id, r.*
  FROM public.attendance_events ev
  CROSS JOIN LATERAL public.attendance_resolve_shift(ev.tenant_id, ev.employee_id, ev.event_time) r
  WHERE ev.shift_start IS NULL
) x
WHERE e.id = x.event_id;

-- ---------------------------------------------------------------------------
-- 5. Prove it, including the case that motivates the whole algorithm
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_tenant uuid;
  v_emp    uuid;
  v_shift  uuid;
  v_from   date;
  v_r      record;
  v_tz     text;
BEGIN
  -- Find any cross-midnight shift that is actually ASSIGNED to someone, and test against
  -- that assignment's own effective window. The first version of this check hardcoded a
  -- date and failed -- correctly -- because the only night-shift assignment in this database
  -- lasted a single day in May, and on the hardcoded August date the employee was on a
  -- morning shift, so `offshift` was the right answer. Derive the date from the data.
  SELECT es.tenant_id, es.employee_id, s.id, es.effective_from
    INTO v_tenant, v_emp, v_shift, v_from
  FROM public.employee_shifts es
  JOIN public.shifts s ON s.id = es.shift_id
  WHERE s.end_time < s.start_time
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_shift IS NULL THEN
    RAISE NOTICE 'shift resolution: no assigned cross-midnight shift to test against, skipped';
    RETURN;
  END IF;

  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants WHERE id = v_tenant;

  -- THE CASE THE ALGORITHM EXISTS FOR: 02:00 belongs to the shift that started the PREVIOUS
  -- EVENING, not to anything starting that morning.
  SELECT * INTO v_r FROM public.attendance_resolve_shift(
    v_tenant, v_emp, ((v_from + 1) + TIME '02:00') AT TIME ZONE v_tz);

  IF v_r.offshift THEN
    RAISE EXCEPTION 'a 02:00 punch on the day after a night shift resolved as offshift — cross-midnight resolution is broken';
  END IF;

  IF (v_r.shift_start AT TIME ZONE v_tz)::date <> v_from THEN
    RAISE EXCEPTION 'a 02:00 punch grouped to shift_start % — expected the previous evening (%)',
      (v_r.shift_start AT TIME ZONE v_tz)::date, v_from;
  END IF;

  IF EXTRACT(EPOCH FROM (v_r.shift_end - v_r.shift_start)) / 3600.0 <> 11 THEN
    RAISE EXCEPTION 'night shift span is % hours, expected 11',
      EXTRACT(EPOCH FROM (v_r.shift_end - v_r.shift_start)) / 3600.0;
  END IF;

  IF v_r.shift_actual_start >= v_r.shift_start OR v_r.shift_actual_end <= v_r.shift_end THEN
    RAISE EXCEPTION 'margins were not applied: actual window is not wider than scheduled';
  END IF;

  -- And the converse: a punch in the middle of the following AFTERNOON must NOT be claimed
  -- by that night shift. Without this, a resolver that simply returns the first candidate
  -- would pass the test above while being wrong.
  SELECT * INTO v_r FROM public.attendance_resolve_shift(
    v_tenant, v_emp, ((v_from + 1) + TIME '14:00') AT TIME ZONE v_tz);

  IF NOT v_r.offshift AND v_r.shift_id = v_shift THEN
    RAISE EXCEPTION 'a 14:00 punch was claimed by the night shift — the actual window is too wide';
  END IF;

  RAISE NOTICE 'shift resolution verified: 02:00 groups to the previous evening, 11h span, margins applied, 14:00 not claimed';
END
$check$;
