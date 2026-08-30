-- B8 hardening: brute-force lockout on the device seam, for BOTH the device secret and the
-- employee kiosk PIN.
--
-- ############################################################################
-- THE THREAT
-- ############################################################################
-- kiosk-punch takes no caller authentication by design -- the device serial + secret IS the
-- identity. A kiosk PIN is 4 to 8 digits with, until now, no attempt limit. The device secret is
-- 32 random bytes and is not realistically guessable, but it lives in the tablet's localStorage,
-- so a borrowed or stolen tablet hands an attacker a valid device credential and reduces
-- impersonating a colleague to at most 10,000 tries on a 4-digit PIN.
--
-- That is buddy-punching -- precisely the thing an attendance system exists to prevent. A
-- fraudulent punch here is also a payroll input, since attendance facts feed payroll_period_input.
--
-- ############################################################################
-- THE CONSTRAINT THAT SHAPES THE WHOLE DESIGN
-- ############################################################################
-- **A RAISE rolls back the transaction, including the failure counter.**
--
-- The previous device_ingest_punch signalled every rejection with RAISE EXCEPTION. If the counter
-- increment lives in the same transaction as the RAISE, the increment is rolled back with it and
-- the attacker's attempt is never recorded -- the lockout would count to one, forever. Postgres
-- has no autonomous transactions to escape this.
--
-- So every REJECTION path below now RETURNS a failure envelope instead of raising:
--     {"success": false, "error": "<CODE>", "reason": "<CODE>"}
-- The transaction commits, the counter persists, and the lockout actually works.
--
-- This needs no change in kiosk-punch: it already branches on both `rpcError` and
-- `data.success === false`, reading `data.error` in the latter case. Verified in the deployed
-- source before writing this. `reason` is carried alongside purely for shape-consistency with
-- punch_in_attendance / punch_out_attendance.
--
-- Signature is UNCHANGED, so CREATE OR REPLACE preserves the project_admin-only ACL.
--
-- ############################################################################
-- POLICY
-- ############################################################################
-- 5 failures inside a 15-minute window locks that key for 15 minutes. Two independent keys:
--     (serial, '')            -- device secret failures, i.e. someone guessing the secret
--     (serial, employee_ref)  -- PIN failures for one employee at one device
-- Locking them separately means one employee fat-fingering their PIN cannot lock the whole
-- kiosk for everyone else, while a genuine attack on one account still stops cold.
--
-- A successful punch CLEARS both keys, so ordinary typos never accumulate toward a lockout.
--
-- An UNKNOWN serial is rejected WITHOUT recording anything. Two reasons: there is no device row
-- to key against, and recording unknown serials would let anyone inflate the table at will. It
-- costs nothing defensively -- guessing a serial is useless without the 32-byte secret.
--
-- Unknown serial, wrong secret and wrong PIN still return codes that a caller cannot use to tell
-- them apart in the UI: kiosk-punch maps DEVICE_AUTH_FAILED and EMPLOYEE_NOT_RESOLVED to two
-- messages that reveal only "kiosk not recognised" vs "code or PIN incorrect", never which half.
--
-- Binding rules: no BEGIN/COMMIT/ROLLBACK. No FORCE ROW LEVEL SECURITY. attendance_events is
-- only ever appended to via the existing ingest (D11). No frontend file is touched. Module
-- independence preserved -- nothing here reads payroll.

-- --------------------------------------------------------------------
-- 1. Failure ledger
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_device_auth_failures (
  device_serial     text NOT NULL,
  -- '' means the DEVICE-level key (secret guessing). A non-empty value is the employee reference
  -- that failed. Empty string rather than NULL so the unique constraint actually dedupes -- in a
  -- unique index NULLs are distinct from each other, so a NULL here would let unbounded duplicate
  -- device-level rows accumulate and the lockout would never trigger.
  employee_ref      text NOT NULL DEFAULT '',
  failed_count      integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_serial, employee_ref)
);

