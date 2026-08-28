-- Repoint approve_leave_request's ON CONFLICT at the new attendance unique key.
--
-- ============================================================================
-- WHAT BROKE, AND WHY IT WAS INVISIBLE
-- ============================================================================
-- 20260824100000 replaced `attendance_employee_id_date_key UNIQUE (employee_id, date)`
-- with `attendance_tenant_employee_date_shift_key`, so that B6 Pass 1 can write one row
-- per employee per day PER SHIFT (decision doc §5.2). That was correct and required.
--
-- But an ON CONFLICT inference clause names index COLUMNS, not a constraint by name, and
-- it must match an existing unique index EXACTLY. approve_leave_request still said:
--
--     ON CONFLICT (employee_id, date)
--
-- With the old index gone, that statement now raises 42P10 —
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".
-- HR approving ANY leave request fails. Confirmed live, not inferred:
--
--     INSERT INTO attendance (...) VALUES (...) ON CONFLICT (employee_id, date) DO UPDATE ...
--     -> 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- It survived 20260824100000's assertions because of the trap already recorded in the
-- 2026-08-21 handoff §4: **PL/pgSQL plans each statement on first execution of THAT
-- statement.** The broken INSERT lives inside `FOREACH v_date IN ARRAY v_working_dates`.
-- Nothing that merely loads or calls the function touches it. Only an approval that
-- actually yields a working day enters the loop, and only then does the plan get built and
-- the error surface — in production, in front of an HR user.
--
-- Grepping for the table name would not have found it either. The dangerous text is the
-- INFERENCE CLAUSE, `(employee_id, date)`, which names no table at all. When a unique index
-- is dropped, the thing to search for is every ON CONFLICT that could have been inferring
-- it — across all functions, triggers and client upserts.
--
-- ============================================================================
-- THE FIX
-- ============================================================================
-- Point the clause at the new index, expression and all. The COALESCE is not decoration:
-- the index is on `COALESCE(shift_id, '000…'::uuid)`, so the inference clause must repeat
-- that expression verbatim or it will not match. This INSERT supplies no shift_id, so the
-- value is NULL -> the zero uuid, which is exactly the "no particular shift" slot the new
-- key reserves. Leave-generated rows therefore keep collapsing to one row per day, which
-- is the behaviour that was there before and the behaviour leave actually wants.
--
-- CREATE OR REPLACE with an IDENTICAL signature — grants and ownership are preserved, so
-- unlike a DROP + CREATE this needs no re-GRANT. Everything below is byte-identical to the
-- live definition except the two lines of the ON CONFLICT clause. Surgical on purpose: this
-- function moves leave balances and writes audit rows, and is not the place for drive-by
-- improvement.

