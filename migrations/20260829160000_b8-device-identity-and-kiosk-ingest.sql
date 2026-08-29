-- B8 phase 1: device identity, employee device/kiosk credentials, and ONE device-authenticated
-- ingest seam that every hardware adapter translates into.
--
-- ############################################################################
-- WHY THIS IS SMALL: THE CANONICAL INGEST ALREADY EXISTS
-- ############################################################################
-- B3 already built the hard half. Verified live before writing this:
--   * attendance_events carries event_time, direction, source, source_ref, evidence, device_ip,
--     lat/lng/location_*, selfie_id, idempotency_key, correlation_id and the shift_* stamps.
--   * attendance_event_ingest(...15 params...) is the canonical writer, SECURITY DEFINER.
--   * attendance_events.source CHECK ALREADY allows 'kiosk' and 'device'.
--   * shifts.allowed_punch_sources is text[] defaulting to all five sources.
-- So B8 is NOT "build an ingestion pipeline". It is "give a device an identity, resolve an
-- employee from what that device can say, enforce the source policy, and hand off to the ingest
-- that already exists". Everything below stops at that seam.
--
-- Idempotency and late arrival are likewise already solved: the event log is append-only with an
-- idempotency key, and derivation is decoupled from ingestion, so a device that syncs three days
-- late lands events at their TRUE timestamps and the affected days simply re-derive (E15/E16).
-- That is why p_occurred_at is honoured for hardware below rather than overwritten with now().
--
-- ############################################################################
-- THE SEAM
-- ############################################################################
--                kiosk tablet ─┐
--                              ├─► device_ingest_punch() ─► attendance_event_ingest() ─► log
--   ZKTeco/eSSL via ADMS ──────┘        (this file)              (already existed)
--
-- device_ingest_punch is the ONLY new way in. An adapter's job is reduced to: authenticate as a
-- device, name an employee in the terms that device knows, and state a time. Nothing about
-- ZKTeco, eSSL or any other vendor reaches the core -- the adapter is an edge function that
-- translates a wire format, not a branch inside the attendance logic.
--
-- Employee resolution differs per device type, which is the ONLY vendor-shaped thing here:
--   kiosk      -> employees.employee_code + a per-employee PIN (the person is present and types)
--   biometric  -> employees.attendance_device_id (the hardware only knows its own enrolled id)
-- attendance_device_id deliberately reuses FRAPPE HR's exact field name, so a tenant migrating
-- from Frappe can import their existing employee/device mapping without a translation step.
--
-- ############################################################################
-- SECURITY POSTURE
-- ############################################################################
-- * Device secrets and employee PINs are stored ONLY as bcrypt hashes (pgcrypto, confirmed
--   installed). The device secret is returned exactly once, at registration, and is
--   unrecoverable afterwards -- there is no "show secret" path by design.
-- * device_ingest_punch verifies the device secret ITSELF rather than trusting its caller, and is
--   project_admin-only so an ordinary session cannot reach it at all. Two independent layers: the
--   edge function must hold service credentials AND present a valid device secret.
-- * serial is GLOBALLY unique, not per-tenant: an ADMS device posts its serial with no tenant
--   context, so the serial is what resolves the tenant. A per-tenant unique would make that
--   resolution ambiguous the first time two tenants owned the same hardware model.
-- * The tenant is derived FROM the device, never accepted as a parameter -- a device cannot be
--   talked into writing into someone else's tenant.
-- * allowed_punch_sources is enforced HERE, at the seam, per the resolved shift.
-- * SECURITY DEFINER bypasses RLS entirely (binding rule 1), so every fence below is explicit.
--
-- Binding rules: no BEGIN/COMMIT/ROLLBACK. No FORCE ROW LEVEL SECURITY. No attendance_events row
-- is edited or deleted and no write policy is added to it (D11) -- this file only ever INSERTs
-- through the existing ingest. No current_date / now()::date business date (D9). Attendance emits
-- facts, never money. Module independence: nothing here reads or assumes payroll.

-- --------------------------------------------------------------------
-- 1. Device identity
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  device_type  text NOT NULL CHECK (device_type IN ('kiosk', 'biometric')),
  -- The identity the device presents. Issued by us for a kiosk; the hardware serial for a
  -- biometric unit. Globally unique -- see the security note above on tenant resolution.
  serial       text NOT NULL UNIQUE,
  secret_hash  text NOT NULL,
  -- Which attendance_events.source this device may write. Constrained to the two device-shaped
  -- values; 'app', 'manual' and 'import' are not device sources.
  source       text NOT NULL CHECK (source IN ('kiosk', 'device')),
  location_id  uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  is_active    boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid
);

COMMENT ON TABLE public.attendance_devices IS
'One row per physical or logical attendance device (B8). A kiosk tablet and a ZKTeco/eSSL biometric unit are the same kind of thing here: an authenticated source of attendance events. secret_hash is bcrypt; the plaintext secret is returned once by hr_register_attendance_device and is unrecoverable afterwards. serial is globally unique because an ADMS device posts its serial with no tenant context, so the serial is what resolves the tenant.';

