-- B2 — close C1 (client-policy payroll vector) and C3 (missing ownership check).
-- Authority: `new update doc/attendance_shift_v2_decision_doc.md` §8, which says ship this FIRST.
--
-- ============================================================================
-- C1 — WHAT THE HOLE IS
-- ============================================================================
-- punch_out_attendance is SECURITY DEFINER, granted to `authenticated`, and takes
-- p_overtime_enabled, p_overtime_rate, p_expected_shift_hours and p_lunch_minutes FROM THE
-- BROWSER. They are not vestigial — the body uses them:
--
--   IF p_overtime_enabled THEN
--     v_overtime_hours := ROUND(GREATEST(0, v_work_hours - p_expected_shift_hours), 2);
--     INSERT INTO overtime_records (..., p_overtime_rate, v_overtime_hours * p_overtime_rate, false);
--
-- Post `p_expected_shift_hours: 0, p_overtime_rate: 10` and a fabricated overtime amount
-- lands in a payroll table. It is inserted with approved = false, so HR approval still
-- stands between it and a payout — but nothing marks the numbers as client-asserted, so they
-- look entirely ordinary in the approval queue.
--
-- This now matters more than it did: payroll_period_input (20260821160000) sums
-- overtime_records into overtime_hours. Wiring payroll to that contract while this hole is
-- open would point the new authoritative seam at a table any authenticated user can poison.
-- B2 comes first for that reason, not merely because it is a security fix.
--
-- ============================================================================
-- THIS IS A FAITHFUL MOVE, NOT A REDESIGN
-- ============================================================================
-- Every value the client posts is already derived from server data the client had just read
-- (PunchInOut.tsx:795-806):
--
--   overtime_enabled      <- tenant_settings.overtime_enabled
--   overtime_rate         <- tenant_settings.overtime_rate            (default 1.5)
--   lunch_minutes         <- tenants.lunch_break_minutes              (column default 60)
--   expected_shift_hours  <- (shift end - shift start) - lunch, else tenants.work_hours_per_day
--
-- The client was doing arithmetic on server data and posting the result. Recomputing it here
-- reproduces the same numbers from the same sources — the difference is that they can no
-- longer be replaced in transit. The cross-midnight branch below mirrors the client's
-- `(24*60 - startMin) + endMin` exactly, so night shifts keep the same expected hours.
--
-- ============================================================================
-- SEQUENCING — THIS MIGRATION IS ADDITIVE ON PURPOSE
-- ============================================================================
-- It creates a SIX-argument overload beside the existing ten-argument function; it does not
-- drop anything. PostgREST resolves RPCs by named argument, so dropping parameters breaks
-- every deployed client the instant it applies — the rule this project learned from
-- employees.role and from create_draft_employee. Order is therefore:
--
--   1. this migration            (both signatures live, nothing breaks)
--   2. frontend posts six args, pushed, deploy VERIFIED live by marker string
--   3. a later migration drops the ten-argument version
--
-- Overloading the same name rather than inventing punch_out_attendance_v2 means the end
-- state is one correctly-named function with no version suffix to carry forever. The two
-- argument sets are disjoint, so PostgREST cannot resolve ambiguously between them.

