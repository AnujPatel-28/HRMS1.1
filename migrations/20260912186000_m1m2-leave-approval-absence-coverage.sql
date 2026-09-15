-- P2-04: leave workflow authorization, per-date working-day convergence, and reversible
-- absence coverage on the attendance evidence trail.
-- Source: prompts/p2-04_leave_absence_coverage_2026-09-15.md
--
-- Measured defects closed here:
--   * approve_leave_request and cancel_leave_request called only the legacy assert_hr_for_tenant
--     predicate, which has no self-approval check at all. A requester holding HR could approve or
--     reject their own leave. Both now call the new assert_leave_reviewer, which runs P1-01's
--     shared assert_distinct_approver before accepting leave.approve at company scope only
--     (contracts.md #9: leave approval is HR-only in M1 -- no direct_reports branch).
--   * leaves_hr_all / leave_balances_hr_all were FOR ALL PERMISSIVE policies with authenticated
--     holding table-level INSERT/UPDATE/DELETE. An HR requester could bypass the RPC guard above
--     entirely with a raw PATCH on the table. Writes are now revoked at both the GRANT and the
--     policy layer (P2-02's pattern); reads stay exactly as broad as before via new SELECT-only
--     policies.
--   * employee_apply_leave_request and approve_leave_request each resolved `working_days` once
--     from the start-date shift and read the tenant-default `holidays` table directly, never
--     `work_calendar_holiday`/named calendars (P2-01 package review S5) -- and both applied that
--     single answer across the whole date range, which contracts.md #11.2 forbids independently
--     of the calendar-tier bug. Both now resolve per date through work_calendar_holiday.
--   * approve_leave_request's attendance upsert forced `punch_in = NULL` on an existing row and
--     cancel_leave_request then deleted any 'on_leave' row with a null punch_in outright. A real
--     punch already recorded for a day, followed by a backdated leave approval and cancellation,
--     lost its punch_in on approval and its entire row on cancellation -- contracts.md #11.5
--     forbids nulling or destroying existing punch evidence. Approval no longer touches punch_in/
--     punch_out and tags the row (`leave_id`, `derivation_source='leave'`); cancellation deletes
--     only pure leave-only placeholders and otherwise releases the tag for
--     attendance_derive_pass1/pass2 (P2-02, unmodified here) to re-derive the real status, since
--     `leaves.status` is no longer 'approved' by the time cancel runs. Not composed inline: pass1/
--     pass2 require the attendance module enabled, which a Leave-only tenant (AC7) need not have.
--   * The same upsert never specified `shift_id`, so its implicit NULL never matched an existing
--     shift-tagged row's composite ON CONFLICT key (`tenant_id, employee_id, date,
--     COALESCE(shift_id, ...)`). Verified live: approving a leave over a day that already had a
--     device/app-derived attendance row silently INSERTed a second, evidence-free phantom row
--     instead of updating the real one, leaving the real row's status permanently wrong and
--     making cancel_leave_request's leave_id-scoped cleanup blind to it. approve_leave_request now
--     resolves the employee's actual assigned shift per date (same employee_shifts lookup as the
--     working-day resolution) before the upsert.
--   * employee_apply_leave_request and employee_cancel_pending_leave never checked
--     tenant_has_module_for(..., 'leave'). Both SECURITY DEFINER functions bypass RLS, so the
--     table's own module_enabled_leave RESTRICTIVE policy was not actually a backstop for them.
--   * leaves_status_check has only ever allowed ('pending','approved','rejected'), never
--     'cancelled' -- found by exercising AC1's cancel-approved path. cancel_leave_request's own
--     validation and LeaveManagement.tsx's dedicated "Cancel" action on an approved leave both
--     assume 'cancelled' is valid; every real cancel-approved attempt in production has raised
--     this CHECK constraint. Widened to match the code's documented intent (section 4).
--
-- Not done here, and why:
--   * day_fraction (half-day leave) has a READ path already live in attendance_derive_pass1/pass2
--     (E23: day_fraction < 1 yields half_day) but no WRITE path -- employee_apply_leave_request
--     takes no such parameter and approve_leave_request's manual upsert hardcodes 'on_leave'.
--     Adding a write path is a feature, not a bug fix, and out of scope; the read path is proven
--     by the acceptance test via a direct fixture leave, not through the RPC.
--   * on-leave-reviewed disposition (reconciliation.md #13: DELETE on the branch) is an edge
--     function change, handled outside this SQL migration.
--   * No ledger redesign, no invented historical balances: fixtures supply opening balances only.
--
-- No BEGIN/COMMIT: the migration runner owns the transaction.

-- ---------------------------------------------------------------------------
-- 1. Shared leave reviewer authorization: common no-self class + frozen action/scope
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_leave_reviewer(
  p_tenant_id uuid,
  p_employee_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_employee_id uuid;
  v_subject_user_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'APPROVER_AUTHENTICATION_REQUIRED' USING ERRCODE = 'P1002';
  END IF;
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'APPROVAL_SUBJECT_UNAVAILABLE' USING ERRCODE = 'P1003';
  END IF;
  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'leave')) THEN
    RAISE EXCEPTION 'MODULE_DISABLED' USING ERRCODE = 'P0007';
  END IF;

  SELECT e.user_id INTO v_subject_user_id
  FROM public.employees e
  WHERE e.id = p_employee_id
    AND e.tenant_id = p_tenant_id;
  IF v_subject_user_id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_SUBJECT_UNAVAILABLE' USING ERRCODE = 'P1003';
  END IF;

  -- P1-01 owns identity comparison and the common SELF_APPROVAL_DENIED class.
  PERFORM public.assert_distinct_approver(v_subject_user_id);

  -- contracts.md #9: leave approval remains HR-only in M1. No direct_reports branch -- the
  -- fixed template contract (contracts.md #4) grants leave.approve to hr_admin/company only.
  IF NOT public.has_access_action('leave.approve', 'company', NULL) THEN
    RAISE EXCEPTION 'ACCESS_ACTION_DENIED' USING ERRCODE = 'P1001';
  END IF;

  SELECT e.id INTO v_actor_employee_id
  FROM public.employees e
  WHERE e.user_id = (SELECT auth.uid())
    AND e.tenant_id = p_tenant_id
    AND e.status NOT IN ('terminated', 'inactive')
  ORDER BY e.updated_at DESC, e.id
  LIMIT 1;
  IF v_actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'APPROVER_IDENTITY_UNAVAILABLE' USING ERRCODE = 'P1002';
  END IF;

  RETURN v_actor_employee_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_leave_reviewer(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guarded mechanical patches: module gate, reviewer swap, per-date convergence, evidence
-- ---------------------------------------------------------------------------
-- These bodies are large; hand-retyping full CREATE OR REPLACE statements risks silently
-- dropping a statement (project memory: "derive function bodies, never rewrite"). Instead:
-- resolve the exact live signature, require the old fragment to occur exactly once, replace it,
-- then execute the reconstructed (otherwise byte-identical) pg_get_functiondef output.
DO $patch_leave_functions$
DECLARE
  v_patch record;
  v_oid oid;
  v_def text;
  v_hits integer;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      -- employee_apply_leave_request: module gate.
      (
        'public.employee_apply_leave_request(uuid,uuid,date,date,text)',
        $old$  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  SELECT * INTO v_employee
  FROM employees$old$,
        $new$  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  IF NOT tenant_has_module_for(p_tenant_id, 'leave') THEN
    RAISE EXCEPTION 'MODULE_DISABLED' USING ERRCODE = 'P0007';
  END IF;

  SELECT * INTO v_employee
  FROM employees$new$
      ),
      -- employee_apply_leave_request: per-date working-days + holiday-tier convergence
      -- (P2-01 package review S5), replacing the single start-date lookup and the direct
      -- `holidays` read with work_calendar_holiday for every date in the range.
      (
        'public.employee_apply_leave_request(uuid,uuid,date,date,text)',
        $old$  SELECT s.working_days INTO v_working_days
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.tenant_id = p_tenant_id
    AND es.employee_id = v_employee.id
    AND es.effective_from <= p_start_date
    AND (es.effective_to IS NULL OR es.effective_to >= p_start_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  IF v_working_days IS NULL THEN
    SELECT working_days INTO v_working_days
    FROM shifts
    WHERE tenant_id = p_tenant_id
      AND is_default = true
      AND is_active IS NOT FALSE
    LIMIT 1;
  END IF;
  v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

  v_date := p_start_date;
  WHILE v_date <= p_end_date LOOP
    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT EXISTS (SELECT 1 FROM holidays WHERE tenant_id = p_tenant_id AND date = v_date) THEN
      v_total_days := v_total_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;$old$,
        $new$  v_date := p_start_date;
  WHILE v_date <= p_end_date LOOP
    SELECT s.working_days INTO v_working_days
    FROM employee_shifts es
    JOIN shifts s ON s.id = es.shift_id
    WHERE es.tenant_id = p_tenant_id
      AND es.employee_id = v_employee.id
      AND es.effective_from <= v_date
      AND (es.effective_to IS NULL OR es.effective_to >= v_date)
    ORDER BY es.effective_from DESC
    LIMIT 1;

    IF v_working_days IS NULL THEN
      SELECT working_days INTO v_working_days
      FROM shifts
      WHERE tenant_id = p_tenant_id
        AND is_default = true
        AND is_active IS NOT FALSE
      LIMIT 1;
    END IF;
    v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT COALESCE((SELECT h.is_holiday FROM work_calendar_holiday(p_tenant_id, v_employee.id, v_date) h), false) THEN
      v_total_days := v_total_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;$new$
      ),
      -- employee_cancel_pending_leave: module gate.
      (
        'public.employee_cancel_pending_leave(uuid,uuid)',
        $old$  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  SELECT id INTO v_employee_id
  FROM employees$old$,
        $new$  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  IF NOT tenant_has_module_for(p_tenant_id, 'leave') THEN
    RAISE EXCEPTION 'MODULE_DISABLED' USING ERRCODE = 'P0007';
  END IF;

  SELECT id INTO v_employee_id
  FROM employees$new$
      ),
      -- approve_leave_request: reviewer swap. assert_hr_for_tenant had no self-approval check;
      -- assert_leave_reviewer runs the shared distinct-approver guard first.
      (
        'public.approve_leave_request(uuid,date[],integer)',
        $old$  v_hr_employee_id := assert_hr_for_tenant(v_leave.tenant_id);$old$,
        $new$  v_hr_employee_id := public.assert_leave_reviewer(v_leave.tenant_id, v_leave.employee_id);$new$
      ),
      -- approve_leave_request: the same per-date convergence as employee_apply_leave_request.
      (
        'public.approve_leave_request(uuid,date[],integer)',
        $old$  SELECT s.working_days INTO v_working_days
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
  END LOOP;$old$,
        $new$  v_date := v_leave.start_date;
  WHILE v_date <= v_leave.end_date LOOP
    SELECT s.working_days INTO v_working_days
    FROM employee_shifts es
    JOIN shifts s ON s.id = es.shift_id
    WHERE es.tenant_id = v_leave.tenant_id
      AND es.employee_id = v_leave.employee_id
      AND es.effective_from <= v_date
      AND (es.effective_to IS NULL OR es.effective_to >= v_date)
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

    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT COALESCE((SELECT h.is_holiday FROM work_calendar_holiday(v_leave.tenant_id, v_leave.employee_id, v_date) h), false) THEN
      v_working_dates := array_append(v_working_dates, v_date);
      v_approved_business_days := v_approved_business_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;$new$
      ),
      -- approve_leave_request: declare v_shift_id, used by the upsert fix below.
      (
        'public.approve_leave_request(uuid,date[],integer)',
        $old$  v_working_days integer[];
  v_working_dates date[] := ARRAY[]::date[];$old$,
        $new$  v_working_days integer[];
  v_shift_id uuid;
  v_working_dates date[] := ARRAY[]::date[];$new$
      ),
      -- approve_leave_request: stop nulling punch_in/evidence on an existing row; tag the row
      -- with leave_id/derivation_source instead so cancel_leave_request can reverse it precisely.
      -- Also resolve the employee's actual assigned shift per date: the original upsert never
      -- specified shift_id, so its implicit NULL never matched an existing shift-tagged row's
      -- composite ON CONFLICT key and silently created a second, evidence-free phantom row
      -- instead of updating the real one -- verified live against a device-derived row.
      (
        'public.approve_leave_request(uuid,date[],integer)',
        $old$  FOREACH v_date IN ARRAY v_working_dates LOOP
    INSERT INTO attendance (tenant_id, employee_id, date, punch_in, status, punch_out_allowed, session_status)
    VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, NULL, 'on_leave', true, 'closed')
    -- CHANGED: was ON CONFLICT (employee_id, date), whose index 20260824100000 dropped.
    -- Must repeat the new index's COALESCE expression verbatim to be inferable.
    ON CONFLICT (tenant_id, employee_id, date, COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET status = 'on_leave', punch_in = NULL, punch_out_allowed = true, session_status = 'closed';
  END LOOP;$old$,
        $new$  FOREACH v_date IN ARRAY v_working_dates LOOP
    -- P2-04: resolve the employee's real assigned shift for this date so the upsert targets the
    -- SAME composite key a device/app punch already wrote under (see header comment above).
    SELECT es.shift_id INTO v_shift_id
    FROM employee_shifts es
    WHERE es.tenant_id = v_leave.tenant_id
      AND es.employee_id = v_leave.employee_id
      AND es.effective_from <= v_date
      AND (es.effective_to IS NULL OR es.effective_to >= v_date)
    ORDER BY es.effective_from DESC
    LIMIT 1;

    INSERT INTO attendance (tenant_id, employee_id, date, shift_id, punch_in, status, punch_out_allowed, session_status, leave_id, derivation_source)
    VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, v_shift_id, NULL, 'on_leave', true, 'closed', p_leave_id, 'leave')
    -- CHANGED: was ON CONFLICT (employee_id, date), whose index 20260824100000 dropped.
    -- Must repeat the new index's COALESCE expression verbatim to be inferable.
    -- P2-04 / contracts.md #11.5: punch_in is no longer forced to NULL on conflict -- an
    -- existing row's punch_in/punch_out/in_time/out_time are raw evidence and must survive a
    -- backdated approval. Only status and leave tagging change; see cancel_leave_request for
    -- the reversal, which hands the row back to attendance_derive_pass1/pass2.
    ON CONFLICT (tenant_id, employee_id, date, COALESCE(shift_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET status = 'on_leave', punch_out_allowed = true, session_status = 'closed',
                  leave_id = EXCLUDED.leave_id, derivation_source = 'leave';
  END LOOP;$new$
      ),
      -- cancel_leave_request: reviewer swap, same rationale as approve. contracts.md #7.2 lists
      -- reject as controlled; #7.5 confines self-withdrawal to employee_cancel_pending_leave
      -- (pending only, unmodified here), so an HR requester still cannot reject/cancel their own
      -- approved leave.
      (
        'public.cancel_leave_request(uuid,text,text)',
        $old$  v_hr_employee_id := assert_hr_for_tenant(v_leave.tenant_id);$old$,
        $new$  v_hr_employee_id := public.assert_leave_reviewer(v_leave.tenant_id, v_leave.employee_id);$new$
      ),
      -- cancel_leave_request: never delete/null a row that still carries real punch evidence.
      (
        'public.cancel_leave_request(uuid,text,text)',
        $old$    DELETE FROM attendance
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND date >= v_leave.start_date
      AND date <= v_leave.end_date
      AND status = 'on_leave'
      AND punch_in IS NULL;$old$,
        $new$    -- P2-04 / contracts.md #11.5: a row this leave overwrote that still carries real
    -- punch evidence is never deleted or nulled. Scoped by leave_id, not a broad date/status
    -- guess. A pure leave-only placeholder (no punch/derivation evidence at all) is removed;
    -- an evidence-bearing row is released (leave_id/derivation_source cleared) for
    -- attendance_derive_pass1/pass2 to re-derive, since `leaves.status` is no longer
    -- 'approved' by the time this runs. Not invoked inline here: pass1/pass2 require the
    -- attendance module enabled, which a Leave-only tenant need not have.
    DELETE FROM attendance
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND leave_id = p_leave_id
      AND punch_in IS NULL AND punch_out IS NULL
      AND in_time IS NULL AND out_time IS NULL;

    UPDATE attendance
    SET leave_id = NULL,
        derivation_source = NULL
    WHERE tenant_id = v_leave.tenant_id
      AND employee_id = v_leave.employee_id
      AND leave_id = p_leave_id
      AND (punch_in IS NOT NULL OR punch_out IS NOT NULL OR in_time IS NOT NULL OR out_time IS NOT NULL);$new$
      )
    ) AS patches(signature, old_fragment, new_fragment)
  LOOP
    v_oid := to_regprocedure(v_patch.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'P2-04 expected function % is missing', v_patch.signature;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_hits := (length(v_def) - length(replace(v_def, v_patch.old_fragment, '')))
              / length(v_patch.old_fragment);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'P2-04 refused to patch %: old fragment occurs % times, expected 1',
        v_patch.signature, v_hits;
    END IF;

    EXECUTE replace(v_def, v_patch.old_fragment, v_patch.new_fragment);
  END LOOP;
END
$patch_leave_functions$;

-- ---------------------------------------------------------------------------
-- 3. Table-write lockdown: leaves and leave_balances writes go only through the RPCs above.
--    P2-02's pattern -- denied at both the GRANT and the policy level.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.leaves FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.leave_balances FROM authenticated, anon;

DROP POLICY IF EXISTS leaves_hr_all ON public.leaves;
DROP POLICY IF EXISTS leaves_self_insert ON public.leaves;
CREATE POLICY leaves_hr_select
ON public.leaves
FOR SELECT TO authenticated
USING ((SELECT is_hr()));

DROP POLICY IF EXISTS leave_balances_hr_all ON public.leave_balances;
CREATE POLICY leave_balances_hr_select
ON public.leave_balances
FOR SELECT TO authenticated
USING (is_hr());

-- ---------------------------------------------------------------------------
-- 4. Pre-existing defect, found while exercising AC1's cancel-approved path: leaves_status_check
--    has only ever allowed ('pending','approved','rejected'). cancel_leave_request's own
--    validation (`p_new_status NOT IN ('rejected','cancelled')`) and LeaveManagement.tsx's
--    dedicated "Cancel" action on an approved leave both assume 'cancelled' is a valid target --
--    it is not, so that path has always raised leaves_status_check on the live table. Widening
--    the constraint to match the code's own documented intent; no other value changes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.leaves DROP CONSTRAINT leaves_status_check;
ALTER TABLE public.leaves ADD CONSTRAINT leaves_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]));

-- ---------------------------------------------------------------------------
-- 5. Migration-time structural assertions
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  v_count integer;
  v_name text;
  v_def text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'assert_leave_reviewer', 'employee_apply_leave_request', 'employee_cancel_pending_leave',
    'approve_leave_request', 'cancel_leave_request'
  ] LOOP
    SELECT count(*) INTO v_count
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND p.proname = v_name;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'P2-04 overload assertion failed for %: found %', v_name, v_count;
    END IF;

    IF has_function_privilege('anon', ('public.' || v_name)::regproc, 'EXECUTE') THEN
      RAISE EXCEPTION 'P2-04 anon must not hold EXECUTE on %', v_name;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY['employee_apply_leave_request', 'approve_leave_request'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name;
    IF position('work_calendar_holiday' in v_def) = 0 THEN
      RAISE EXCEPTION 'P2-04 holiday-tier convergence assertion failed for %', v_name;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY['employee_apply_leave_request', 'employee_cancel_pending_leave'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name;
    IF position('tenant_has_module_for' in v_def) = 0 THEN
      RAISE EXCEPTION 'P2-04 module-gate assertion failed for %', v_name;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'approve_leave_request';
  IF position('v_shift_id' in v_def) = 0 THEN
    RAISE EXCEPTION 'P2-04 shift_id-resolution assertion failed for approve_leave_request';
  END IF;

  FOREACH v_name IN ARRAY ARRAY['approve_leave_request', 'cancel_leave_request'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name;
    IF position('assert_leave_reviewer' in v_def) = 0 THEN
      RAISE EXCEPTION 'P2-04 reviewer-guard assertion failed for %', v_name;
    END IF;
    IF position('assert_hr_for_tenant' in v_def) > 0 THEN
      RAISE EXCEPTION 'P2-04 % still calls the legacy assert_hr_for_tenant reviewer path', v_name;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.leaves', 'INSERT')
     OR has_table_privilege('authenticated', 'public.leaves', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.leaves', 'DELETE')
     OR has_table_privilege('anon', 'public.leaves', 'INSERT')
     OR has_table_privilege('anon', 'public.leaves', 'UPDATE')
     OR has_table_privilege('anon', 'public.leaves', 'DELETE') THEN
    RAISE EXCEPTION 'P2-04 leaves table still exposes a direct client write';
  END IF;
  IF has_table_privilege('authenticated', 'public.leave_balances', 'INSERT')
     OR has_table_privilege('authenticated', 'public.leave_balances', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.leave_balances', 'DELETE')
     OR has_table_privilege('anon', 'public.leave_balances', 'INSERT')
     OR has_table_privilege('anon', 'public.leave_balances', 'UPDATE')
     OR has_table_privilege('anon', 'public.leave_balances', 'DELETE') THEN
    RAISE EXCEPTION 'P2-04 leave_balances table still exposes a direct client write';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'leaves'
    AND permissive = 'PERMISSIVE' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P2-04 leaves still has % permissive write policy(ies)', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'leave_balances'
    AND permissive = 'PERMISSIVE' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P2-04 leave_balances still has % permissive write policy(ies)', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid = 'public.attendance'::regclass
    AND tgname = 'trg_attendance_dual_write_event'
    AND NOT tgisinternal;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'P2-04 attendance event writer trigger count is %, expected 1 (unmodified by this package)', v_count;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint WHERE conrelid = 'public.leaves'::regclass AND conname = 'leaves_status_check';
  IF position('''cancelled''' in v_def) = 0 THEN
    RAISE EXCEPTION 'P2-04 leaves_status_check still does not allow ''cancelled''';
  END IF;
END
$assert$;

COMMENT ON FUNCTION public.assert_leave_reviewer(uuid, uuid) IS
  'P2-04 internal reviewer guard. Calls P1-01 assert_distinct_approver for the common no-self '
  'denial, then accepts leave.approve at company scope only (contracts.md #9: HR-only in M1, no '
  'direct_reports branch). Not executable by API roles; approve/cancel call it from their own '
  'fenced definer functions.';

COMMENT ON FUNCTION public.approve_leave_request(uuid, date[], integer) IS
  'P2-04: reviewer resolved via assert_leave_reviewer (shared no-self guard). Working days and '
  'holidays resolve per date through work_calendar_holiday/employee_shifts, matching P2-01''s '
  'shared calendar resolver. The attendance upsert tags leave_id/derivation_source and never '
  'nulls an existing row''s punch_in/punch_out.';

COMMENT ON FUNCTION public.cancel_leave_request(uuid, text, text) IS
  'P2-04: reviewer resolved via assert_leave_reviewer (shared no-self guard, covers both reject '
  'and cancel-approved). Attendance cleanup deletes only pure leave-only placeholder rows; a row '
  'with real punch evidence keeps it and is released (leave_id/derivation_source cleared) for '
  'attendance_derive_pass1/pass2 to re-derive.';