CREATE INDEX IF NOT EXISTS idx_attendance_devices_tenant ON public.attendance_devices(tenant_id);

ALTER TABLE public.attendance_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_devices_hr_all ON public.attendance_devices;
CREATE POLICY attendance_devices_hr_all ON public.attendance_devices
  FOR ALL TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr())
  WITH CHECK (can_access_tenant(tenant_id) AND is_hr());

-- --------------------------------------------------------------------
-- 2. Employee credentials
-- --------------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS attendance_device_id text,
  ADD COLUMN IF NOT EXISTS kiosk_pin_hash text;

COMMENT ON COLUMN public.employees.attendance_device_id IS
'The id this employee is enrolled under on a biometric device (B8). Named to match FRAPPE HR''s field of the same name so an existing employee/device mapping imports without translation. Unique per tenant when set. Not a secret -- a biometric unit only ever sends this, never a password.';

COMMENT ON COLUMN public.employees.kiosk_pin_hash IS
'bcrypt hash of this employee''s kiosk PIN (B8). Set by hr_set_employee_kiosk_pin; never readable. Used only when a KIOSK device resolves an employee, where the person is physically present and types it. A biometric device resolves by attendance_device_id instead and never sees a PIN.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_attendance_device_id
  ON public.employees(tenant_id, attendance_device_id)
  WHERE attendance_device_id IS NOT NULL;

