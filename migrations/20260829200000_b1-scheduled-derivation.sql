-- B1: a scheduled entry point for derivation, and the auth story that blocked it.
--
-- ############################################################################
-- WHY NOT pg_cron
-- ############################################################################
-- pg_cron IS installed on this project, which makes "just schedule it in Postgres" look like the
-- obvious answer. It is not available to us: `project_admin` has no USAGE on the `cron` schema,
-- and a direct probe returns `permission denied for schema cron`. Verified, not assumed -- and
-- worth recording, because the extension being present is exactly the kind of thing that sends
-- the next person down a dead end.
--
-- So scheduling goes through InsForge's own `schedules`, which invokes an edge function on a cron
-- expression.
--
-- ############################################################################
-- THE AUTH STORY THAT BLOCKED B1
-- ############################################################################
-- hr_run_attendance_derivation is the only existing orchestrator, and it opens with
-- assert_hr_for_tenant, which raises when auth.uid() IS NULL. A scheduled invocation has no
-- end-user JWT, so it can never call that function. That is the wall B1 has been stuck behind.
--
-- The way through was already proven by the kiosk work: an edge function holding the project_admin
-- key can call a project_admin-only RPC directly. So this migration adds the orchestrator that
-- hr_run_attendance_derivation cannot be -- same passes, same run-row bookkeeping, no HR fence,
-- and no grant to `authenticated` at all.
--
-- attendance_run_scheduled_derivation is therefore the ONLY derivation entry point reachable
-- without a human, and it is unreachable BY a human through the API.
--
-- ############################################################################
-- THE WINDOW, AND WHY IT IS NOT JUST TODAY
-- ############################################################################
-- Derivation re-runs over a lookback window rather than only the current day, because the whole
-- point of the two-layer design is that events can arrive LATE: a biometric unit that was offline
-- for two days syncs its backlog with true timestamps (E15), and yesterday's derived day changes
-- as a result. Deriving only today would leave those days permanently wrong -- the events would
-- sit in the log, correct and ignored.
--
-- Re-derivation is safe to repeat: pass 1 is idempotent, and an is_locked row (an HR correction)
-- is skipped entirely (D5).
--
-- D9 is respected: the window is computed per tenant from tenant_business_date(), never from the
-- server's own calendar date. A tenant in Asia/Kolkata and one in UTC do not share a "today", and
-- a scheduler that assumed they did would derive the wrong day for one of them.
--
-- Binding rules: no BEGIN/COMMIT/ROLLBACK. No FORCE ROW LEVEL SECURITY. No attendance_events row
-- is edited or deleted (D11). Module independence: a tenant without the attendance module is
-- skipped, and nothing here reads payroll.

CREATE OR REPLACE FUNCTION public.attendance_run_scheduled_derivation(p_lookback_days integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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

  RETURN jsonb_build_object(
    'success', true,
    'tenants_processed', v_tenants_done,
    'lookback_days', p_lookback_days,
    'runs', v_runs);
END;
$function$;

COMMENT ON FUNCTION public.attendance_run_scheduled_derivation(integer) IS
'B1: the unattended derivation entry point. hr_run_attendance_derivation cannot serve a scheduler because it opens with assert_hr_for_tenant, which raises when auth.uid() IS NULL -- that is the wall B1 sat behind. This function is the same orchestration without the HR fence, callable only by project_admin (an edge function holding the admin key), and granted to no API role. Derives over a LOOKBACK WINDOW, not just today, because events arrive late: an offline biometric unit syncing two days of backlog changes days already derived (E15), and pass 1 is idempotent so re-deriving is safe. The window is computed per tenant via tenant_business_date so tenants in different timezones each get their own "today" (D9). A tenant without the attendance module is skipped. One failing shift is recorded on the run row rather than aborting the tenant, and one failing tenant never aborts the schedule.';

REVOKE ALL ON FUNCTION public.attendance_run_scheduled_derivation(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attendance_run_scheduled_derivation(integer) FROM anon;
REVOKE ALL ON FUNCTION public.attendance_run_scheduled_derivation(integer) FROM authenticated;

-- --------------------------------------------------------------------
-- Verification
-- --------------------------------------------------------------------
DO $sched_check$
DECLARE
  v_def text;
  v_runs_before bigint;
  v_runs_after  bigint;
  v_att_before  bigint;
  v_res jsonb;
BEGIN
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
           '[ \t]+', ' ', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'attendance_run_scheduled_derivation';

  -- It must NOT carry the HR fence -- that is the entire reason it exists.
  IF position('assert_hr_for_tenant' in v_def) > 0 THEN
    RAISE EXCEPTION 'B1 FAILED: the scheduled orchestrator asserts HR, so a scheduler can never call it';
  END IF;
  -- D9: no server-calendar business date.
  IF position('current_date' in v_def) > 0 THEN
    RAISE EXCEPTION 'D9 FAILED: the scheduler uses the server calendar instead of a tenant business date';
  END IF;
  IF position('tenant_business_date' in v_def) = 0 THEN
    RAISE EXCEPTION 'D9 FAILED: the scheduler does not derive a per-tenant business date';
  END IF;
  IF position('tenant_has_module_for' in v_def) = 0 THEN
    RAISE EXCEPTION 'MODULE INDEPENDENCE FAILED: the scheduler does not skip attendance-off tenants';
  END IF;

  -- No API role may reach it.
  IF has_function_privilege('authenticated', 'public.attendance_run_scheduled_derivation(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.attendance_run_scheduled_derivation(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL FAILED: attendance_run_scheduled_derivation is reachable by an API role';
  END IF;

  -- Behavioural: actually run it, prove it records runs, then roll the whole thing back. This is
  -- the first time derivation has ever executed against production tenants, so it is deliberately
  -- NOT left committed here -- the schedule, or an HR trigger, gets to be the first real run.
  SELECT count(*) INTO v_runs_before FROM attendance_derivation_runs;
  SELECT count(*) INTO v_att_before  FROM attendance;

  BEGIN
    v_res := attendance_run_scheduled_derivation(2);

    IF (v_res->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'B1 FAILED: scheduled derivation did not report success: %', v_res;
    END IF;

    SELECT count(*) INTO v_runs_after FROM attendance_derivation_runs;
    IF v_runs_after <= v_runs_before AND (v_res->>'tenants_processed')::int > 0 THEN
      RAISE EXCEPTION 'B1 FAILED: % tenants processed but no run row was recorded (C4 observability)',
        v_res->>'tenants_processed';
    END IF;

    -- Every run row it created must be finished, not left dangling in "running".
    IF EXISTS (SELECT 1 FROM attendance_derivation_runs
               WHERE trigger = 'schedule' AND status = 'running') THEN
      RAISE EXCEPTION 'B1 FAILED: a scheduled run was left in status=running';
    END IF;

    RAISE NOTICE 'B1 verified: % tenant(s) processed, run rows recorded and finished. Result: %',
      v_res->>'tenants_processed', v_res;

    RAISE EXCEPTION 'b1 probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'B1 probe rolled back -- no derived attendance rows were committed by this migration';
  END;

  SELECT count(*) INTO v_runs_after FROM attendance_derivation_runs;
  IF v_runs_after <> v_runs_before THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance_derivation_runs % to %', v_runs_before, v_runs_after;
  END IF;
  SELECT count(*) INTO v_runs_after FROM attendance;
  IF v_runs_after <> v_att_before THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance % to %', v_att_before, v_runs_after;
  END IF;
  RAISE NOTICE 'Population restored: attendance_derivation_runs %, attendance %', v_runs_before, v_att_before;
END
$sched_check$;
