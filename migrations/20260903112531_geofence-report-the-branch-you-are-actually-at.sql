-- Follow-up to 20260903105835, found by testing rather than review.
--
-- attendance_evaluate_location picked the branch with the MOST slack (min(dist - radius)). That
-- gives the correct allow/deny verdict -- a punch inside any branch's own radius is allowed -- but
-- it reports the wrong branch whenever the punch is inside more than one fence.
--
-- Observed against a synthetic two-branch fixture: a probe 11m from a 100m-radius HQ came back
-- `matched = Annexe (generous), distance = 1100.8m`. The verdict (allowed) was right; the evidence
-- was nonsense, and matched_location_id / distance_meters are persisted for HR to read.
--
-- Fix: prefer branches you are inside, nearest first; fall through to nearest-by-distance when
-- outside all of them, which is also what the block message claims to measure.

CREATE OR REPLACE FUNCTION public.attendance_evaluate_location(p_tenant_id uuid, p_employee_id uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_business_date date)
 RETURNS TABLE(allowed boolean, loc_status text, confidence text, matched_location_id uuid, distance_meters numeric, remote_exception_id uuid, block_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_geofence_enabled  boolean;
  v_gps_mode          text;
  v_remote_handling   text;
  v_high              numeric;
  v_medium            numeric;
  v_low               numeric;
  v_work_mode         text;
  v_exception_id      uuid;
  v_geofence_required boolean := true;
  v_confidence        text;
  v_branch_count      integer;
  v_match             record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'attendance_evaluate_location: p_tenant_id is required';
  END IF;

  -- ── settings, with the same defaults PunchInOut.tsx used ──────────────────────────────────
  SELECT lower(coalesce(nullif(value, ''), 'false')) = 'true' INTO v_geofence_enabled
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'geofence_enabled';
  v_geofence_enabled := coalesce(v_geofence_enabled, false);

  SELECT nullif(value, '') INTO v_gps_mode
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'gps_verification_mode';
  v_gps_mode := coalesce(v_gps_mode, 'warn');

  SELECT nullif(value, '') INTO v_remote_handling
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'remote_work_handling';
  v_remote_handling := coalesce(v_remote_handling, 'hr_approved_exceptions');

  SELECT nullif(value, '')::numeric INTO v_high
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'high_confidence_max';
  SELECT nullif(value, '')::numeric INTO v_medium
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'medium_confidence_max';
  SELECT nullif(value, '')::numeric INTO v_low
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'low_confidence_max';
  v_high   := coalesce(v_high, 50);
  v_medium := coalesce(v_medium, 150);
  v_low    := coalesce(v_low, 300);

  -- ── confidence band from GPS accuracy (mirrors the client) ────────────────────────────────
  IF p_accuracy IS NULL THEN
    v_confidence := NULL;
  ELSIF p_accuracy <= v_high   THEN v_confidence := 'high';
  ELSIF p_accuracy <= v_medium THEN v_confidence := 'medium';
  ELSIF p_accuracy <= v_low    THEN v_confidence := 'low';
  ELSE                              v_confidence := 'very_low';
  END IF;

  -- ── is a fence required for THIS employee today? ──────────────────────────────────────────
  IF NOT v_geofence_enabled THEN
    v_geofence_required := false;
  ELSIF v_remote_handling = 'always_allowed' THEN
    v_geofence_required := false;
  ELSIF v_remote_handling = 'hr_approved_exceptions' THEN
    SELECT e.work_mode INTO v_work_mode FROM employees e WHERE e.id = p_employee_id;
    IF coalesce(v_work_mode, 'office') = 'remote' THEN
      v_geofence_required := false;
    ELSE
      SELECT x.id INTO v_exception_id
      FROM attendance_location_exceptions x
      WHERE x.tenant_id = p_tenant_id
        AND x.employee_id = p_employee_id
        AND x.status = 'approved'
        AND x.start_date <= coalesce(p_business_date, current_date)
        AND x.end_date   >= coalesce(p_business_date, current_date)
      LIMIT 1;
      IF v_exception_id IS NOT NULL THEN
        v_geofence_required := false;
      END IF;
    END IF;
  END IF;

  IF NOT v_geofence_required THEN
    RETURN QUERY SELECT true,
      CASE WHEN v_exception_id IS NOT NULL OR coalesce(v_work_mode, 'office') = 'remote'
             OR v_remote_handling = 'always_allowed'
           THEN 'remote_approved'::text ELSE 'office_verified'::text END,
      v_confidence, NULL::uuid, NULL::numeric, v_exception_id, NULL::text;
    RETURN;
  END IF;

  IF v_gps_mode = 'disabled' THEN
    RETURN QUERY SELECT true, 'office_verified'::text, v_confidence, NULL::uuid, NULL::numeric, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- ── no coordinates supplied ───────────────────────────────────────────────────────────────
  IF p_lat IS NULL OR p_lng IS NULL THEN
    IF v_gps_mode = 'strict' THEN
      RETURN QUERY SELECT false, 'gps_unavailable'::text, v_confidence, NULL::uuid, NULL::numeric, NULL::uuid,
        'Location is required in strict mode but no coordinates were supplied.'::text;
    ELSE
      RETURN QUERY SELECT true, 'gps_unavailable'::text, v_confidence, NULL::uuid, NULL::numeric, NULL::uuid, NULL::text;
    END IF;
    RETURN;
  END IF;

  -- ── fail open when the fence is enabled but no branch is configured ───────────────────────
  SELECT count(*) INTO v_branch_count
  FROM office_locations o WHERE o.tenant_id = p_tenant_id AND o.is_active;

  IF v_branch_count = 0 THEN
    RETURN QUERY SELECT true, 'gps_unavailable'::text, v_confidence, NULL::uuid, NULL::numeric, NULL::uuid,
      'Geofence is enabled but no active office location is configured.'::text;
    RETURN;
  END IF;

  -- ── nearest branch by its OWN radius, Haversine on a 6371km sphere ────────────────────────
  SELECT o.id, d.dist, (d.dist - o.radius_meters) AS slack
    INTO v_match
  FROM office_locations o
  CROSS JOIN LATERAL (
    SELECT 2 * 6371000 * asin(sqrt(
             power(sin(radians(o.lat::double precision - p_lat::double precision) / 2), 2)
           + cos(radians(p_lat::double precision)) * cos(radians(o.lat::double precision))
           * power(sin(radians(o.lng::double precision - p_lng::double precision) / 2), 2)
           ))::numeric AS dist
  ) d
  WHERE o.tenant_id = p_tenant_id AND o.is_active
  -- Prefer a branch you are actually INSIDE, and among those the NEAREST one. Ordering purely by
  -- slack (dist - radius) still returns the right allow/deny verdict, but it names the branch with
  -- the most spare radius as the match -- so an employee standing 11m from a tight-radius HQ was
  -- reported as matched to an annexe 1.1km away, and that value is stored as evidence HR reads.
  -- When outside every branch, fall through to the nearest by distance so the block message
  -- ("Xm outside the nearest office area") matches what it claims to measure.
  ORDER BY ((d.dist - o.radius_meters) <= 0) DESC, d.dist ASC
  LIMIT 1;

  IF v_match.slack <= 0 THEN
    RETURN QUERY SELECT true, 'office_verified'::text, v_confidence, v_match.id, round(v_match.dist, 1), NULL::uuid, NULL::text;
  ELSIF v_gps_mode = 'strict' THEN
    RETURN QUERY SELECT false, 'outside_geofence'::text, v_confidence, NULL::uuid, round(v_match.dist, 1), NULL::uuid,
      format('You are %sm outside the nearest office area.', round(v_match.slack, 0));
  ELSE
    RETURN QUERY SELECT true, 'outside_geofence'::text, v_confidence, NULL::uuid, round(v_match.dist, 1), NULL::uuid, NULL::text;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  v_body text;
BEGIN
  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_body FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='attendance_evaluate_location';

  IF v_body !~ 'ORDER BY \(\(d.dist - o.radius_meters\) <= 0\) DESC, d.dist ASC' THEN
    RAISE EXCEPTION 'assertion: branch selection still orders by slack alone';
  END IF;
  IF v_body !~ 'min\(distance' AND v_body !~ 'radius_meters' THEN
    RAISE EXCEPTION 'assertion: per-branch radius is no longer consulted';
  END IF;
END;
$assert$;