-- --------------------------------------------------------------------
-- 3. HR: register a device. Returns the secret ONCE.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_register_attendance_device(
  p_tenant_id   uuid,
  p_name        text,
  p_device_type text,
  p_serial      text,
  p_location_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_secret text;
  v_id     uuid;
  v_source text;
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF NOT tenant_has_module_for(p_tenant_id, 'attendance') THEN
    RAISE EXCEPTION 'MODULE_DISABLED';
  END IF;

  IF p_device_type NOT IN ('kiosk', 'biometric') THEN
    RAISE EXCEPTION 'Invalid device type: %', p_device_type;
  END IF;

  IF p_serial IS NULL OR btrim(p_serial) = '' THEN
    RAISE EXCEPTION 'Device serial is required';
  END IF;

  v_source := CASE WHEN p_device_type = 'kiosk' THEN 'kiosk' ELSE 'device' END;

  -- 32 bytes of randomness, hex-encoded. Returned once below and never stored in the clear.
  v_secret := encode(gen_random_bytes(32), 'hex');

  INSERT INTO attendance_devices (tenant_id, name, device_type, serial, secret_hash, source, location_id, created_by)
  VALUES (p_tenant_id, p_name, p_device_type, btrim(p_serial),
          crypt(v_secret, gen_salt('bf')), v_source, p_location_id, v_hr_employee_id)
  RETURNING id INTO v_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (p_tenant_id, v_hr_employee_id, 'hr', 'attendance_device.registered',
          'attendance_devices', v_id,
          jsonb_build_object('name', p_name, 'device_type', p_device_type,
                             'serial', btrim(p_serial), 'severity', 'WARNING'));

  -- The ONLY time the plaintext secret exists outside the caller. There is deliberately no way to
  -- read it back: a lost secret is re-issued by rotating, not recovered.
  RETURN jsonb_build_object('device_id', v_id, 'serial', btrim(p_serial), 'secret', v_secret);
END;
$function$;

REVOKE ALL ON FUNCTION public.hr_register_attendance_device(uuid, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_register_attendance_device(uuid, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_register_attendance_device(uuid, text, text, text, uuid) TO authenticated;

-- --------------------------------------------------------------------
-- 4. HR: set an employee's kiosk PIN
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_set_employee_kiosk_pin(
  p_tenant_id   uuid,
  p_employee_id uuid,
  p_pin         text
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'PIN must be 4 to 8 digits';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  UPDATE employees
  SET kiosk_pin_hash = crypt(p_pin, gen_salt('bf'))
  WHERE id = p_employee_id AND tenant_id = p_tenant_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (p_tenant_id, v_hr_employee_id, 'hr', 'employee.kiosk_pin_set', 'employees', p_employee_id,
          jsonb_build_object('severity', 'WARNING'));

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.hr_set_employee_kiosk_pin(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_set_employee_kiosk_pin(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_set_employee_kiosk_pin(uuid, uuid, text) TO authenticated;

-- --------------------------------------------------------------------
-- 5. THE SEAM: device-authenticated ingest
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
BEGIN
  -- 1. Authenticate the DEVICE. Unknown serial and bad secret return the SAME error: a caller
  --    probing serials must not be able to tell "no such device" from "wrong secret".
  SELECT * INTO v_device FROM attendance_devices WHERE serial = btrim(p_serial);

  IF v_device.id IS NULL
     OR p_secret IS NULL
     OR v_device.secret_hash <> crypt(p_secret, v_device.secret_hash) THEN
    RAISE EXCEPTION 'DEVICE_AUTH_FAILED';
  END IF;

  IF NOT v_device.is_active THEN
    RAISE EXCEPTION 'DEVICE_INACTIVE';
  END IF;

  -- 2. Tenant comes FROM the device. It is never a parameter, so a device cannot be talked into
  --    writing into another tenant.
  IF NOT tenant_has_module_for(v_device.tenant_id, 'attendance') THEN
    RAISE EXCEPTION 'MODULE_DISABLED';
  END IF;

  -- 3. Resolve the employee in the terms this device type can actually speak.
  IF v_device.device_type = 'kiosk' THEN
    SELECT id INTO v_employee_id
    FROM employees
    WHERE tenant_id = v_device.tenant_id
      AND employee_code = btrim(p_employee_ref)
      AND status = 'active'
      AND kiosk_pin_hash IS NOT NULL
      AND kiosk_pin_hash = crypt(COALESCE(p_pin, ''), kiosk_pin_hash);
  ELSE
    SELECT id INTO v_employee_id
    FROM employees
    WHERE tenant_id = v_device.tenant_id
      AND attendance_device_id = btrim(p_employee_ref)
      AND status = 'active';
  END IF;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_RESOLVED';
  END IF;

  -- 4. Time. A kiosk's tablet clock is NOT trusted -- the server decides, exactly as the punch
  --    screen does (D9). A biometric unit's timestamp IS trusted and required, because that is
  --    what makes a three-day-late offline sync land on the right day (E15) instead of collapsing
  --    onto the moment it happened to reconnect.
  IF v_device.device_type = 'kiosk' THEN
    v_occurred := now();
  ELSE
    v_occurred := COALESCE(p_occurred_at, now());
  END IF;

  -- 5. Source policy, enforced at the seam per the employee's shift for that moment.
  SELECT es.shift_id INTO v_shift_id
  FROM employee_shifts es
  WHERE es.tenant_id = v_device.tenant_id
    AND es.employee_id = v_employee_id
    AND es.effective_from <= (v_occurred AT TIME ZONE COALESCE((SELECT timezone FROM tenants WHERE id = v_device.tenant_id), 'UTC'))::date
    AND (es.effective_to IS NULL OR es.effective_to >= (v_occurred AT TIME ZONE COALESCE((SELECT timezone FROM tenants WHERE id = v_device.tenant_id), 'UTC'))::date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    SELECT allowed_punch_sources INTO v_allowed FROM shifts WHERE id = v_shift_id;
    IF v_allowed IS NOT NULL AND NOT (v_device.source = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'SOURCE_NOT_ALLOWED'
        USING DETAIL = format('This shift does not accept punches from a %s source.', v_device.source);
    END IF;
  END IF;

  -- 6. Direction. A device that states one is believed; otherwise it is inferred from whether an
  --    open session exists, which is what a single-button kiosk needs.
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

  -- 7. Idempotency. A device replaying the same punch -- ADMS retries, a double tap, a bulk
  --    resync of already-sent logs -- collapses onto one event rather than creating a second.
  v_idem := v_device.serial || ':' || v_employee_id::text || ':' ||
            to_char(v_occurred AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS') || ':' || v_direction;

  v_event_id := attendance_event_ingest(
    v_device.tenant_id, v_employee_id, v_occurred, v_direction,
    v_device.source, COALESCE(p_source_ref, v_device.serial),
    -- Explicitly typed NULLs for p_attendance_id, p_lat, p_lng, p_location_accuracy,
    -- p_location_status and p_selfie_id: a bare NULL is untyped and resolves by position only,
    -- which silently breaks if the ingest signature ever grows a parameter.
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
'The single device-authenticated way into the attendance event log (B8). Every hardware adapter -- the kiosk tablet, a ZKTeco/eSSL ADMS translator, a future Matrix or Suprema adapter -- calls THIS and nothing else, so no vendor-specific logic ever reaches the attendance core. Authenticates the device by serial + bcrypt secret (unknown serial and wrong secret are indistinguishable by design), derives the tenant FROM the device so it can never write into another one, resolves the employee by employee_code + PIN for a kiosk or by attendance_device_id for a biometric unit, enforces the shift''s allowed_punch_sources at the seam, infers direction from the open session when the device does not state one, and hands off to attendance_event_ingest with an idempotency key so replays and bulk resyncs collapse. Kiosk time is server-decided (D9); biometric time is taken from the device so a late offline sync still lands on the correct day (E15). project_admin only -- reachable solely by an edge function holding service credentials, which must ALSO present a valid device secret.';

REVOKE ALL ON FUNCTION public.device_ingest_punch(text, text, text, text, timestamptz, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.device_ingest_punch(text, text, text, text, timestamptz, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.device_ingest_punch(text, text, text, text, timestamptz, text, text, jsonb) FROM authenticated;
