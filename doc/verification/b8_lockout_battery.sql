-- B8 lockout battery. Re-runnable; rolls itself back. The assertion that matters most is #2:
-- the failure counter must SURVIVE a rejected call. If device_ingest_punch ever goes back to
-- raising on rejection, the counter rolls back with the raise and the lockout silently counts to
-- one forever. That is the failure this battery exists to catch.
DO $b8_lockout$
DECLARE
  v_tenant   uuid := '11111111-1111-4111-8111-000000000001';
  v_employee uuid := '11111111-1111-4111-8111-000000000011';
  v_ev_base  bigint;
  v_ev_now   bigint;
  v_dev_base bigint;
  v_code     text;
  v_res      jsonb;
  v_count    integer;
  v_locked   timestamptz;
  i          integer;
BEGIN
  SELECT count(*) INTO v_ev_base  FROM public.attendance_events;
  SELECT count(*) INTO v_dev_base FROM public.attendance_devices;
  SELECT employee_code INTO v_code FROM public.employees WHERE id = v_employee;

  BEGIN
    INSERT INTO public.attendance_devices (tenant_id, name, device_type, serial, secret_hash, source)
    VALUES (v_tenant, 'QA Lock Kiosk', 'kiosk', 'QA-LOCK-1',
            public.crypt('goodsecret', public.gen_salt('bf')), 'kiosk');

    UPDATE public.employees
    SET kiosk_pin_hash = public.crypt('4321', public.gen_salt('bf'))
    WHERE id = v_employee;

    -- 1. A rejection must RETURN an envelope, not raise. If this call raises, the whole block
    --    aborts and the battery fails loudly rather than silently proving nothing.
    v_res := public.device_ingest_punch('QA-LOCK-1', 'wrongsecret', v_code, '4321');
    IF (v_res->>'success')::boolean IS NOT FALSE THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: a wrong secret was accepted: %', v_res;
    END IF;
    IF v_res->>'error' <> 'DEVICE_AUTH_FAILED' THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: unexpected error code %', v_res->>'error';
    END IF;

    -- 2. THE KEY ASSERTION: that rejected call must have LEFT A COUNTER BEHIND.
    SELECT failed_count INTO v_count
    FROM public.attendance_device_auth_failures
    WHERE device_serial = 'QA-LOCK-1' AND employee_ref = '';
    IF COALESCE(v_count, 0) <> 1 THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: the failure counter did not persist across a rejection (got %). This is what a RAISE-on-rejection would do.', COALESCE(v_count, 0);
    END IF;

    -- 3. Four more bad secrets reach the threshold of 5.
    FOR i IN 1..4 LOOP
      PERFORM public.device_ingest_punch('QA-LOCK-1', 'wrongsecret', v_code, '4321');
    END LOOP;

    SELECT failed_count, locked_until INTO v_count, v_locked
    FROM public.attendance_device_auth_failures
    WHERE device_serial = 'QA-LOCK-1' AND employee_ref = '';
    IF v_count <> 5 THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: expected 5 recorded failures, got %', v_count;
    END IF;
    IF v_locked IS NULL OR v_locked <= now() THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: 5 failures did not set a future locked_until (got %)', v_locked;
    END IF;

    -- 4. Now even the CORRECT secret is refused while the lock holds. This is the property that
    --    actually stops a brute force.
    v_res := public.device_ingest_punch('QA-LOCK-1', 'goodsecret', v_code, '4321');
    IF v_res->>'error' <> 'LOCKED_OUT' THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: a locked device still processed a valid secret: %', v_res;
    END IF;

    SELECT count(*) INTO v_ev_now FROM public.attendance_events;
    IF v_ev_now <> v_ev_base THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: locked-out attempts wrote % event(s)', v_ev_now - v_ev_base;
    END IF;

    -- 5. PIN failures are keyed SEPARATELY from device failures, so one employee mistyping cannot
    --    lock the shared kiosk for everybody.
    DELETE FROM public.attendance_device_auth_failures WHERE device_serial = 'QA-LOCK-1';
    v_res := public.device_ingest_punch('QA-LOCK-1', 'goodsecret', v_code, '0000');
    IF v_res->>'error' <> 'EMPLOYEE_NOT_RESOLVED' THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: a wrong PIN gave % instead of EMPLOYEE_NOT_RESOLVED', v_res->>'error';
    END IF;
    SELECT failed_count INTO v_count
    FROM public.attendance_device_auth_failures
    WHERE device_serial = 'QA-LOCK-1' AND employee_ref = v_code;
    IF COALESCE(v_count, 0) <> 1 THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: a PIN failure was not recorded against the employee key';
    END IF;
    IF EXISTS (SELECT 1 FROM public.attendance_device_auth_failures
               WHERE device_serial = 'QA-LOCK-1' AND employee_ref = '') THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: a PIN failure also counted against the DEVICE key, so one employee could lock the whole kiosk';
    END IF;

    -- 6. A successful punch clears the counters, so ordinary typos never accumulate.
    v_res := public.device_ingest_punch('QA-LOCK-1', 'goodsecret', v_code, '4321');
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: a valid punch was refused after one typo: %', v_res;
    END IF;
    IF EXISTS (SELECT 1 FROM public.attendance_device_auth_failures WHERE device_serial = 'QA-LOCK-1') THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: a successful punch did not clear the failure counters';
    END IF;
    SELECT count(*) INTO v_ev_now FROM public.attendance_events;
    IF v_ev_now <> v_ev_base + 1 THEN
      RAISE EXCEPTION 'LOCKOUT FAILED: the successful punch should add exactly 1 event, moved by %', v_ev_now - v_ev_base;
    END IF;

    RAISE NOTICE 'Lockout verified: rejections return envelopes and PERSIST their counter, 5 failures lock the key, a locked key refuses even a correct secret and writes nothing, PIN failures are keyed separately from device failures, and a success clears both';

    RAISE EXCEPTION 'b8 lockout rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'lockout battery writes rolled back (1 device, 1 event, counters, employee PIN)';
  END;

  SELECT count(*) INTO v_ev_now FROM public.attendance_events;
  IF v_ev_now <> v_ev_base THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance_events % to %', v_ev_base, v_ev_now;
  END IF;
  SELECT count(*) INTO v_ev_now FROM public.attendance_devices;
  IF v_ev_now <> v_dev_base THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: attendance_devices % to %', v_dev_base, v_ev_now;
  END IF;
  RAISE NOTICE 'Population restored: attendance_events %, attendance_devices %', v_ev_base, v_dev_base;
END
$b8_lockout$;
