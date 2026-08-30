-- B8 phase 3 groundwork: make the ADMS trust level an explicit, per-device, opt-in decision.
--
-- ############################################################################
-- THE PROBLEM ADMS CREATES
-- ############################################################################
-- device_ingest_punch authenticates a device with serial + a 32-byte bcrypt-hashed secret. That
-- works for the kiosk, where we issue and store the secret ourselves.
--
-- **ZKTeco/eSSL push (ADMS) devices cannot do that.** The device identifies itself with its
-- serial number in a query string (SN=...) and sends no credential at all. Many units expose only
-- host and port in their network settings, so there is often nowhere to put a shared secret.
--
-- Three ways to respond, and only one of them is honest:
--   1. Require the secret always. Secure, but unusable on hardware that cannot carry one -- which
--      is most of the cheap units this product is aimed at.
--   2. Silently accept serial-only auth for any 'biometric' device. Usable, and quietly turns a
--      guessable 8-to-10 character serial into the entire authentication story for a payroll
--      input. Nobody would ever notice it happened.
--   3. Support both, defaulting to the SECURE one, and make the weak mode a deliberate per-device
--      choice that is recorded on every event it produces.
--
-- This migration implements 3.
--
-- ############################################################################
-- WHAT allow_serial_only ACTUALLY MEANS
-- ############################################################################
-- FALSE (the default): the caller MUST present the device secret. For ADMS this means the tenant
-- configured the unit's server path to carry the secret (some firmware allows a path or an extra
-- query parameter). Preferred wherever the hardware permits it.
--
-- TRUE: the serial alone is accepted. This is a REAL reduction in assurance and is treated as
-- such:
--   * it is per-device, never global, and never a default;
--   * only a 'biometric' device may set it -- a kiosk always issues its own secret, so there is
--     no legitimate reason for one to run serial-only;
--   * every event produced this way is stamped auth_mode='serial_only' in its evidence, so a
--     dispute months later can tell which punches rested on a guessable identifier;
--   * the brute-force ledger still applies, so a serial-guessing sweep still trips the lockout.
--
-- The alternative -- letting the weak path be invisible -- is how a system ends up with payroll
-- inputs nobody can vouch for.
--
-- Binding rules: no BEGIN/COMMIT/ROLLBACK. Signature UNCHANGED so the project_admin-only ACL is
-- preserved by CREATE OR REPLACE. Every rejection still RETURNS rather than raises, or the
-- brute-force counter from 20260829170000 would roll back with it. No frontend file touched.

ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS allow_serial_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.attendance_devices.allow_serial_only IS
'Opt-in, per device: accept the serial alone as authentication, with no secret. Exists because ZKTeco/eSSL ADMS units identify by SN in a query string and frequently have nowhere to carry a shared secret. FALSE by default -- this is a real reduction in assurance, so it is never a default and never global. Only a biometric device may set it; a kiosk always has an issued secret. Every event produced under it is stamped auth_mode=serial_only in its evidence so the weaker provenance stays visible long after the punch.';

-- A kiosk must never run serial-only: we issue its secret, so there is no hardware excuse.
ALTER TABLE public.attendance_devices
  DROP CONSTRAINT IF EXISTS attendance_devices_serial_only_biometric_only;
ALTER TABLE public.attendance_devices
  ADD CONSTRAINT attendance_devices_serial_only_biometric_only
  CHECK (NOT allow_serial_only OR device_type = 'biometric');

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
  v_auth_mode   text;
