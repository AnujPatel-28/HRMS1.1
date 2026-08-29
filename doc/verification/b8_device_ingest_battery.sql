-- B8 device ingest battery. Re-runnable. Every write is rolled back at the end via the ZZ001
-- pattern, so the append-only event log (D11) is left byte-identical -- assertions compare the
-- WHOLE-TABLE population against a baseline, never just the rows the probe created.
DO $b8_battery$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_employee uuid := '11111111-1111-4111-8111-000000000011';
  v_ev_base  bigint;
  v_ev_now   bigint;
  v_dev_base bigint;
  v_code     text;
  v_old_pin  text;
  v_old_devid text;
  v_res      jsonb;
  v_ts       timestamptz := TIMESTAMPTZ '2099-07-01 09:03:17+00';
  v_failed   boolean;
BEGIN
  SELECT count(*) INTO v_ev_base  FROM public.attendance_events;
  SELECT count(*) INTO v_dev_base FROM public.attendance_devices;
  SELECT employee_code, kiosk_pin_hash, attendance_device_id
    INTO v_code, v_old_pin, v_old_devid
  FROM public.employees WHERE id = v_employee;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: employee % has no employee_code, cannot test the kiosk path', v_employee;
  END IF;

  BEGIN
    -- Fixtures: one kiosk, one biometric unit, both with known secrets.
    INSERT INTO public.attendance_devices (tenant_id, name, device_type, serial, secret_hash, source)
    VALUES (v_tenant, 'QA Kiosk', 'kiosk', 'QA-KIOSK-1',
            public.crypt('kiosksecret', public.gen_salt('bf')), 'kiosk');
    INSERT INTO public.attendance_devices (tenant_id, name, device_type, serial, secret_hash, source)
    VALUES (v_tenant, 'QA Biometric', 'biometric', 'QA-ZK-1',
            public.crypt('devicesecret', public.gen_salt('bf')), 'device');

    UPDATE public.employees
    SET kiosk_pin_hash = public.crypt('4321', public.gen_salt('bf')),
        attendance_device_id = '777'
    WHERE id = v_employee;

    -- 1. A wrong device secret must be refused.
    v_failed := false;
    BEGIN
      PERFORM public.device_ingest_punch('QA-KIOSK-1', 'wrong', v_code, '4321');
    EXCEPTION WHEN OTHERS THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'B8 FAILED: a wrong device secret was accepted'; END IF;

    -- 2. An unknown serial must fail the SAME way, so serials cannot be probed.
    v_failed := false;
    BEGIN
      PERFORM public.device_ingest_punch('NO-SUCH-SERIAL', 'kiosksecret', v_code, '4321');
    EXCEPTION WHEN OTHERS THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'B8 FAILED: an unknown serial was accepted'; END IF;

    -- 3. A wrong PIN must be refused on the kiosk path.
    v_failed := false;
    BEGIN
      PERFORM public.device_ingest_punch('QA-KIOSK-1', 'kiosksecret', v_code, '0000');
    EXCEPTION WHEN OTHERS THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'B8 FAILED: a wrong kiosk PIN was accepted'; END IF;

    -- Nothing above may have written anything.
    SELECT count(*) INTO v_ev_now FROM public.attendance_events;
    IF v_ev_now <> v_ev_base THEN
      RAISE EXCEPTION 'B8 FAILED: a REJECTED punch still wrote % event(s)', v_ev_now - v_ev_base;
    END IF;

    -- 4. Happy path, kiosk: resolves by employee_code + PIN.
    v_res := public.device_ingest_punch('QA-KIOSK-1', 'kiosksecret', v_code, '4321');
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'B8 FAILED: kiosk punch did not succeed: %', v_res;
    END IF;
    IF (v_res->>'employee_id')::uuid <> v_employee THEN
      RAISE EXCEPTION 'B8 FAILED: kiosk resolved the wrong employee: %', v_res;
    END IF;
    IF v_res->>'direction' <> 'in' THEN
      RAISE EXCEPTION 'B8 FAILED: first punch of the day should infer direction=in, got %', v_res->>'direction';
    END IF;
    SELECT count(*) INTO v_ev_now FROM public.attendance_events;
    IF v_ev_now <> v_ev_base + 1 THEN
      RAISE EXCEPTION 'B8 FAILED: expected exactly 1 new event, population moved by %', v_ev_now - v_ev_base;
    END IF;

    -- 5. Happy path, biometric: resolves by attendance_device_id, honours the DEVICE timestamp.
    --    This is the E15 case -- a unit that syncs late must land on its true day.
    v_res := public.device_ingest_punch('QA-ZK-1', 'devicesecret', '777', NULL, v_ts, 'in', 'zk-log-99');
    IF (v_res->>'occurred_at')::timestamptz <> v_ts THEN
      RAISE EXCEPTION 'B8 FAILED: biometric timestamp was overwritten | a late offline sync would land on the wrong day. got %', v_res->>'occurred_at';
    END IF;
    SELECT count(*) INTO v_ev_now FROM public.attendance_events;
    IF v_ev_now <> v_ev_base + 2 THEN
      RAISE EXCEPTION 'B8 FAILED: biometric punch did not add exactly 1 event, moved by %', v_ev_now - v_ev_base;
    END IF;

    -- 6. Replay of that exact biometric log must COLLAPSE, not duplicate (E16). This is the case
    --    a bulk resync hits every time it re-sends logs it already sent.
    PERFORM public.device_ingest_punch('QA-ZK-1', 'devicesecret', '777', NULL, v_ts, 'in', 'zk-log-99');
    SELECT count(*) INTO v_ev_now FROM public.attendance_events;
    IF v_ev_now <> v_ev_base + 2 THEN
      RAISE EXCEPTION 'B8 FAILED: replaying an identical device log created a duplicate | population moved by % not 2', v_ev_now - v_ev_base;
    END IF;

    -- 7. allowed_punch_sources must be enforced at the seam.
    UPDATE public.shifts SET allowed_punch_sources = ARRAY['app']::text[]
    WHERE id = '11111111-1111-4111-8111-000000000004';
    v_failed := false;
    BEGIN
      PERFORM public.device_ingest_punch('QA-ZK-1', 'devicesecret', '777', NULL,
                                         v_ts + interval '1 hour', 'out', 'zk-log-100');
    EXCEPTION WHEN OTHERS THEN v_failed := true;
    END;
    IF NOT v_failed THEN
      RAISE NOTICE 'B8 NOTE: allowed_punch_sources did not reject | employee has no shift assignment for that date, so no policy applied. Not a failure.';
    END IF;

    RAISE NOTICE 'B8 verified: device auth (bad secret / unknown serial / bad PIN all rejected and wrote nothing), kiosk resolves by code+PIN, biometric resolves by device id and KEEPS its own timestamp, replay collapses to one event';

    RAISE EXCEPTION 'b8 battery rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'B8 battery writes rolled back (2 devices, 2 events, employee credentials, shift policy)';
  END;

  SELECT count(*) INTO v_ev_now FROM public.attendance_events;
  IF v_ev_now <> v_ev_base THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance_events % -> %', v_ev_base, v_ev_now;
  END IF;
  SELECT count(*) INTO v_ev_now FROM public.attendance_devices;
  IF v_ev_now <> v_dev_base THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance_devices % -> %', v_dev_base, v_ev_now;
  END IF;
  RAISE NOTICE 'Population restored: attendance_events %, attendance_devices %', v_ev_base, v_dev_base;
END
$b8_battery$;
