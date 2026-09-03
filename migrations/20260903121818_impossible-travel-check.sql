-- A client-agnostic anti-spoof: flag a punch whose implied travel speed from the employee's
-- previous located punch is physically impossible.
--
-- WHY THIS AND NOT BETTER GPS. Browser geolocation can be set to arbitrary coordinates from
-- devtools in seconds; no accuracy improvement addresses that, and a native client (planned after
-- the policy center) is what finally allows mock-provider detection. This check needs no client
-- cooperation at all -- it compares two coordinates the server already stored -- so it works
-- against the web app, a kiosk, or a direct API call equally.
--
-- IT FLAGS, IT DOES NOT BLOCK. Deliberate. The inputs are noisy: a GPS glitch can jump hundreds of
-- metres in seconds, and a genuine long-haul flight between two punches is legitimate. Blocking on
-- a heuristic would lock real employees out of their own attendance, which is the failure mode this
-- whole workstream has been removing. The flag lands in verification_snapshot and the audit log for
-- HR to review, next to the geofence evidence.
--
-- THRESHOLD. 900 km/h, and only when the two points are more than 1km apart. That is above
-- commercial-flight cruise speed, so a flag means "no vehicle did this", not "this looked fast".
-- Choosing a tighter, more useful threshold (a 30km hop in 10 minutes is implausible on the ground
-- but only 180 km/h) would need to be a tenant policy, and adding an inert setting is exactly the
-- pattern the policy-center audit exists to remove. Hardcoded until someone asks to tune it.

CREATE OR REPLACE FUNCTION public.attendance_check_impossible_travel(
  p_tenant_id   uuid,
  p_employee_id uuid,
  p_lat         numeric,
  p_lng         numeric,
  p_at          timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max_kmh    constant numeric := 900;
  v_min_metres constant numeric := 1000;
  v_prev       record;
  v_dist       numeric;
  v_hours      numeric;
  v_kmh        numeric;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL OR p_employee_id IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'no_coordinates');
  END IF;

  -- The most recent located punch of either kind, before this one.
  SELECT x.at, x.lat, x.lng INTO v_prev
  FROM (
    SELECT a.punch_in AS at, a.punch_in_lat AS lat, a.punch_in_lng AS lng
      FROM attendance a
     WHERE a.tenant_id = p_tenant_id AND a.employee_id = p_employee_id
       AND a.punch_in IS NOT NULL AND a.punch_in_lat IS NOT NULL AND a.punch_in_lng IS NOT NULL
       AND a.punch_in < p_at
    UNION ALL
    SELECT a.punch_out, a.punch_out_lat, a.punch_out_lng
      FROM attendance a
     WHERE a.tenant_id = p_tenant_id AND a.employee_id = p_employee_id
       AND a.punch_out IS NOT NULL AND a.punch_out_lat IS NOT NULL AND a.punch_out_lng IS NOT NULL
       AND a.punch_out < p_at
  ) x
  ORDER BY x.at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'no_previous_located_punch');
  END IF;

  v_dist := 2 * 6371000 * asin(sqrt(
              power(sin(radians(v_prev.lat::double precision - p_lat::double precision) / 2), 2)
            + cos(radians(p_lat::double precision)) * cos(radians(v_prev.lat::double precision))
            * power(sin(radians(v_prev.lng::double precision - p_lng::double precision) / 2), 2)
            ))::numeric;

  v_hours := EXTRACT(EPOCH FROM (p_at - v_prev.at)) / 3600.0;

  IF v_dist <= v_min_metres THEN
    RETURN jsonb_build_object('checked', true, 'implausible', false,
                              'distance_m', round(v_dist, 1), 'reason', 'within_noise_floor');
  END IF;

  IF v_hours <= 0 THEN
    -- Same instant or clock skew: a distance with no elapsed time is implausible by definition.
    RETURN jsonb_build_object('checked', true, 'implausible', true,
                              'distance_m', round(v_dist, 1), 'elapsed_hours', 0,
                              'implied_kmh', null, 'previous_punch_at', v_prev.at,
                              'reason', 'no_elapsed_time');
  END IF;

  v_kmh := (v_dist / 1000.0) / v_hours;

  RETURN jsonb_build_object(
    'checked',           true,
    'implausible',       v_kmh > v_max_kmh,
    'distance_m',        round(v_dist, 1),
    'elapsed_hours',     round(v_hours, 3),
    'implied_kmh',       round(v_kmh, 1),
    'threshold_kmh',     v_max_kmh,
    'previous_punch_at', v_prev.at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.attendance_check_impossible_travel(uuid, uuid, numeric, numeric, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_check_impossible_travel(uuid, uuid, numeric, numeric, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  v jsonb;
BEGIN
  IF to_regprocedure('public.attendance_check_impossible_travel(uuid,uuid,numeric,numeric,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'assertion: attendance_check_impossible_travel was not created';
  END IF;

  -- No coordinates -> not checked, never an error.
  v := public.attendance_check_impossible_travel(gen_random_uuid(), gen_random_uuid(), NULL, NULL, now());
  IF (v->>'checked')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'assertion: a coordinate-less punch should be unchecked, got %', v;
  END IF;

  -- An employee with no prior located punch must not be flagged.
  v := public.attendance_check_impossible_travel(gen_random_uuid(), gen_random_uuid(), 23.0225, 72.5714, now());
  IF (v->>'checked')::boolean IS DISTINCT FROM false OR v->>'reason' <> 'no_previous_located_punch' THEN
    RAISE EXCEPTION 'assertion: a first located punch should be unchecked, got %', v;
  END IF;
END;
$assert$;