CREATE OR REPLACE FUNCTION public.approve_leave_request(p_leave_id uuid, p_working_dates date[] DEFAULT NULL::date[], p_approved_business_days integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_leave leaves%ROWTYPE;
  v_balance_row leave_balances%ROWTYPE;
  v_date date;
  v_caller_uid uuid;
  v_hr_employee_id uuid;
  v_working_days integer[];
  v_working_dates date[] := ARRAY[]::date[];
  v_approved_business_days integer := 0;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  SELECT * INTO v_leave
  FROM leaves
  WHERE id = p_leave_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status <> 'pending' THEN
    RAISE EXCEPTION 'Leave request is no longer pending (current status: %)', v_leave.status;
  END IF;

  v_hr_employee_id := assert_hr_for_tenant(v_leave.tenant_id);

  PERFORM assert_date_range_unlocked(v_leave.tenant_id, v_leave.start_date, v_leave.end_date);

  SELECT s.working_days INTO v_working_days
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = v_leave.tenant_id
    AND es.employee_id = v_leave.employee_id
    AND es.effective_from <= v_leave.start_date
    AND (es.effective_to IS NULL OR es.effective_to >= v_leave.start_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_working_days IS NULL THEN
    SELECT working_days INTO v_working_days
    FROM shifts
    WHERE tenant_id = v_leave.tenant_id
      AND is_default = true
      AND is_active IS NOT FALSE
    LIMIT 1;
  END IF;
  v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

  v_date := v_leave.start_date;
  WHILE v_date <= v_leave.end_date LOOP
    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT EXISTS (SELECT 1 FROM holidays WHERE tenant_id = v_leave.tenant_id AND date = v_date) THEN
      v_working_dates := array_append(v_working_dates, v_date);
      v_approved_business_days := v_approved_business_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  IF v_approved_business_days = 0 THEN
    RAISE EXCEPTION 'The selected leave range contains no working days';
  END IF;

  IF v_leave.leave_type_id IS NOT NULL THEN
    SELECT * INTO v_balance_row
    FROM leave_balances
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND leave_type_id = v_leave.leave_type_id
      AND year = EXTRACT(YEAR FROM v_leave.start_date)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Leave balance not found for this employee and type';
    END IF;

    IF v_balance_row.balance < v_approved_business_days THEN
      RAISE EXCEPTION 'Insufficient leave balance (available: %, requested: %)', v_balance_row.balance, v_approved_business_days;
    END IF;

    UPDATE leave_balances
    SET used_days = used_days + v_approved_business_days,
        balance = balance - v_approved_business_days,
        updated_at = now()
    WHERE id = v_balance_row.id;
  END IF;

  UPDATE leaves
  SET status = 'approved',
      reviewed_by = v_hr_employee_id,
      reviewed_at = now(),
      approved_business_days = v_approved_business_days,
      total_days = v_approved_business_days
  WHERE id = p_leave_id;

  FOREACH v_date IN ARRAY v_working_dates LOOP
    INSERT INTO attendance (tenant_id, employee_id, date, punch_in, status, punch_out_allowed, session_status)
    VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, NULL, 'on_leave', true, 'closed')
    -- CHANGED: was ON CONFLICT (employee_id, date), whose index 20260824100000 dropped.
    -- Must repeat the new index's COALESCE expression verbatim to be inferable.
    ON CONFLICT (tenant_id, employee_id, date, COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET status = 'on_leave', punch_in = NULL, punch_out_allowed = true, session_status = 'closed';
  END LOOP;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    VALUES (
      v_leave.tenant_id,
      v_leave.employee_id,
      'Leave Approved',
      'Your leave from ' || v_leave.start_date::text || ' to ' || v_leave.end_date::text || ' has been approved.',
      'leave_approved',
      p_leave_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    v_leave.tenant_id, v_hr_employee_id, 'hr', 'leave.approved', 'leave', p_leave_id,
    jsonb_build_object('approved_business_days', v_approved_business_days, 'working_dates', v_working_dates, 'correlation_id', v_correlation_id)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- ASSERTIONS
-- ---------------------------------------------------------------------------

-- 1. The statement that was failing now plans and executes. This runs the EXACT insert the
--    loop body runs, so it proves the inference clause resolves against the live index —
--    the thing that was actually broken. It writes and then rolls itself back, leaving no
--    row behind, and it deliberately exercises the ON CONFLICT path twice (insert, then
--    conflict) so both halves of the statement are planned.
DO $$
DECLARE
  v_t uuid;
  v_e uuid;
  v_probe_date date := DATE '2031-01-07';
  v_n integer;
BEGIN
  SELECT e.tenant_id, e.id INTO v_t, v_e
  FROM public.employees e WHERE e.tenant_id IS NOT NULL LIMIT 1;

  IF v_t IS NULL THEN
    RAISE EXCEPTION 'ASSERTION INCONCLUSIVE: no employee with a tenant to probe with';
  END IF;

  -- first: plain insert
  INSERT INTO public.attendance (tenant_id, employee_id, date, punch_in, status, punch_out_allowed, session_status)
  VALUES (v_t, v_e, v_probe_date, NULL, 'on_leave', true, 'closed')
  ON CONFLICT (tenant_id, employee_id, date, COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET status = 'on_leave', punch_in = NULL, punch_out_allowed = true, session_status = 'closed';

  -- second: same key again, so the DO UPDATE arm is exercised too
  INSERT INTO public.attendance (tenant_id, employee_id, date, punch_in, status, punch_out_allowed, session_status)
  VALUES (v_t, v_e, v_probe_date, NULL, 'on_leave', true, 'closed')
  ON CONFLICT (tenant_id, employee_id, date, COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET status = 'on_leave', punch_in = NULL, punch_out_allowed = true, session_status = 'closed';

  SELECT count(*) INTO v_n FROM public.attendance
  WHERE tenant_id = v_t AND employee_id = v_e AND date = v_probe_date;

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: expected the conflict to collapse to 1 row, got %', v_n;
  END IF;

  RAISE EXCEPTION 'ROLLBACK_PROBE_OK: ON CONFLICT resolves against the new key; 2 inserts collapsed to % row', v_n;
EXCEPTION
  WHEN sqlstate '42P10' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: inference clause still does not match any index -- %', SQLERRM;
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ROLLBACK_PROBE_OK%' THEN
      RAISE NOTICE '%', SQLERRM;   -- expected: the probe rolled itself back
    ELSE
      RAISE;
    END IF;
END $$;

-- 2. No function anywhere still infers the dropped index. This is the search that would
--    have caught the bug in the first place: match the INFERENCE CLAUSE, not the table name.
--
--    SQL line comments are stripped before matching. On its first run this assertion fired
--    on approve_leave_request itself -- matching the `-- CHANGED: was ON CONFLICT
--    (employee_id, date)` note a few lines above, which is documentation, not a live
--    statement. The migration rolled back, which is the assertion doing its job; the
--    correct repair is to test code rather than to soften the comment.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
        ~* 'on\s+conflict\s*\(\s*employee_id\s*,\s*date\s*\)';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: these functions still infer the dropped (employee_id, date) index: %', v_bad;
  END IF;
END $$;
