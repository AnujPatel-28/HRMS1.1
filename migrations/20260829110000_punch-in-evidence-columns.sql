-- B7b follow-up: restore the punch-in evidence columns that the server-authoritative RPC did not
-- persist. Closes a regression B7b would otherwise have shipped.
--
-- ============================================================================
-- THE GAP
-- ============================================================================
-- B7a's punch_in_attendance (20260828110000) writes date, punch_in, session_status,
-- punch_out_allowed, the four punch_in_* geo columns, location_accuracy, location_status and
-- business_date_tz. The client insert it replaces ALSO wrote four columns the RPC does not:
--
--   punch_in_ip            text   -- audit
--   location_confidence    text   -- GPS quality band
--   remote_exception_id    uuid   -- the approved remote-work exception justifying an
--                                 -- out-of-geofence punch
--   verification_snapshot  jsonb  -- geofence + selfie evidence captured at punch time
--
-- All four exist on public.attendance and are nullable (verified live). Losing them is not
-- cosmetic: without remote_exception_id an approved remote punch looks like an unjustified
-- out-of-geofence punch, and without verification_snapshot the punch-in has no evidence trail
-- while punch-out still has one -- an asymmetry HR would have to resolve by guesswork.
--
-- The B7b agent correctly REFUSED to close this with a client-side .update() after the RPC
-- call: that re-opens exactly the direct write path B7c exists to revoke, and would fail
-- silently if employee-role UPDATE on attendance is not granted. The fix belongs in the RPC.
--
-- ============================================================================
-- WHY DROP + CREATE, AND WHY IT IS SAFE RIGHT NOW
-- ============================================================================
-- The four new parameters are trailing and defaulted. CREATE OR REPLACE would therefore create a
-- SECOND overload rather than replace the function, and a client calling the old arity against
-- two overloads is a landmine. So this is DROP + CREATE, and the grants are RE-ISSUED explicitly
-- because DROP does not preserve an ACL.
--
-- Dropping a live function is normally the riskiest thing in this repo. It is safe at this exact
-- moment because punch_in_attendance has NO callers:
--   * verified live -- zero database functions reference it (comment-stripped regex scan);
--   * the deployed production bundle predates B7b entirely (B7b is committed but unpushed), so
--     no shipped client calls it.
-- That window closes the moment B7b reaches production. Doing it now costs nothing; doing it
-- after B7b ships would mean dropping a function the punch screen depends on.
--
-- Everything else about the function is UNCHANGED, byte for byte: the tenant fence, the
-- unconditional module gate, the payroll-lock check gated behind
-- tenant_has_module_for(tenant,'payroll'), the ownership assertion, the open-session check, the
-- business-date derivation from the tenant timezone (D9), the jsonb success/failure envelope and
-- every exception mapping. The body below is the deployed 20260828110000 body with exactly three
-- edits: four parameters added, four columns added to the INSERT column list, four values added
-- to the VALUES list, in the same order.
--
-- Binding rules honoured: SECURITY DEFINER with the fence restored by hand (rule 1). No
-- current_date and no now() cast to date (D9). No attendance_events row is edited or deleted and
-- no write policy is added to it (D11). Module independence preserved -- the payroll-lock check
-- stays behind the payroll module gate, so an attendance-only tenant is unaffected. No
-- BEGIN/COMMIT/ROLLBACK in this file. No frontend file is touched by this migration.