BEGIN
  SELECT * INTO v_device FROM attendance_devices WHERE serial = v_serial;

  IF v_device.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEVICE_AUTH_FAILED', 'reason', 'DEVICE_AUTH_FAILED');
  END IF;

  SELECT locked_until INTO v_locked
  FROM attendance_device_auth_failures
  WHERE device_serial = v_serial AND employee_ref = '';
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'LOCKED_OUT', 'reason', 'LOCKED_OUT',
                              'retry_after', v_locked);
  END IF;

  -- Device authentication. A secret, when supplied, is ALWAYS verified -- allow_serial_only
  -- relaxes the requirement to present one, it never makes a WRONG secret acceptable.
  IF p_secret IS NOT NULL AND p_secret <> '' THEN
    IF v_device.secret_hash <> crypt(p_secret, v_device.secret_hash) THEN
      PERFORM attendance_record_auth_failure(v_serial, '');
      RETURN jsonb_build_object('success', false, 'error', 'DEVICE_AUTH_FAILED', 'reason', 'DEVICE_AUTH_FAILED');
    END IF;
    v_auth_mode := 'secret';
  ELSIF v_device.allow_serial_only THEN
    v_auth_mode := 'serial_only';
  ELSE
    PERFORM attendance_record_auth_failure(v_serial, '');
    RETURN jsonb_build_object('success', false, 'error', 'DEVICE_AUTH_FAILED', 'reason', 'DEVICE_AUTH_FAILED');
  END IF;

  IF NOT v_device.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEVICE_INACTIVE', 'reason', 'DEVICE_INACTIVE');
  END IF;

  IF NOT tenant_has_module_for(v_device.tenant_id, 'attendance') THEN
    RETURN jsonb_build_object('success', false, 'error', 'MODULE_DISABLED', 'reason', 'MODULE_DISABLED');
  END IF;

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

  DELETE FROM attendance_device_auth_failures
  WHERE device_serial = v_serial AND employee_ref IN ('', v_ref);

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
                            'device_name', v_device.name, 'device_type', v_device.device_type,
                            'auth_mode', v_auth_mode),
    v_idem, NULL::uuid);

  UPDATE attendance_devices SET last_seen_at = now() WHERE id = v_device.id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'employee_id', v_employee_id,
    'direction', v_direction,
    'auth_mode', v_auth_mode,
    'occurred_at', v_occurred);
END;
$function$;

-- --------------------------------------------------------------------
-- Verification
-- --------------------------------------------------------------------
DO $serial_only_check$
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

  -- The properties 20260829170000 established must all survive this rewrite.
  IF position('RAISE EXCEPTION' in v_def) > 0 THEN
    RAISE EXCEPTION 'REGRESSION: a rejection path raises again, which rolls back its own lockout counter';
  END IF;
  IF position('attendance_record_auth_failure' in v_def) = 0
     OR position('LOCKED_OUT' in v_def) = 0 THEN
    RAISE EXCEPTION 'REGRESSION: the brute-force lockout was lost';
  END IF;
  IF position('tenant_has_module_for' in v_def) = 0
     OR position('allowed_punch_sources' in v_def) = 0
     OR position('attendance_event_ingest' in v_def) = 0 THEN
    RAISE EXCEPTION 'REGRESSION: a pre-existing guard or the ingest handoff was lost';
  END IF;

  -- A supplied secret must still be verified even in serial-only mode: the flag relaxes the
  -- REQUIREMENT to present one, it must never make a WRONG one acceptable.
  IF position('IF p_secret IS NOT NULL AND p_secret <> '''' THEN' in v_def) = 0 THEN
    RAISE EXCEPTION 'SERIAL-ONLY FAILED: a supplied secret is no longer verified first';
  END IF;
  IF position('auth_mode' in v_def) = 0 THEN
    RAISE EXCEPTION 'PROVENANCE FAILED: events are not stamped with the auth mode used';
  END IF;

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

  -- A kiosk must not be able to go serial-only.
  BEGIN
    INSERT INTO attendance_devices (tenant_id, name, device_type, serial, secret_hash, source, allow_serial_only)
    VALUES ((SELECT id FROM tenants LIMIT 1), 'probe', 'kiosk', 'SERIAL-ONLY-PROBE',
            crypt('x', gen_salt('bf')), 'kiosk', true);
    RAISE EXCEPTION 'CONSTRAINT FAILED: a kiosk was allowed to run serial-only';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'Serial-only mode verified: opt-in per device, biometric only, a supplied secret is still verified, events carry auth_mode, lockout and all guards intact';
END
$serial_only_check$;