COMMENT ON TABLE public.attendance_device_auth_failures IS
'Brute-force ledger for the device ingest seam (B8). Two key shapes: (serial, '''') counts device-secret failures, (serial, employee_ref) counts PIN failures for one employee at one device -- separated so one person mistyping their PIN cannot lock a shared kiosk for everyone. 5 failures in 15 minutes locks that key for 15 minutes; a successful punch clears both. Written ONLY by device_ingest_punch, which is why every rejection path in that function RETURNS a failure envelope rather than raising: a RAISE would roll back the very counter it needs to persist.';

-- RLS on with NO policies: this is internal bookkeeping. device_ingest_punch is SECURITY DEFINER
-- and runs as the owner, so it is unaffected; every API-role read or write is denied outright.
-- Deliberately no HR policy either -- there is nothing here HR needs to see, and the table would
-- otherwise leak which employee codes are being probed.
ALTER TABLE public.attendance_device_auth_failures ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------
-- 2. Recording a failure (separate so the seam stays readable)
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_record_auth_failure(p_serial text, p_employee_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_window   interval := interval '15 minutes';
  v_max      integer  := 5;
  v_lockout  interval := interval '15 minutes';
  v_count    integer;
  v_start    timestamptz;
BEGIN
  SELECT failed_count, window_started_at INTO v_count, v_start
  FROM attendance_device_auth_failures
  WHERE device_serial = p_serial AND employee_ref = COALESCE(p_employee_ref, '');

  -- A stale window starts over rather than accumulating across hours.
  IF v_start IS NULL OR v_start < now() - v_window THEN
    v_count := 1;
    v_start := now();
  ELSE
    v_count := v_count + 1;
  END IF;

  INSERT INTO attendance_device_auth_failures
    (device_serial, employee_ref, failed_count, window_started_at, locked_until, updated_at)
  VALUES (p_serial, COALESCE(p_employee_ref, ''), v_count, v_start,
          CASE WHEN v_count >= v_max THEN now() + v_lockout ELSE NULL END, now())
  ON CONFLICT (device_serial, employee_ref) DO UPDATE
    SET failed_count      = EXCLUDED.failed_count,
        window_started_at = EXCLUDED.window_started_at,
        locked_until      = EXCLUDED.locked_until,
        updated_at        = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.attendance_record_auth_failure(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attendance_record_auth_failure(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.attendance_record_auth_failure(text, text) FROM authenticated;

-- --------------------------------------------------------------------
-- 3. The seam, with lockout and return-instead-of-raise
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.device_ingest_punch(
  p_serial       text,
  p_secret       text,
  p_employee_ref text,
  p_pin          text DEFAULT NULL,
  p_occurred_at  timestamptz DEFAULT NULL,
  p_direction    text DEFAULT NULL,
  p_source_ref   text DEFAULT NULL,
  p_evidence     jsonb DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_device      attendance_devices%ROWTYPE;
  v_employee_id uuid;
  v_occurred    timestamptz;
  v_direction   text;
  v_open_id     uuid;
  v_shift_id    uuid;
  v_allowed     text[];
  v_event_id    uuid;
  v_idem        text;
  v_ref         text := btrim(COALESCE(p_employee_ref, ''));
  v_serial      text := btrim(COALESCE(p_serial, ''));
  v_locked      timestamptz;
  v_tz          text;
  v_local_date  date;
BEGIN
  SELECT * INTO v_device FROM attendance_devices WHERE serial = v_serial;

  -- Unknown serial: rejected, and deliberately NOT recorded (see header).
  IF v_device.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEVICE_AUTH_FAILED', 'reason', 'DEVICE_AUTH_FAILED');
  END IF;

  -- Device-level lockout.
  SELECT locked_until INTO v_locked
  FROM attendance_device_auth_failures
  WHERE device_serial = v_serial AND employee_ref = '';
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'LOCKED_OUT', 'reason', 'LOCKED_OUT',
                              'retry_after', v_locked);
  END IF;

  IF p_secret IS NULL OR v_device.secret_hash <> crypt(p_secret, v_device.secret_hash) THEN
    PERFORM attendance_record_auth_failure(v_serial, '');
    RETURN jsonb_build_object('success', false, 'error', 'DEVICE_AUTH_FAILED', 'reason', 'DEVICE_AUTH_FAILED');
  END IF;

  IF NOT v_device.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEVICE_INACTIVE', 'reason', 'DEVICE_INACTIVE');
  END IF;

  IF NOT tenant_has_module_for(v_device.tenant_id, 'attendance') THEN
    RETURN jsonb_build_object('success', false, 'error', 'MODULE_DISABLED', 'reason', 'MODULE_DISABLED');
  END IF;

  -- Per-employee lockout, so one person's typos cannot lock the shared kiosk for everyone.
  SELECT locked_until INTO v_locked
  FROM attendance_device_auth_failures
  WHERE device_serial = v_serial AND employee_ref = v_ref;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'LOCKED_OUT', 'reason', 'LOCKED_OUT',
                              'retry_after', v_locked);
  END IF;

  IF v_device.device_type = 'kiosk' THEN
    SELECT id INTO v_employee_id
    FROM employees
    WHERE tenant_id = v_device.tenant_id
      AND employee_code = v_ref
      AND status = 'active'
      AND kiosk_pin_hash IS NOT NULL
      AND kiosk_pin_hash = crypt(COALESCE(p_pin, ''), kiosk_pin_hash);
  ELSE
    SELECT id INTO v_employee_id
    FROM employees
    WHERE tenant_id = v_device.tenant_id
      AND attendance_device_id = v_ref
      AND status = 'active';
  END IF;

  IF v_employee_id IS NULL THEN
    PERFORM attendance_record_auth_failure(v_serial, v_ref);
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_NOT_RESOLVED', 'reason', 'EMPLOYEE_NOT_RESOLVED');
  END IF;

  -- Authenticated. Clear both keys so ordinary typos never accumulate.
  DELETE FROM attendance_device_auth_failures
  WHERE device_serial = v_serial AND employee_ref IN ('', v_ref);

  -- Kiosk time is server-decided (D9 -- a tablet clock is the untrusted device clock B7b removed).
  -- A biometric unit's own timestamp is honoured, which is what lets a three-day-late offline sync
  -- land on its true day (E15) instead of collapsing onto the reconnect moment.
  IF v_device.device_type = 'kiosk' THEN
    v_occurred := now();
  ELSE
    v_occurred := COALESCE(p_occurred_at, now());
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM tenants WHERE id = v_device.tenant_id;
  v_local_date := (v_occurred AT TIME ZONE v_tz)::date;

  SELECT es.shift_id INTO v_shift_id
  FROM employee_shifts es
  WHERE es.tenant_id = v_device.tenant_id
    AND es.employee_id = v_employee_id
    AND es.effective_from <= v_local_date
    AND (es.effective_to IS NULL OR es.effective_to >= v_local_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    SELECT allowed_punch_sources INTO v_allowed FROM shifts WHERE id = v_shift_id;
    IF v_allowed IS NOT NULL AND NOT (v_device.source = ANY (v_allowed)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_ALLOWED', 'reason', 'SOURCE_NOT_ALLOWED');
    END IF;
  END IF;

  IF p_direction IN ('in', 'out') THEN
    v_direction := p_direction;
  ELSE
    SELECT id INTO v_open_id
    FROM attendance
    WHERE tenant_id = v_device.tenant_id
      AND employee_id = v_employee_id
      AND session_status = 'open'
    LIMIT 1;
    v_direction := CASE WHEN v_open_id IS NULL THEN 'in' ELSE 'out' END;
  END IF;

  v_idem := v_device.serial || ':' || v_employee_id::text || ':' ||
            to_char(v_occurred AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS') || ':' || v_direction;

  v_event_id := attendance_event_ingest(
    v_device.tenant_id, v_employee_id, v_occurred, v_direction,
    v_device.source, COALESCE(p_source_ref, v_device.serial),
    NULL::uuid, NULL::numeric, NULL::numeric, NULL::numeric, NULL::text, NULL::uuid,
    COALESCE(p_evidence, '{}'::jsonb)
      || jsonb_build_object('device_id', v_device.id, 'device_serial', v_device.serial,
                            'device_name', v_device.name, 'device_type', v_device.device_type),
    v_idem, NULL::uuid);

  UPDATE attendance_devices SET last_seen_at = now() WHERE id = v_device.id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'employee_id', v_employee_id,
    'direction', v_direction,
    'occurred_at', v_occurred);
END;
$function$;

COMMENT ON FUNCTION public.device_ingest_punch(text, text, text, text, timestamptz, text, text, jsonb) IS
'The single device-authenticated way into the attendance event log (B8). Every hardware adapter -- kiosk, ZKTeco/eSSL ADMS, any future vendor -- calls THIS and nothing else, so no vendor logic reaches the attendance core. Authenticates the device by serial + bcrypt secret, derives the tenant FROM the device so it can never write into another one, resolves the employee by employee_code + PIN for a kiosk or by attendance_device_id for a biometric unit, enforces the shift''s allowed_punch_sources, infers direction from the open session when the device does not state one, and hands off to attendance_event_ingest with an idempotency key so replays and bulk resyncs collapse. Kiosk time is server-decided (D9); biometric time comes from the device so a late offline sync still lands on the correct day (E15). Since 20260829170000 every REJECTION RETURNS {success:false,error:CODE} rather than raising -- a RAISE would roll back the brute-force counter in attendance_device_auth_failures that the same call just wrote, which would silently defeat the lockout. project_admin only.';

-- --------------------------------------------------------------------
-- 4. Verification
-- --------------------------------------------------------------------
DO $lockout_check$
DECLARE
  v_def text;
  v_n   integer;
BEGIN
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
           '[ \t]+', ' ', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'device_ingest_punch';

  -- The whole point: no rejection path may RAISE, or it rolls back its own counter.
  IF position('RAISE EXCEPTION' in v_def) > 0 THEN
    RAISE EXCEPTION 'LOCKOUT FAILED: device_ingest_punch still raises somewhere -- a raise rolls back the failure counter it just wrote';
  END IF;
  IF position('attendance_record_auth_failure' in v_def) = 0 THEN
    RAISE EXCEPTION 'LOCKOUT FAILED: the seam never records a failure';
  END IF;
  IF position('LOCKED_OUT' in v_def) = 0 THEN
    RAISE EXCEPTION 'LOCKOUT FAILED: the seam never checks a lockout';
  END IF;
  -- The guards that existed before must survive this rewrite.
  IF position('tenant_has_module_for' in v_def) = 0
     OR position('allowed_punch_sources' in v_def) = 0
     OR position('attendance_event_ingest' in v_def) = 0 THEN
    RAISE EXCEPTION 'REGRESSION: a pre-existing guard or the ingest handoff was lost';
  END IF;

  -- Signature preserved, so the ACL survived CREATE OR REPLACE.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'device_ingest_punch';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OVERLOAD FAILED: expected 1 device_ingest_punch, got %', v_n;
  END IF;
  IF has_function_privilege('authenticated',
       'public.device_ingest_punch(text,text,text,text,timestamptz,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.device_ingest_punch(text,text,text,text,timestamptz,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL FAILED: device_ingest_punch is reachable by an API role';
  END IF;

  -- The ledger must be unreachable from the API roles.
  IF has_table_privilege('authenticated', 'public.attendance_device_auth_failures', 'SELECT')
     AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='attendance_device_auth_failures') THEN
    RAISE EXCEPTION 'LEDGER EXPOSED: a policy grants API-role access to the brute-force ledger';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.attendance_device_auth_failures'::regclass) THEN
    RAISE EXCEPTION 'LEDGER EXPOSED: RLS is not enabled on attendance_device_auth_failures';
  END IF;

  RAISE NOTICE 'Lockout verified: no rejection path raises, failures are recorded, lockout is checked, guards intact, one overload, project_admin only, ledger RLS-enabled with no policies';
END
$lockout_check$;
