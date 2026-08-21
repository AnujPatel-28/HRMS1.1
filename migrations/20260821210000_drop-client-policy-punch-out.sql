-- B2, part 2 — drop the ten-argument punch_out_attendance. THIS is what closes C1.
--
-- 20260821200000 created the six-argument replacement beside it. Until the old signature is
-- gone the vector is still open, because it remains granted to `authenticated` and any
-- client can still call it by name with the old argument set.
--
-- ============================================================================
-- THE VECTOR, DEMONSTRATED RATHER THAN ASSERTED
-- ============================================================================
-- Both signatures were exercised against production as a real employee-role user
-- (tenant 97da3641), against an open attendance session belonging to a DIFFERENT employee:
--
--   6-arg  -> {"success": false, "reason": "NOT_YOUR_ATTENDANCE", "errcode": "P0004"}
--   10-arg -> {"success": true,  "work_hours": 3.01, "overtime_hours": 3.01}
--             ...called with p_overtime_rate = 10 and p_expected_shift_hours = 0, which
--             wrote 3.01 fabricated overtime hours at a made-up rate into overtime_records,
--             for a colleague's session, from an ordinary employee account.
--
-- The probe rows were removed afterwards (attendance and overtime_records both verified back
-- to zero). That test is the reason this migration exists in the form it does: the hole was
-- real, reachable, and not theoretical.
--
-- ============================================================================
-- SAFE TO DROP NOW — DEPLOY VERIFIED, NOT ASSUMED
-- ============================================================================
-- PostgREST resolves RPCs by named argument, so dropping parameters breaks every deployed
-- client the instant it applies. The frontend that stops sending them was pushed (bb5b682)
-- and the deploy CONFIRMED LIVE by fetching the production bundle and grepping it:
--
--   /assets/index-CpHzcQ_r.js  ->  p_expected_shift_hours 0, p_overtime_rate 0,
--                                  p_lunch_minutes 0
--
-- Hashes differ between local and Vercel builds, so the filename proves nothing; the marker
-- string is the evidence. An earlier check on the same day still showed 1 occurrence each --
-- that was the previous build, and dropping then would have broken punch-out for everyone.
-- Check the marker, never the timestamp.
DROP FUNCTION IF EXISTS public.punch_out_attendance(
  uuid, uuid, numeric, numeric, numeric, text, integer, boolean, numeric, numeric
);

-- ---------------------------------------------------------------------------
-- Prove exactly one signature survives, and that it is the safe one
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_count int;
  v_args  text;
  v_body  text;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 punch_out_attendance overload after the drop, found %', v_count;
  END IF;

  SELECT pg_get_function_arguments(p.oid), pg_get_functiondef(p.oid)
    INTO v_args, v_body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_out_attendance';

  -- No policy value may be reachable from the request any more.
  IF position('p_overtime_rate' in v_args) > 0
     OR position('p_expected_shift_hours' in v_args) > 0
     OR position('p_lunch_minutes' in v_args) > 0
     OR position('p_overtime_enabled' in v_args) > 0 THEN
    RAISE EXCEPTION 'a client-supplied policy parameter is still callable: %', v_args;
  END IF;

  IF position('NOT_YOUR_ATTENDANCE' in v_body) = 0 THEN
    RAISE EXCEPTION 'the surviving function has no ownership assertion';
  END IF;

  RAISE NOTICE 'C1 and C3 closed: punch_out_attendance(%) is the only signature', v_args;
END
$check$;
