-- Group B, item 2 -- part 1 of 2: the shared location evaluator. ADDITIVE ONLY.
-- Nothing calls this yet; 20260903110000 wires it into the punch paths.
--
-- Why this exists. Geofencing, GPS mode, confidence banding and remote-work handling were all
-- computed in PunchInOut.tsx and merely STORED by the punch RPCs. A browser check is not a policy:
-- anything that is not the employee app -- a kiosk, an ADMS device, a direct API call -- skipped
-- every one of them. This function is the single server-side implementation the punch paths call.
--
-- Multi-branch from the start, per the product decision: the fence is every active row in
-- public.office_locations, each with its OWN radius_meters. A punch is inside if it falls within
-- ANY branch's own radius -- min(distance - radius) <= 0 -- NOT within the radius of the nearest
-- branch, or a close branch with a tight radius would mask a farther one with a generous radius.
-- The branch actually matched is returned, not the nearest.
--
-- Two settings become real here for the first time:
--   * `geofence_enabled` was read by NOTHING (0 references in PunchInOut.tsx). The client always
--     required a fence unless remote handling relaxed it, so the master toggle did nothing. It now
--     gates the check, which is what its label ("Require location on punch-in") promises.
--   * `gps_verification_mode` / the confidence bands / `remote_work_handling` were browser-only.
--
-- Fail-open rule, chosen deliberately. If the geofence is enabled but the tenant has NO active
-- office_locations row, this returns allowed = true with loc_status 'gps_unavailable' rather than
-- blocking. A lockout of an entire company is worse than a missed check, and the real guard is at
-- CONFIGURATION time -- 20260903110000 makes save_attendance_policy_transaction refuse to enable a
-- geofence with no branches, the same way it used to refuse a missing office_lat/office_lng.
-- The Policy Center surfaces the same condition as a warning.

-- 'device_verified' is a new location_status: a fixed biometric terminal or kiosk has no GPS, and
-- its physical presence at a site IS the verification. Recording it as 'office_verified' would be
-- indistinguishable from a GPS-verified app punch in the audit trail.
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_location_status_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_location_status_check
  CHECK (location_status = ANY (ARRAY[
    'office_verified', 'remote_approved', 'outside_geofence', 'gps_low_confidence',
    'gps_denied', 'gps_unavailable', 'manual_override', 'selfie_missing', 'device_verified'
  ]));

CREATE OR REPLACE FUNCTION public.attendance_evaluate_location(
  p_tenant_id     uuid,
  p_employee_id   uuid,
  p_lat           numeric,
  p_lng           numeric,
  p_accuracy      numeric,
  p_business_date date
)
RETURNS TABLE (
  allowed             boolean,
  loc_status          text,
  confidence          text,
  matched_location_id uuid,
  distance_meters     numeric,
  remote_exception_id uuid,
  block_reason        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  ORDER BY (d.dist - o.radius_meters) ASC
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

REVOKE ALL ON FUNCTION public.attendance_evaluate_location(uuid, uuid, numeric, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_evaluate_location(uuid, uuid, numeric, numeric, numeric, date) TO authenticated;

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  v_lat  numeric := 23.0225;   -- Ahmedabad, used only as a synthetic origin
  v_lng  numeric := 72.5714;
  v_d    numeric;
BEGIN
  IF to_regprocedure('public.attendance_evaluate_location(uuid,uuid,numeric,numeric,numeric,date)') IS NULL THEN
    RAISE EXCEPTION 'assertion: attendance_evaluate_location was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.attendance'::regclass
      AND conname = 'attendance_location_status_check'
      AND pg_get_constraintdef(oid) LIKE '%device_verified%'
  ) THEN
    RAISE EXCEPTION 'assertion: device_verified is not an allowed location_status';
  END IF;

  -- Haversine sanity: 0.01 degrees of latitude is ~1111m anywhere on the sphere.
  SELECT 2 * 6371000 * asin(sqrt(
           power(sin(radians((v_lat + 0.01)::double precision - v_lat::double precision) / 2), 2)
         + cos(radians(v_lat::double precision)) * cos(radians((v_lat + 0.01)::double precision))
         * power(sin(radians(v_lng::double precision - v_lng::double precision) / 2), 2)
         ))::numeric INTO v_d;

  IF v_d < 1100 OR v_d > 1120 THEN
    RAISE EXCEPTION 'assertion: Haversine is wrong -- 0.01 deg latitude measured as %m, expected ~1111m', round(v_d, 1);
  END IF;
END;
$assert$;
