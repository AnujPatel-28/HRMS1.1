-- P2-02: attendance/correction consistency and exclusive database gate ownership.
-- Source: prompts/p2-02_attendance_punchout_gate_2026-09-14.md
--
-- Measured defects closed here:
--   * attendance_corrections exposed blanket INSERT/UPDATE/DELETE to authenticated (and anon),
--     while attendance_corrections_self was FOR ALL. An employee could therefore rewrite the
--     review status/reviewer/rejection columns on their own request. Requests now enter through
--     request_attendance_correction(); clients retain read access only.
--   * approve/reject used the legacy HR predicate and did not call P1-01's common
--     assert_distinct_approver denial. They now accept the frozen attendance.approve capability
--     at company or effective-primary-direct-report scope and always run the shared no-self guard.
--   * approval could overwrite an already locked attendance row. A locked request or approval
--     now fails explicitly. Successful approval remains the writer that locks the corrected row.
--   * five attendance-owned functions duplicated tenant_business_date's instant -> local-date
--     formula. The guarded mechanical replacements below alter only those expressions. The two
--     other measured duplicates are deliberately outside this package: device_ingest_punch is
--     P2-03, fn_auto_redmark_tasks is P3-02.
--
-- attendance_events stays trigger-maintained. This migration adds no manual event insert: the
-- existing trg_attendance_dual_write_event -> attendance_dual_write_event path remains exclusive.
-- No BEGIN/COMMIT: the migration runner owns the transaction.

