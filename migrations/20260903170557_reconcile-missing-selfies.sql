-- Selfie reconciliation, run from the hourly job.
--
-- See the function header below for why this is detection and not enforcement.


-- ---------------------------------------------------------------------------
-- DETECTION, NOT ENFORCEMENT. Say it that way in the UI too.
--
-- A selfie cannot be enforced at punch time in the current shape: it uploads AFTER the punch, so
-- the server has only the client's claim that one was taken -- and a client that can lie about
-- `selfie_captured` can lie about anything. Real enforcement needs a two-phase flow (upload first,
-- pass the returned id into the punch RPC, and require it to be fresh AND single-use, or one selfie
-- gets replayed forever). That belongs with the native client.
--
-- What IS achievable now is closing the blind spot: HR turns selfies on, believes they are being
-- collected, and has no way to see that they are not. This marks the days where a selfie was
-- required and never arrived.
--
-- It does NOT repeat the mistake in mark_attendance_selfie_missing, which overwrites
-- location_status unconditionally and so destroys the location verdict on the same row. Here the
-- finding always lands in verification_snapshot, and location_status is only overwritten when it
-- currently holds a CLEAN verdict -- never over 'outside_geofence' or 'gps_unavailable', which are
-- the more serious signals and must survive.
CREATE OR REPLACE FUNCTION public.attendance_reconcile_missing_selfies(
  p_lookback_days integer DEFAULT 2,
  p_grace_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   record;
  v_mode     text;
  v_flagged  integer;
  v_total    integer := 0;
  v_tenants  integer := 0;
BEGIN
  FOR v_tenant IN
    SELECT t.id FROM tenants t WHERE tenant_has_module_for(t.id, 'attendance')
  LOOP
    SELECT nullif(value, '') INTO v_mode
    FROM tenant_settings
    WHERE tenant_id = v_tenant.id AND key = 'attendance_selfie_mode';

    IF coalesce(v_mode, 'disabled') = 'disabled' THEN
      CONTINUE;
    END IF;

    UPDATE attendance a
    SET verification_snapshot = coalesce(a.verification_snapshot, '{}'::jsonb)
          || jsonb_build_object('server_selfie_check', jsonb_build_object(
               'missing', true, 'mode', v_mode, 'checked_at', now())),
        location_status = CASE
          WHEN coalesce(a.location_status, 'office_verified')
               IN ('office_verified', 'remote_approved', 'device_verified')
          THEN 'selfie_missing'
          ELSE a.location_status
        END
    WHERE a.tenant_id = v_tenant.id
      AND a.date >= current_date - p_lookback_days
      AND a.is_locked IS NOT TRUE
      AND coalesce(a.location_status, '') <> 'selfie_missing'
      AND coalesce(a.verification_snapshot -> 'server_selfie_check' ->> 'missing', '') <> 'true'
      AND (
        (v_mode IN ('punch_in', 'both')
          AND a.punch_in IS NOT NULL
          AND a.punch_in < now() - make_interval(mins => p_grace_minutes)
          AND NOT EXISTS (SELECT 1 FROM attendance_selfies s
                           WHERE s.attendance_id = a.id AND s.type = 'punch_in'))
        OR
        (v_mode IN ('punch_out', 'both')
          AND a.punch_out IS NOT NULL
          AND a.punch_out < now() - make_interval(mins => p_grace_minutes)
          AND NOT EXISTS (SELECT 1 FROM attendance_selfies s
                           WHERE s.attendance_id = a.id AND s.type = 'punch_out'))
      );

    GET DIAGNOSTICS v_flagged = ROW_COUNT;
    v_total := v_total + v_flagged;
    IF v_flagged > 0 THEN
      v_tenants := v_tenants + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('rows_flagged', v_total, 'tenants_affected', v_tenants,
                            'lookback_days', p_lookback_days, 'grace_minutes', p_grace_minutes);
END;
$function$;

REVOKE ALL ON FUNCTION public.attendance_reconcile_missing_selfies(integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.attendance_run_scheduled_derivation(p_lookback_days integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_selfies           jsonb := NULL;
  v_expired           integer := 0;
  v_tenant        record;
  v_shift         record;
  v_run_id        uuid;
  v_today         date;
  v_from          date;
  v_from_clamped  date;
  v_error_count   integer;
  v_error_detail  jsonb;
  v_tenants_done  integer := 0;
  v_runs          jsonb := '[]'::jsonb;
BEGIN
  IF p_lookback_days IS NULL OR p_lookback_days < 0 OR p_lookback_days > 31 THEN
    RAISE EXCEPTION 'p_lookback_days must be between 0 and 31';
  END IF;

  FOR v_tenant IN
    SELECT t.id
    FROM tenants t
    WHERE tenant_has_module_for(t.id, 'attendance')
      AND EXISTS (
        SELECT 1 FROM shifts s
        WHERE s.tenant_id = t.id AND s.is_active AND s.enable_auto_derivation
      )
    ORDER BY t.id
  LOOP
    -- Per-tenant business date (D9). Never the server's calendar day.
    v_today := tenant_business_date(v_tenant.id, now());
    CONTINUE WHEN v_today IS NULL;

    v_from        := v_today - p_lookback_days;
    v_run_id      := gen_random_uuid();
    v_error_count := 0;
    v_error_detail := '[]'::jsonb;

    INSERT INTO attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger, status)
    VALUES (v_run_id, v_tenant.id, NULL, v_from, v_today, 'schedule', 'running');

    FOR v_shift IN
      SELECT * FROM shifts s
      WHERE s.tenant_id = v_tenant.id AND s.is_active AND s.enable_auto_derivation
    LOOP
      v_from_clamped := GREATEST(v_from, COALESCE(v_shift.process_attendance_after, v_from));

      -- Each pass is isolated: one bad shift must not abort the whole tenant, and one bad tenant
      -- must not abort the schedule. The failure is recorded on the run row instead of vanishing.
      BEGIN
        PERFORM attendance_derive_pass1(v_tenant.id, v_shift.id, v_from_clamped, v_today, v_run_id);
      EXCEPTION WHEN OTHERS THEN
        v_error_count := v_error_count + 1;
        v_error_detail := v_error_detail || jsonb_build_object(
          'shift_id', v_shift.id, 'pass', 1, 'sqlstate', SQLSTATE, 'message', SQLERRM);
      END;

      BEGIN
        PERFORM attendance_derive_pass2(v_tenant.id, v_shift.id, v_from_clamped, v_today, v_run_id);
      EXCEPTION WHEN OTHERS THEN
        v_error_count := v_error_count + 1;
        v_error_detail := v_error_detail || jsonb_build_object(
          'shift_id', v_shift.id, 'pass', 2, 'sqlstate', SQLSTATE, 'message', SQLERRM);
      END;
    END LOOP;

    UPDATE attendance_derivation_runs
    SET error_count  = v_error_count,
        error_detail = CASE WHEN v_error_count > 0 THEN v_error_detail ELSE NULL END,
        status       = CASE WHEN v_error_count > 0 THEN 'failed' ELSE 'completed' END,
        finished_at  = now()
    WHERE id = v_run_id;

    v_tenants_done := v_tenants_done + 1;
    v_runs := v_runs || jsonb_build_object(
      'tenant_id', v_tenant.id, 'run_id', v_run_id,
      'from', v_from, 'to', v_today, 'errors', v_error_count);
  END LOOP;

  -- Housekeeping that had no runner. expire_location_exceptions() existed with no trigger, no
  -- schedule and no caller, so approved WFH exceptions never expired on their own. This is the
  -- only schedule the project has (attendance-derivation-hourly), so it is the only place a
  -- periodic job can actually live -- see the pg_cron note: project_admin has no USAGE on the
  -- cron schema, so scheduling goes through InsForge schedules calling an edge function.
  --
  -- Isolated: housekeeping must never be able to fail a derivation run that already succeeded.
  BEGIN
    PERFORM public.expire_location_exceptions();
    v_expired := 1;
  EXCEPTION WHEN OTHERS THEN
    v_expired := -1;
  END;

  BEGIN
    v_selfies := public.attendance_reconcile_missing_selfies();
  EXCEPTION WHEN OTHERS THEN
    v_selfies := jsonb_build_object('error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'success', true,
    'tenants_processed', v_tenants_done,
    'lookback_days', p_lookback_days,
    'location_exceptions_expired', v_expired,
    'selfie_reconciliation', v_selfies,
    'runs', v_runs);
END;
$function$;

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE v_body text; v_res jsonb;
BEGIN
  IF to_regprocedure('public.attendance_reconcile_missing_selfies(integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'assertion: the reconciler was not created';
  END IF;

  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_body FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='attendance_reconcile_missing_selfies';

  -- the whole point: a location problem must survive a selfie finding
  IF v_body !~ 'outside_geofence|office_verified.*remote_approved.*device_verified' THEN
    RAISE EXCEPTION 'assertion: location_status is being overwritten unconditionally';
  END IF;
  IF v_body !~ 'is_locked IS NOT TRUE' THEN
    RAISE EXCEPTION 'assertion: an HR-corrected row could be re-flagged';
  END IF;

  -- it must be safe to run twice
  v_res := public.attendance_reconcile_missing_selfies();
  IF v_res->>'rows_flagged' IS NULL THEN
    RAISE EXCEPTION 'assertion: the reconciler returned no row count: %', v_res;
  END IF;

  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_body FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='attendance_run_scheduled_derivation';
  IF v_body !~ 'attendance_reconcile_missing_selfies' THEN
    RAISE EXCEPTION 'assertion: the hourly job does not run the reconciler';
  END IF;
  IF v_body !~ 'expire_location_exceptions' OR v_body !~ 'attendance_derive_pass1' THEN
    RAISE EXCEPTION 'assertion: existing hourly work was lost';
  END IF;
END;
$assert$;