DO $mig$
DECLARE
  v_def  text;
  v_new  text;
  v_hits int;

  c_sig_old CONSTANT text :=
    'CREATE OR REPLACE FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_lunch_minutes integer, p_overtime_enabled boolean, p_overtime_rate numeric, p_expected_shift_hours numeric)';
  c_sig_new CONSTANT text :=
    'CREATE OR REPLACE FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text)';

  c_decl_anchor CONSTANT text := '  v_deduction_mode    text;';
  c_decl_new CONSTANT text :=
    '  v_deduction_mode    text;' || chr(10) ||
    '  -- Derived server-side by B2. Formerly supplied by the browser (finding C1).' || chr(10) ||
    '  v_lunch_minutes        integer;' || chr(10) ||
    '  v_overtime_enabled     boolean;' || chr(10) ||
    '  v_overtime_rate        numeric;' || chr(10) ||
    '  v_expected_shift_hours numeric;' || chr(10) ||
    '  v_ot_enabled_txt       text;' || chr(10) ||
    '  v_ot_rate_txt          text;' || chr(10) ||
    '  v_shift_start          time;' || chr(10) ||
    '  v_shift_end            time;' || chr(10) ||
    '  v_shift_minutes        numeric;' || chr(10) ||
    '  v_caller_employee      uuid;';

  c_tenant_anchor CONSTANT text := '  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;';
  c_tenant_new CONSTANT text :=
    '  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;' || chr(10) ||
    chr(10) ||
    '  -- ── 1b. OWNERSHIP (finding C3) ─────────────────────────────────────────────' || chr(10) ||
    '  -- The lock above scopes by tenant but never checked WHOSE session this is, so any' || chr(10) ||
    '  -- authenticated user in the tenant could close a colleague''s day. HR is allowed —' || chr(10) ||
    '  -- closing a forgotten punch-out is a real HR task. A session-less caller is' || chr(10) ||
    '  -- project_admin (migration/cron/service role) and is likewise allowed.' || chr(10) ||
    '  IF (SELECT auth.uid()) IS NOT NULL THEN' || chr(10) ||
    '    SELECT id INTO v_caller_employee FROM public.employees' || chr(10) ||
    '     WHERE user_id = (SELECT auth.uid()) AND tenant_id = p_tenant_id;' || chr(10) ||
    '    IF v_attendance.employee_id IS DISTINCT FROM v_caller_employee' || chr(10) ||
    '       AND NOT (SELECT public.is_hr()) THEN' || chr(10) ||
    '      RAISE EXCEPTION ''NOT_YOUR_ATTENDANCE''' || chr(10) ||
    '        USING ERRCODE = ''P0004'',' || chr(10) ||
    '              DETAIL  = ''This attendance session belongs to another employee.'';' || chr(10) ||
    '    END IF;' || chr(10) ||
    '  END IF;' || chr(10) ||
    chr(10) ||
    '  -- ── 1c. DERIVE POLICY SERVER-SIDE (finding C1) ─────────────────────────────' || chr(10) ||
    '  -- Same sources the client read; the client simply no longer gets to alter them.' || chr(10) ||
    '  v_lunch_minutes := COALESCE(v_tenant.lunch_break_minutes, 60);' || chr(10) ||
    chr(10) ||
    '  SELECT value INTO v_ot_enabled_txt FROM tenant_settings' || chr(10) ||
    '   WHERE tenant_id = p_tenant_id AND key = ''overtime_enabled'';' || chr(10) ||
    '  v_overtime_enabled := COALESCE(v_ot_enabled_txt, ''false'') = ''true'';' || chr(10) ||
    chr(10) ||
    '  SELECT value INTO v_ot_rate_txt FROM tenant_settings' || chr(10) ||
    '   WHERE tenant_id = p_tenant_id AND key = ''overtime_rate'';' || chr(10) ||
    '  v_overtime_rate := COALESCE(NULLIF(v_ot_rate_txt, '''')::numeric, 1.5);' || chr(10) ||
    chr(10) ||
    '  -- The shift in force ON THE ATTENDANCE DATE, not today: a punch-out completed after a' || chr(10) ||
    '  -- roster change must be measured against the shift actually worked.' || chr(10) ||
    '  SELECT s.start_time, s.end_time INTO v_shift_start, v_shift_end' || chr(10) ||
    '    FROM public.employee_shifts es' || chr(10) ||
    '    JOIN public.shifts s ON s.id = es.shift_id' || chr(10) ||
    '   WHERE es.tenant_id = p_tenant_id' || chr(10) ||
    '     AND es.employee_id = v_attendance.employee_id' || chr(10) ||
    '     AND es.effective_from <= v_attendance.date' || chr(10) ||
    '     AND (es.effective_to IS NULL OR es.effective_to >= v_attendance.date)' || chr(10) ||
    '   ORDER BY es.effective_from DESC LIMIT 1;' || chr(10) ||
    chr(10) ||
    '  IF v_shift_start IS NOT NULL THEN' || chr(10) ||
    '    -- Cross-midnight mirrors the client formula (24*60 - startMin) + endMin exactly.' || chr(10) ||
    '    v_shift_minutes := CASE' || chr(10) ||
    '      WHEN v_shift_end >= v_shift_start' || chr(10) ||
    '        THEN EXTRACT(EPOCH FROM (v_shift_end - v_shift_start)) / 60.0' || chr(10) ||
    '      ELSE 1440 - (EXTRACT(EPOCH FROM (v_shift_start - v_shift_end)) / 60.0)' || chr(10) ||
    '    END;' || chr(10) ||
    '    v_expected_shift_hours := ROUND((v_shift_minutes - v_lunch_minutes) / 60.0, 2);' || chr(10) ||
    '  ELSE' || chr(10) ||
    '    v_expected_shift_hours := COALESCE(v_tenant.work_hours_per_day, 8);' || chr(10) ||
    '  END IF;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'punch_out_attendance'
    AND p.pronargs = 10;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'the 10-argument punch_out_attendance was not found — has B2 already run?';
  END IF;

  -- Assert the exact shape audited before rewriting anything. Every count below was taken
  -- from the live body; a mismatch means the function drifted and must be re-audited rather
  -- than blindly transformed.
  IF (length(v_def) - length(replace(v_def, c_sig_old, ''))) / length(c_sig_old) <> 1 THEN
    RAISE EXCEPTION 'punch_out_attendance signature is not the audited one';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_decl_anchor, ''))) / length(c_decl_anchor) <> 1 THEN
    RAISE EXCEPTION 'DECLARE anchor v_deduction_mode not found exactly once';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_tenant_anchor, ''))) / length(c_tenant_anchor) <> 1 THEN
    RAISE EXCEPTION 'tenant-load anchor not found exactly once';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, 'p_lunch_minutes', ''))) / length('p_lunch_minutes');
  IF v_hits <> 4 THEN RAISE EXCEPTION 'expected 4 p_lunch_minutes, found %', v_hits; END IF;
  v_hits := (length(v_def) - length(replace(v_def, 'p_overtime_enabled', ''))) / length('p_overtime_enabled');
  IF v_hits <> 2 THEN RAISE EXCEPTION 'expected 2 p_overtime_enabled, found %', v_hits; END IF;
  v_hits := (length(v_def) - length(replace(v_def, 'p_overtime_rate', ''))) / length('p_overtime_rate');
  IF v_hits <> 3 THEN RAISE EXCEPTION 'expected 3 p_overtime_rate, found %', v_hits; END IF;
  v_hits := (length(v_def) - length(replace(v_def, 'p_expected_shift_hours', ''))) / length('p_expected_shift_hours');
  IF v_hits <> 3 THEN RAISE EXCEPTION 'expected 3 p_expected_shift_hours, found %', v_hits; END IF;

  -- Transform. Signature first so its own parameter names are gone before the body-wide
  -- substitutions run; otherwise the substitutions would rewrite the signature too.
  v_new := replace(v_def,  c_sig_old,       c_sig_new);
  v_new := replace(v_new,  c_decl_anchor,   c_decl_new);
  v_new := replace(v_new,  c_tenant_anchor, c_tenant_new);
  v_new := replace(v_new,  'p_lunch_minutes',        'v_lunch_minutes');
  v_new := replace(v_new,  'p_overtime_enabled',     'v_overtime_enabled');
  v_new := replace(v_new,  'p_overtime_rate',        'v_overtime_rate');
  v_new := replace(v_new,  'p_expected_shift_hours', 'v_expected_shift_hours');

  -- No client-supplied policy may survive in the new body.
  IF position('p_lunch_minutes' in v_new) > 0
     OR position('p_overtime_enabled' in v_new) > 0
     OR position('p_overtime_rate' in v_new) > 0
     OR position('p_expected_shift_hours' in v_new) > 0 THEN
    RAISE EXCEPTION 'a client-supplied policy parameter survived the rewrite';
  END IF;

  EXECUTE v_new;
END
$mig$;

REVOKE EXECUTE ON FUNCTION public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.punch_out_attendance(uuid, uuid, numeric, numeric, numeric, text) IS
'Punch out. Derives lunch minutes, overtime enablement, overtime rate and expected shift hours SERVER-SIDE from tenants/tenant_settings/shifts, and asserts the caller owns the attendance row (or is HR). Replaces the 10-argument version, which took all four policy values from the browser and let a fabricated overtime amount reach overtime_records (finding C1).';

-- ---------------------------------------------------------------------------
-- Prove both signatures exist and the new one is clean
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_old int;
  v_new int;
  v_body text;
BEGIN
  SELECT count(*) INTO v_old FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance' AND p.pronargs = 10;
  SELECT count(*) INTO v_new FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance' AND p.pronargs = 6;

  IF v_old <> 1 THEN
    RAISE EXCEPTION 'the 10-arg version must still exist until the frontend deploy is verified (found %)', v_old;
  END IF;
  IF v_new <> 1 THEN
    RAISE EXCEPTION 'the 6-arg version was not created (found %)', v_new;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance' AND p.pronargs = 6;

  IF position('NOT_YOUR_ATTENDANCE' in v_body) = 0 THEN
    RAISE EXCEPTION 'ownership assertion (C3) missing from the new body';
  END IF;
  IF position('v_expected_shift_hours := ' in v_body) = 0 THEN
    RAISE EXCEPTION 'server-side shift-hours derivation (C1) missing from the new body';
  END IF;

  RAISE NOTICE 'B2: 6-arg punch_out_attendance created with server-derived policy + ownership check; 10-arg retained until the frontend deploy is verified';
END
$check$;
