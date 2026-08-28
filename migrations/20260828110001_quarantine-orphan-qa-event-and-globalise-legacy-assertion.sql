-- B7a follow-up: quarantine one orphan QA event, and re-assert the legacy punch path
-- with a GLOBAL count instead of a scoped one.
--
-- ============================================================================
-- 1. THE ORPHAN, AND WHY IT IS NOT DELETED
-- ============================================================================
-- B7a's first verification pass committed a real punch-in before the agent switched to a
-- rollback-safe probe technique. Its `attendance` row was removed; the `attendance_events`
-- row could not be, and SHOULD not be:
--
--   id bc2c9aec-a04b-4548-be22-6fa127f7f8dc | tenant "QA Attendance Only" | direction 'in'
--   source 'manual' | attendance_id NULL | skip_derivation false | offshift false
--
-- D11 is absolute: the event log is append-only, and corrections never edit or delete an
-- event. That rule held here — an attempted DELETE was refused. Good.
--
-- But leaving it untouched is not neutral either. `attendance_id IS NULL AND
-- skip_derivation = false AND offshift = false` is LITERALLY the derivation work queue
-- (decision doc §5.1's ix_attendance_events_queue). This row is a lone punch-IN with no
-- punch-out, sitting in the queue of a QA tenant. The next derivation run over that tenant
-- would faithfully derive a day from it — hours below any threshold, so an `absent` or a
-- missing-punch-out flag — from an event that records no real attendance. A poison pill,
-- not inert residue.
--
-- `skip_derivation` is the column that exists for exactly this. Setting it is NOT a
-- correction to what the event says: the event still records, truthfully and permanently,
-- that this punch happened. It is a PROCESSOR DIRECTIVE saying "do not derive a day from
-- this one". The factual content — time, direction, source, employee — is untouched, which
-- is the property D11 protects. Deleting it would destroy evidence; quarantining it keeps
-- the evidence and removes the false conclusion.
UPDATE public.attendance_events
   SET skip_derivation = true,
       void_reason = COALESCE(void_reason, 'B7a verification artefact: committed during a pre-rollback probe. Its attendance row was removed; the event is retained per D11 and excluded from derivation because a lone punch-in would derive a false day.')
 WHERE id = 'bc2c9aec-a04b-4548-be22-6fa127f7f8dc'
   AND attendance_id IS NULL;

-- ============================================================================
-- 2. THE ASSERTION B7a SHIPPED WAS SCOPED WHERE IT NEEDED TO BE GLOBAL
-- ============================================================================
-- B7a's promise is that the LEGACY direct-insert punch path — which every employee is still
-- using, because the live bundle predates Phase 0 — is completely unaffected. Its own probe
-- counted events filtered to one tenant and one employee.
--
-- That is the precise shape of the weakness that let the phantom-event bug through twice:
-- a probe that inspects only the rows it expects cannot see a row it does not expect. A
-- phantom event written for a DIFFERENT employee, or against a different tenant, would pass
-- a scoped count and fail a global one. Assert the population, not the sample.
DO $legacy_path_global$
DECLARE
  v_t uuid; v_e uuid; v_a uuid;
  v_ev_before int; v_ev_after int;
  v_at_before int; v_at_after int;
BEGIN
  SELECT count(*) INTO v_ev_before FROM public.attendance_events;
  SELECT count(*) INTO v_at_before FROM public.attendance;

  SELECT e.tenant_id, e.id INTO v_t, v_e
  FROM public.employees e
  WHERE e.tenant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.attendance a
                     WHERE a.employee_id = e.id AND a.session_status = 'open')
  LIMIT 1;

  IF v_t IS NULL THEN
    RAISE EXCEPTION 'ASSERTION INCONCLUSIVE: no employee free of an open session to probe with';
  END IF;

  -- Exactly the column shape PunchInOut.tsx:742 uses: punch_in omitted, taking DEFAULT now().
  INSERT INTO public.attendance
    (tenant_id, employee_id, date, status, session_status, punch_out_allowed,
     punch_in_lat, punch_in_lng, punch_in_location_status)
  VALUES (v_t, v_e, DATE '2032-04-04', 'present', 'open', true, 12.9, 77.6, 'office_verified')
  RETURNING id INTO v_a;

  SELECT count(*) INTO v_ev_after FROM public.attendance_events;
  SELECT count(*) INTO v_at_after  FROM public.attendance;

  IF v_a IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: the legacy direct-insert punch path no longer creates a row';
  END IF;
  IF v_at_after - v_at_before <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: legacy insert moved attendance by % rows, expected exactly 1', v_at_after - v_at_before;
  END IF;
  IF v_ev_after - v_ev_before <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: legacy insert moved the GLOBAL event count by %, expected exactly 1 (a value of 2 is the phantom-event signature)', v_ev_after - v_ev_before;
  END IF;

  -- Roll the probe back. The exception is caught by the enclosing block so the migration
  -- continues; the subtransaction's writes are discarded.
  RAISE EXCEPTION 'ROLLBACK_PROBE_OK';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_PROBE_OK' THEN
      RAISE NOTICE 'legacy path verified globally: +1 attendance, +1 event, no phantom';
    ELSE
      RAISE;
    END IF;
END $legacy_path_global$;

-- ============================================================================
-- 3. The work queue is clean
-- ============================================================================
DO $queue_clean$
DECLARE
  v_queued int;
  v_ids text;
BEGIN
  SELECT count(*), string_agg(id::text, ', ')
    INTO v_queued, v_ids
  FROM public.attendance_events
  WHERE attendance_id IS NULL
    AND skip_derivation = false
    AND offshift = false;

  IF v_queued <> 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % event(s) still sit in the derivation work queue: %', v_queued, v_ids;
  END IF;

  -- The log itself must not have shrunk: quarantine retains evidence, it does not delete it.
  IF (SELECT count(*) FROM public.attendance_events) < 4 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: the event log lost rows -- D11 forbids deletion, quarantine must retain them';
  END IF;
END $queue_clean$;