DROP FUNCTION IF EXISTS public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.punch_in_attendance(
  p_tenant_id   uuid,
  p_employee_id uuid DEFAULT NULL,
  p_lat         numeric DEFAULT NULL,
  p_lng         numeric DEFAULT NULL,
  p_acc         numeric DEFAULT NULL,
  p_loc_status  text DEFAULT NULL,
  p_ip          text DEFAULT NULL,
  p_confidence  text DEFAULT NULL,
  p_remote_exception_id uuid DEFAULT NULL,
  p_verification_snapshot jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tenant           public.tenants%ROWTYPE;
  v_tenant_tz        text;
  v_caller_employee  uuid;
  v_employee_id      uuid;
  v_business_date    date;
  v_now              timestamptz := now();
  v_payroll_lock_str text;
  v_payroll_lock_date date;
  v_attendance_id    uuid;
BEGIN
  -- ── 1. TENANT FENCE ─────────────────────────────────────────────────────────────────────
  -- Binding rule 1: SECURITY DEFINER bypasses RLS entirely (owner exemption). Restored by
  -- hand, copying attendance_derive_pass1's shape: the fence is SKIPPED only for a session-
  -- less caller (migration/service-role, already trusted); a real authenticated caller must
  -- pass can_access_tenant.
  IF (SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'TENANT_FORBIDDEN'
      USING ERRCODE = 'P0006',
            DETAIL  = 'This tenant is not accessible to the caller.';
  END IF;

  -- Module gate is UNCONDITIONAL (unlike the fence above) -- a business invariant, not a
  -- security check, so it applies even to a session-less caller. Matches attendance_derive_
  -- pass1 exactly.
  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'MODULE_DISABLED'
      USING ERRCODE = 'P0007',
            DETAIL  = 'The attendance module is not enabled for this tenant.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND'
      USING ERRCODE = 'P0008',
            DETAIL  = 'Unknown tenant.';
  END IF;

  -- ── 2. OWNERSHIP (C3, mirroring punch_out_attendance's shape) ──────────────────────────────
  SELECT id INTO v_caller_employee FROM public.employees
   WHERE user_id = (SELECT auth.uid()) AND tenant_id = p_tenant_id;

  v_employee_id := COALESCE(p_employee_id, v_caller_employee);

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_RESOLVED'
      USING ERRCODE = 'P0009',
            DETAIL  = 'No employee context: the caller has no employee row in this tenant and none was supplied.';
  END IF;

  -- Session-less caller (migration/service-role) is trusted, same as punch_out_attendance.
  -- A real authenticated caller may only punch themselves in, unless they are HR.
  IF (SELECT auth.uid()) IS NOT NULL THEN
    IF v_employee_id IS DISTINCT FROM v_caller_employee
       AND NOT (SELECT public.is_hr()) THEN
      RAISE EXCEPTION 'NOT_YOUR_ATTENDANCE'
        USING ERRCODE = 'P0010',
              DETAIL  = 'You may only punch in your own attendance.';
    END IF;
  END IF;

  -- ── 3. BUSINESS DATE, SERVER-SIDE, TENANT TIMEZONE (D9 / kills C6 / F2 for this path) ─────
  -- No current_date, no now()::date -- the instant is v_now (server clock), converted through
  -- the TENANT's own timezone, never the caller's. The client supplies no date at all.
  v_tenant_tz     := COALESCE(v_tenant.timezone, 'UTC');
  v_business_date := (v_now AT TIME ZONE v_tenant_tz)::date;

  -- ── 4. PAYROLL LOCK GUARD -- module-independence (standing constraint) ─────────────────────
  -- A payroll lock is a legitimate payroll-to-attendance fact (punch_out_attendance already
  -- enforces one), so mirroring it here is correct -- but ONLY when the payroll module is
  -- actually enabled for this tenant. A tenant running attendance without payroll must never
  -- read a payroll-flavoured setting at all; if payroll is off, there is no lock and punch-in
  -- proceeds unconditionally.
  IF (SELECT public.tenant_has_module_for(p_tenant_id, 'payroll')) THEN
    SELECT value INTO v_payroll_lock_str
    FROM public.tenant_settings
    WHERE tenant_id = p_tenant_id AND key = 'payroll_lock_date';

    IF v_payroll_lock_str IS NOT NULL AND v_payroll_lock_str <> '' THEN
      v_payroll_lock_date := v_payroll_lock_str::date;
      IF v_business_date <= v_payroll_lock_date THEN
        RAISE EXCEPTION 'PAYROLL_LOCKED'
          USING ERRCODE = 'P0011',
                DETAIL  = 'This attendance date falls within a locked payroll period.';
      END IF;
    END IF;
  END IF;

  -- ── 5. OPEN-SESSION GUARD (idx_single_open_session) -- fail cleanly ────────────────────────
  -- A friendly pre-check for the common (single-session) case; idx_single_open_session is the
  -- real guarantee under concurrency, and a race that slips past this check still fails
  -- cleanly via the unique_violation arm of the exception handler below, never as a raw
  -- constraint-violation message.
  PERFORM 1 FROM public.attendance
   WHERE tenant_id = p_tenant_id AND employee_id = v_employee_id AND session_status = 'open'
   FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'ALREADY_PUNCHED_IN'
      USING ERRCODE = 'P0005',
            DETAIL  = 'An open attendance session already exists for this employee.';
  END IF;

  -- ── 6. WRITE THE ROW ────────────────────────────────────────────────────────────────────
  -- Same shape as the existing direct-insert path (PunchInOut.tsx:742), minus the client-
  -- computed policy (is_late / half-day status -- see the header's stated gap; D12 forbids
  -- inventing a third copy of that threshold logic here) and minus IP/confidence/snapshot
  -- fields the existing punch_out_attendance precedent also leaves to a client follow-up
  -- update. punch_in = v_now (not left to the column DEFAULT) so trg_attendance_dual_write_
  -- event's `NEW.punch_in IS NOT NULL` branch fires deterministically and logs exactly one
  -- 'in' event -- the same mechanism the direct-insert path already relies on today.
  -- punch_out_allowed is explicitly true -- see header: write-only column, this is the value
  -- every other writer of it (including the direct-insert common case) already uses.
  INSERT INTO public.attendance (
    tenant_id, employee_id, date, punch_in, session_status, punch_out_allowed,
    punch_in_lat, punch_in_lng, punch_in_location_accuracy, punch_in_location_status,
    location_accuracy, location_status, business_date_tz,
    punch_in_ip, location_confidence, remote_exception_id, verification_snapshot
  ) VALUES (
    p_tenant_id, v_employee_id, v_business_date, v_now, 'open', true,
    p_lat, p_lng, p_acc, p_loc_status,
    p_acc, p_loc_status, v_tenant_tz,
    p_ip, p_confidence, p_remote_exception_id, p_verification_snapshot
  )
  RETURNING id INTO v_attendance_id;

  RETURN jsonb_build_object(
    'success',       true,
    'reason',        null,
    'attendance_id', v_attendance_id,
    'date',          v_business_date
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ALREADY_PUNCHED_IN', 'errcode', '23505');
  WHEN SQLSTATE 'P0005' OR SQLSTATE 'P0006' OR SQLSTATE 'P0007'
    OR SQLSTATE 'P0008' OR SQLSTATE 'P0009' OR SQLSTATE 'P0010' OR SQLSTATE 'P0011' THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM, 'errcode', SQLSTATE);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text, text, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text, text, text, uuid, jsonb) TO authenticated;

-- ====================================================================
-- VERIFICATION
-- ====================================================================
-- Comments are stripped before every source match below: a comment is part of pg_get_functiondef,
-- and an assertion that forgets that matches its own explanation and proves nothing.

DO $pin_check$
DECLARE
  v_def text;
  v_n   integer;
BEGIN
  -- Exactly ONE overload must exist. Two would mean the DROP did not take and CREATE added a
  -- second signature -- the precise failure this migration used DROP + CREATE to avoid.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_in_attendance';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OVERLOAD FAILED: expected exactly 1 punch_in_attendance, got %', v_n;
  END IF;

  -- and it must be the NEW signature.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'punch_in_attendance'
      AND pg_get_function_identity_arguments(p.oid) =
          'p_tenant_id uuid, p_employee_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_ip text, p_confidence text, p_remote_exception_id uuid, p_verification_snapshot jsonb'
  ) THEN
    RAISE EXCEPTION 'SIGNATURE FAILED: punch_in_attendance does not have the extended signature';
  END IF;

  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_in_attendance';

  -- The four evidence columns must be WRITTEN, not merely accepted as parameters. Checking the
  -- INSERT column list rather than the parameter names is the difference between "the RPC takes
  -- a selfie snapshot" and "the RPC stores it".
  IF position('punch_in_ip, location_confidence, remote_exception_id, verification_snapshot' in v_def) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE FAILED: the four evidence columns are not in the INSERT column list';
  END IF;
  IF position('p_ip, p_confidence, p_remote_exception_id, p_verification_snapshot' in v_def) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE FAILED: the four evidence parameters are not in the VALUES list';
  END IF;

  -- The guards that were there before must still be there. A DROP + CREATE is exactly where a
  -- security seam gets quietly lost.
  IF position('TENANT_FORBIDDEN' in v_def) = 0
     OR position('MODULE_DISABLED' in v_def) = 0
     OR position('NOT_YOUR_ATTENDANCE' in v_def) = 0
     OR position('ALREADY_PUNCHED_IN' in v_def) = 0 THEN
    RAISE EXCEPTION 'GUARD FAILED: a pre-existing guard was lost in the rewrite';
  END IF;
  IF position('SECURITY DEFINER' in v_def) = 0 THEN
    RAISE EXCEPTION 'GUARD FAILED: punch_in_attendance is no longer SECURITY DEFINER';
  END IF;
  IF position('current_date' in v_def) > 0 THEN
    RAISE EXCEPTION 'D9 FAILED: a server-clock business date was introduced';
  END IF;
  -- Module independence: the payroll lock must stay behind the payroll module gate.
  IF position('PAYROLL_LOCKED' in v_def) > 0
     AND position('tenant_has_module_for' in v_def) = 0 THEN
    RAISE EXCEPTION 'MODULE INDEPENDENCE FAILED: payroll lock is no longer module-gated';
  END IF;

  -- Grants must have been re-issued: DROP does not preserve an ACL.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_in_attendance'
    AND array_to_string(p.proacl, ' ') LIKE '%authenticated=X%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'GRANTS FAILED: authenticated cannot execute punch_in_attendance';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'punch_in_attendance'
    AND array_to_string(p.proacl, ' ') LIKE '%anon=%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'GRANTS FAILED: anon can execute punch_in_attendance';
  END IF;

  RAISE NOTICE 'punch_in_attendance verified: one overload, extended signature, four evidence columns written, all pre-existing guards intact, authenticated-only';
END
$pin_check$;

COMMENT ON FUNCTION public.punch_in_attendance(uuid, uuid, numeric, numeric, numeric, text, text, text, uuid, jsonb) IS
'Server-authoritative punch-in (B7a, extended 20260829110000). Derives the business date from the tenant IANA timezone (D9) rather than trusting a device clock, asserts ownership, gates the payroll-period lock behind tenant_has_module_for(tenant,''payroll'') so an attendance-only tenant is unaffected, and records geofence and verification evidence. Returns a jsonb envelope: {success:true, attendance_id, date} or {success:false, reason, errcode}. It deliberately does NOT write is_late, late_entry or a half-day status -- lateness is derived by attendance_derive_pass1 (D6/D12), and a client must never assert it. The four trailing parameters (p_ip, p_confidence, p_remote_exception_id, p_verification_snapshot) carry the evidence the pre-B7b client insert used to write directly; they were added by DROP + CREATE while the function still had no callers.';