-- ---------------------------------------------------------------------------
-- 1. One canonical tenant business-date implementation for attendance callers
-- ---------------------------------------------------------------------------
-- These bodies total well over 20KB. Mirroring the established guarded-replacement pattern in
-- 20260820170000 avoids retyping them: resolve the exact signature, require the old expression
-- exactly once, replace it, then execute the otherwise byte-identical pg_get_functiondef output.
DO $converge_business_date$
DECLARE
  v_patch record;
  v_oid oid;
  v_def text;
  v_hits integer;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'public.punch_in_attendance(uuid,uuid,numeric,numeric,numeric,text,text,text,uuid,jsonb)',
        'v_business_date := (v_now AT TIME ZONE v_tenant_tz)::date;',
        'v_business_date := public.tenant_business_date(p_tenant_id, v_now);'
      ),
      (
        'public.punch_out_attendance(uuid,uuid,numeric,numeric,numeric,text,text,uuid,jsonb)',
        'v_today_in_tz   := (v_now AT TIME ZONE v_tenant_tz)::date;',
        'v_today_in_tz   := public.tenant_business_date(p_tenant_id, v_now);'
      ),
      (
        'public.attendance_derive_pass1(uuid,uuid,date,date,uuid)',
        '(e.shift_start AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to',
        'public.tenant_business_date(p_tenant_id, e.shift_start) BETWEEN p_from AND p_to'
      ),
      (
        'public.attendance_derive_pass1(uuid,uuid,date,date,uuid)',
        'v_local_date := (v_group.shift_start AT TIME ZONE v_tz)::date;',
        'v_local_date := public.tenant_business_date(p_tenant_id, v_group.shift_start);'
      ),
      (
        'public.attendance_derive_pass2(uuid,uuid,date,date,uuid)',
        '(v_shift.last_sync_of_events AT TIME ZONE v_tz)::date - 1',
        'public.tenant_business_date(p_tenant_id, v_shift.last_sync_of_events) - 1'
      ),
      (
        'public.attendance_resolve_shift(uuid,uuid,timestamptz)',
        'v_local_date := (p_event_time AT TIME ZONE v_tz)::date;',
        'v_local_date := public.tenant_business_date(p_tenant_id, p_event_time);'
      )
    ) AS patches(signature, old_fragment, new_fragment)
  LOOP
    v_oid := to_regprocedure(v_patch.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'P2-02 expected function % is missing', v_patch.signature;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_hits := (length(v_def) - length(replace(v_def, v_patch.old_fragment, '')))
              / length(v_patch.old_fragment);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'P2-02 refused to patch %: old fragment occurs % times, expected 1',
        v_patch.signature, v_hits;
    END IF;

    EXECUTE replace(v_def, v_patch.old_fragment, v_patch.new_fragment);
  END LOOP;
END
$converge_business_date$;

-- ---------------------------------------------------------------------------
-- 2. Shared reviewer authorization: common no-self class + frozen action/scope
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_attendance_correction_reviewer(
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
  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
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

  IF NOT (
    public.has_access_action('attendance.approve', 'company', NULL)
    OR (
      public.has_access_action('attendance.approve', 'direct_reports', NULL)
      AND public.is_manager_of(p_employee_id)
    )
  ) THEN
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

REVOKE ALL ON FUNCTION public.assert_attendance_correction_reviewer(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Employee correction request RPC; no direct table mutation surface
-- ---------------------------------------------------------------------------
-- The old full unique constraint made a rejected correction impossible to request again and led
-- the SPA to overwrite the reviewed row. Keep only the existing partial unique index that permits
-- at most one pending request while retaining completed request history.
ALTER TABLE public.attendance_corrections
  DROP CONSTRAINT attendance_corrections_tenant_id_employee_id_attendance_dat_key;

CREATE OR REPLACE FUNCTION public.request_attendance_correction(
  p_tenant_id uuid,
  p_attendance_date date,
  p_requested_punch_in time,
  p_requested_punch_out time,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_membership_id uuid;
  v_employee_id uuid;
  v_row_count integer;
  v_correction public.attendance_corrections%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'ACCESS_AUTHENTICATION_REQUIRED' USING ERRCODE = 'P1002';
  END IF;
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'ACCESS_ACTION_DENIED' USING ERRCODE = 'P1001';
  END IF;
  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'MODULE_DISABLED' USING ERRCODE = 'P0007';
  END IF;

  v_membership_id := public.assert_access_action(
    'attendance.correction.request', 'self', NULL
  );

  SELECT m.employee_id INTO v_employee_id
  FROM public.tenant_memberships m
  WHERE m.id = v_membership_id
    AND m.tenant_id = p_tenant_id
    AND m.user_id = (SELECT auth.uid())
    AND m.status = 'active';
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_ASSOCIATION_REQUIRED' USING ERRCODE = 'P1001';
  END IF;

  IF p_attendance_date IS NULL OR p_attendance_date > public.tenant_business_date(p_tenant_id, now()) THEN
    RAISE EXCEPTION 'CORRECTION_DATE_INVALID' USING ERRCODE = 'P1001';
  END IF;
  IF p_requested_punch_in IS NULL AND p_requested_punch_out IS NULL THEN
    RAISE EXCEPTION 'CORRECTION_PUNCH_REQUIRED' USING ERRCODE = 'P1001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'CORRECTION_REASON_REQUIRED' USING ERRCODE = 'P1001';
  END IF;

  SELECT count(*) INTO v_row_count
  FROM public.attendance a
  WHERE a.tenant_id = p_tenant_id
    AND a.employee_id = v_employee_id
    AND a.date = p_attendance_date;
  IF v_row_count > 1 THEN
    RAISE EXCEPTION 'CORRECTION_SHIFT_AMBIGUOUS' USING ERRCODE = 'P1001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.tenant_id = p_tenant_id
      AND a.employee_id = v_employee_id
      AND a.date = p_attendance_date
      AND a.is_locked
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_CORRECTION_LOCKED' USING ERRCODE = 'P1001';
  END IF;

  INSERT INTO public.attendance_corrections (
    tenant_id, employee_id, attendance_date,
    requested_punch_in, requested_punch_out, reason, status
  ) VALUES (
    p_tenant_id, v_employee_id, p_attendance_date,
    p_requested_punch_in, p_requested_punch_out, trim(p_reason), 'pending'
  )
  RETURNING * INTO v_correction;

  INSERT INTO public.audit_logs (
    tenant_id, actor_id, actor_role, action, target_type, target_id, details
  ) VALUES (
    p_tenant_id, v_employee_id, 'employee', 'attendance_correction.requested',
    'attendance_corrections', v_correction.id,
    jsonb_build_object(
      'employee_id', v_employee_id,
      'attendance_date', p_attendance_date,
      'requested_punch_in', p_requested_punch_in,
      'requested_punch_out', p_requested_punch_out,
      'reason', trim(p_reason),
      'severity', 'INFO'
    )
  );

  RETURN to_jsonb(v_correction);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'CORRECTION_ALREADY_PENDING' USING ERRCODE = 'P1001';
END;
$$;

REVOKE ALL ON FUNCTION public.request_attendance_correction(uuid, date, time, time, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_attendance_correction(uuid, date, time, time, text)
  TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.attendance_corrections FROM authenticated, anon;

DROP POLICY IF EXISTS attendance_corrections_self ON public.attendance_corrections;
DROP POLICY IF EXISTS attendance_corrections_insert_hr ON public.attendance_corrections;
DROP POLICY IF EXISTS attendance_corrections_update_hr ON public.attendance_corrections;
DROP POLICY IF EXISTS attendance_corrections_delete_hr ON public.attendance_corrections;
DROP POLICY IF EXISTS attendance_corrections_select_hr ON public.attendance_corrections;

CREATE POLICY attendance_corrections_select_self
ON public.attendance_corrections
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = attendance_corrections.employee_id
      AND e.tenant_id = attendance_corrections.tenant_id
      AND e.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY attendance_corrections_select_company_reviewer
ON public.attendance_corrections
FOR SELECT TO authenticated
USING (public.has_access_action('attendance.approve', 'company', NULL));

CREATE POLICY attendance_corrections_select_direct_report_reviewer
ON public.attendance_corrections
FOR SELECT TO authenticated
USING (
  public.has_access_action('attendance.approve', 'direct_reports', NULL)
  AND public.is_manager_of(employee_id)
);

-- ---------------------------------------------------------------------------
-- 4. Make approve/reject use the shared reviewer seam and reject locked rows
-- ---------------------------------------------------------------------------
DO $harden_correction_review$
DECLARE
  v_patch record;
  v_oid oid;
  v_def text;
  v_hits integer;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'public.hr_approve_attendance_correction(uuid,uuid)',
        'v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);',
        $new$IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'APPROVER_AUTHENTICATION_REQUIRED' USING ERRCODE = 'P1002';
  END IF;
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'APPROVAL_SUBJECT_UNAVAILABLE' USING ERRCODE = 'P1003';
  END IF;
  v_hr_employee_id := NULL;$new$
      ),
      (
        'public.hr_approve_attendance_correction(uuid,uuid)',
        $old$IF v_correction.status <> 'pending' THEN$old$,
        $new$v_hr_employee_id := public.assert_attendance_correction_reviewer(
    p_tenant_id, v_correction.employee_id
  );

  IF v_correction.status <> 'pending' THEN$new$
      ),
      (
        'public.hr_approve_attendance_correction(uuid,uuid)',
        $old$v_before := CASE WHEN v_attendance.id IS NULL THEN NULL ELSE to_jsonb(v_attendance) END;$old$,
        $new$IF v_attendance.id IS NOT NULL AND v_attendance.is_locked THEN
    RAISE EXCEPTION 'ATTENDANCE_CORRECTION_LOCKED' USING ERRCODE = 'P1001';
  END IF;

  v_before := CASE WHEN v_attendance.id IS NULL THEN NULL ELSE to_jsonb(v_attendance) END;$new$
      ),
      (
        'public.hr_reject_attendance_correction(uuid,uuid,text)',
        'v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);',
        $new$IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'APPROVER_AUTHENTICATION_REQUIRED' USING ERRCODE = 'P1002';
  END IF;
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'APPROVAL_SUBJECT_UNAVAILABLE' USING ERRCODE = 'P1003';
  END IF;
  v_hr_employee_id := NULL;$new$
      ),
      (
        'public.hr_reject_attendance_correction(uuid,uuid,text)',
        $old$IF v_correction.status <> 'pending' THEN$old$,
        $new$v_hr_employee_id := public.assert_attendance_correction_reviewer(
    p_tenant_id, v_correction.employee_id
  );

  IF v_correction.status <> 'pending' THEN$new$
      ),
      (
        'public.hr_reject_attendance_correction(uuid,uuid,text)',
        $old$PERFORM assert_date_range_unlocked(p_tenant_id, v_correction.attendance_date, v_correction.attendance_date);$old$,
        $new$IF EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.tenant_id = p_tenant_id
      AND a.employee_id = v_correction.employee_id
      AND a.date = v_correction.attendance_date
      AND a.is_locked
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_CORRECTION_LOCKED' USING ERRCODE = 'P1001';
  END IF;

  PERFORM assert_date_range_unlocked(p_tenant_id, v_correction.attendance_date, v_correction.attendance_date);$new$
      )
    ) AS patches(signature, old_fragment, new_fragment)
  LOOP
    v_oid := to_regprocedure(v_patch.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'P2-02 expected function % is missing', v_patch.signature;
    END IF;
    v_def := pg_get_functiondef(v_oid);
    v_hits := (length(v_def) - length(replace(v_def, v_patch.old_fragment, '')))
              / length(v_patch.old_fragment);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'P2-02 refused to harden %: fragment occurs % times, expected 1',
        v_patch.signature, v_hits;
    END IF;
    EXECUTE replace(v_def, v_patch.old_fragment, v_patch.new_fragment);
  END LOOP;
END
$harden_correction_review$;

ALTER FUNCTION public.hr_approve_attendance_correction(uuid, uuid)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.hr_reject_attendance_correction(uuid, uuid, text)
  SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.hr_approve_attendance_correction(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_approve_attendance_correction(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.hr_reject_attendance_correction(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_reject_attendance_correction(uuid, uuid, text) TO authenticated;

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
    'punch_in_attendance', 'punch_out_attendance', 'attendance_derive_pass1',
    'attendance_derive_pass2', 'attendance_resolve_shift',
    'request_attendance_correction', 'assert_attendance_correction_reviewer',
    'hr_approve_attendance_correction', 'hr_reject_attendance_correction'
  ] LOOP
    SELECT count(*) INTO v_count
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND p.proname = v_name;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'P2-02 overload assertion failed for %: found %', v_name, v_count;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY[
    'punch_in_attendance', 'punch_out_attendance', 'attendance_derive_pass1',
    'attendance_derive_pass2', 'attendance_resolve_shift'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name;
    IF position('tenant_business_date' in v_def) = 0 THEN
      RAISE EXCEPTION 'P2-02 date convergence assertion failed for %', v_name;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN (
      'request_attendance_correction', 'assert_attendance_correction_reviewer',
      'hr_approve_attendance_correction', 'hr_reject_attendance_correction'
    )
    AND p.prosecdef
    AND p.proconfig IS NOT NULL
    AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'P2-02 definer/ACL assertion failed: expected 4 hardened correction functions, found %', v_count;
  END IF;

  IF has_table_privilege('authenticated', 'public.attendance_corrections', 'INSERT')
     OR has_table_privilege('authenticated', 'public.attendance_corrections', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.attendance_corrections', 'DELETE')
     OR has_table_privilege('anon', 'public.attendance_corrections', 'INSERT')
     OR has_table_privilege('anon', 'public.attendance_corrections', 'UPDATE')
     OR has_table_privilege('anon', 'public.attendance_corrections', 'DELETE') THEN
    RAISE EXCEPTION 'P2-02 correction table still exposes a direct client write';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'attendance_corrections'
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF v_count <> 2 THEN
    -- Exactly the two pre-existing RESTRICTIVE ALL fences remain: tenant + module. They cannot
    -- grant a write without a permissive write policy and a table privilege.
    RAISE EXCEPTION 'P2-02 unexpected correction write-policy shape: found % ALL/write policies', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'attendance_corrections'
    AND policyname IN ('tenant_isolation', 'module_enabled_attendance')
    AND permissive = 'RESTRICTIVE';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'P2-02 correction tenant/module fences must remain RESTRICTIVE';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid = 'public.attendance'::regclass
    AND tgname = 'trg_attendance_dual_write_event'
    AND NOT tgisinternal;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'P2-02 attendance event writer trigger count is %, expected 1', v_count;
  END IF;

  SELECT pg_get_functiondef('public.punch_out_attendance(uuid,uuid,numeric,numeric,numeric,text,text,uuid,jsonb)'::regprocedure)
    INTO v_def;
  IF position('punch_out_gate_enabled AND public.tenant_has_module_for(p_tenant_id, ''tasks'')' in v_def) = 0 THEN
    RAISE EXCEPTION 'P2-02 database punch-out task gate was lost';
  END IF;
END
$assert$;

COMMENT ON FUNCTION public.request_attendance_correction(uuid, date, time, time, text) IS
  'P2-02 sole employee mutation seam for attendance correction requests. Re-derives the caller''s '
  'active employee association and attendance.correction.request:self capability, fences tenant '
  'and attendance-module state, refuses locked or ambiguous employee-days, and writes an audit row. '
  'Clients have no direct INSERT/UPDATE/DELETE on attendance_corrections.';

COMMENT ON FUNCTION public.assert_attendance_correction_reviewer(uuid, uuid) IS
  'P2-02 internal reviewer guard. Calls P1-01 assert_distinct_approver for the common no-self denial, '
  'then accepts attendance.approve at company scope or effective primary direct-report scope only. '
  'Not executable by API roles; approve/reject call it from their own fenced definer functions.';
