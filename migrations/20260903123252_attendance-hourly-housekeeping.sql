-- Gives expire_location_exceptions() a runner.
--
-- The function existed with no trigger, no schedule and no caller anywhere in the database, the
-- edge functions or the app -- so approved WFH / location exceptions never expired by themselves.
--
-- attendance-derivation-hourly is the ONLY schedule this project has (pg_cron is installed but
-- project_admin has no USAGE on the cron schema), so the hourly derivation run is the only place a
-- periodic job can live without inventing new infrastructure. The call is wrapped so housekeeping
-- can never fail a derivation run that already did its work; the outcome is reported in the return
-- payload as location_exceptions_expired (1 ran, -1 raised).

CREATE OR REPLACE FUNCTION public.attendance_run_scheduled_derivation(p_lookback_days integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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

  RETURN jsonb_build_object(
    'success', true,
    'tenants_processed', v_tenants_done,
    'lookback_days', p_lookback_days,
    'location_exceptions_expired', v_expired,
    'runs', v_runs);
END;
$function$;

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE v_body text;
BEGIN
  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_body FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='attendance_run_scheduled_derivation';

  IF v_body !~ 'expire_location_exceptions' THEN
    RAISE EXCEPTION 'assertion: the hourly run does not call expire_location_exceptions';
  END IF;
  IF v_body !~ 'EXCEPTION WHEN OTHERS' THEN
    RAISE EXCEPTION 'assertion: housekeeping is not isolated from the derivation run';
  END IF;
  IF v_body !~ 'attendance_derive_pass1' OR v_body !~ 'attendance_derive_pass2' THEN
    RAISE EXCEPTION 'assertion: a derivation pass was lost';
  END IF;
  IF v_body !~ 'enable_auto_derivation' THEN
    RAISE EXCEPTION 'assertion: the shift gate was lost';
  END IF;
END;
$assert$;
