-- P1-01: frozen M1 capability summary and shared distinct-approver guard.
--
-- P1-02 must use md5(tenant_id::text || ':' || user_id::text)::uuid as the
-- membership table primary-key default. That keeps every id derived here valid
-- after a membership row materialises.

CREATE OR REPLACE FUNCTION public.get_my_capability_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tenant_id uuid;
  v_metadata_role text;
  v_tenant public.tenants%ROWTYPE;
  v_employee public.employees%ROWTYPE;
  v_employee_found boolean := false;
  v_role_names text[] := ARRAY[]::text[];
  v_responsibilities text[] := ARRAY[]::text[];
  v_membership_status text;
  v_unavailable_reason text;
  v_grants jsonb := '[]'::jsonb;
  v_enabled_modules jsonb := '[]'::jsonb;
  v_role_updated_at timestamptz;
  v_access_version bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CAPABILITY_AUTHENTICATION_REQUIRED'
      USING ERRCODE = 'P1002';
  END IF;

  -- The active tenant is derived from the authenticated account. This definer function never
  -- accepts a tenant or employee id from the caller and explicitly fences every legacy row read.
  SELECT NULLIF(u.metadata->>'tenant_id', '')::uuid, u.metadata->>'role'
    INTO v_tenant_id, v_metadata_role
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'CAPABILITY_TENANT_UNAVAILABLE'
      USING ERRCODE = 'P1002';
  END IF;

  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPABILITY_TENANT_UNAVAILABLE'
      USING ERRCODE = 'P1002';
  END IF;

  SELECT e.* INTO v_employee
  FROM public.employees e
  WHERE e.user_id = v_uid
    AND e.tenant_id = v_tenant_id
  ORDER BY e.updated_at DESC, e.id
  LIMIT 1;
  v_employee_found := FOUND;

  IF v_employee_found THEN
    SELECT
      COALESCE(array_agg(DISTINCT r.role ORDER BY r.role), ARRAY[]::text[]),
      MAX(r.updated_at)
      INTO v_role_names, v_role_updated_at
    FROM public.employee_roles r
    WHERE r.tenant_id = v_tenant_id
      AND r.employee_id = v_employee.id
      AND r.is_active;
  END IF;

  v_membership_status := CASE
    WHEN v_tenant.status = 'cancelled' OR (v_employee_found AND v_employee.status = 'terminated') THEN 'revoked'
    WHEN v_tenant.status = 'suspended' OR (v_employee_found AND v_employee.status = 'inactive') THEN 'suspended'
    ELSE 'active'
  END;

  IF NOT v_employee_found THEN
    v_unavailable_reason := 'employee_association_required';
  ELSIF v_membership_status <> 'active' THEN
    v_unavailable_reason := 'membership_' || v_membership_status;
  ELSIF v_employee.status IN ('draft', 'pending_hr_review', 'pending_onboarding') THEN
    v_unavailable_reason := 'employee_not_active';
  ELSE
    v_unavailable_reason := NULL;
    v_responsibilities := array_append(v_responsibilities, 'employee');

    IF v_metadata_role = 'hr' OR 'hr_admin' = ANY(v_role_names) THEN
      v_responsibilities := array_append(v_responsibilities, 'hr_admin');
    END IF;

    IF 'manager' = ANY(v_role_names) OR EXISTS (
      SELECT 1
      FROM public.employees report
      WHERE report.tenant_id = v_tenant_id
        AND report.manager_id = v_employee.id
        AND report.status = 'active'
    ) THEN
      v_responsibilities := array_append(v_responsibilities, 'manager');
    END IF;
  END IF;

  WITH template_grants(responsibility, action, scope_type) AS (
    VALUES
      ('employee', 'employee.basic.read', 'self'),
      ('employee', 'employee.write', 'self'),
      ('employee', 'attendance.read', 'self'),
      ('employee', 'attendance.correction.request', 'self'),
      ('employee', 'shift.read', 'self'),
      ('employee', 'leave.read', 'self'),
      ('employee', 'leave.request', 'self'),
      ('employee', 'policy.read', 'self'),
      ('employee', 'policy.acknowledge', 'self'),
      ('employee', 'task.submit', 'self'),
      ('employee', 'org.read', 'company'),
      ('employee', 'policy.read', 'company'),
      ('employee', 'feed.read', 'company'),
      ('employee', 'feed.post', 'company'),

      ('hr_admin', 'org.read', 'company'),
      ('hr_admin', 'employee.basic.read', 'company'),
      ('hr_admin', 'employee.sensitive.read', 'company'),
      ('hr_admin', 'employee.write', 'company'),
      ('hr_admin', 'employee.export', 'company'),
      ('hr_admin', 'attendance.read', 'company'),
      ('hr_admin', 'attendance.correct', 'company'),
      ('hr_admin', 'attendance.approve', 'company'),
      ('hr_admin', 'shift.read', 'company'),
      ('hr_admin', 'shift.manage', 'company'),
      ('hr_admin', 'device.manage', 'company'),
      ('hr_admin', 'leave.read', 'company'),
      ('hr_admin', 'leave.approve', 'company'),
      ('hr_admin', 'leave.configure', 'company'),
      ('hr_admin', 'policy.read', 'company'),
      ('hr_admin', 'policy.publish', 'company'),
      ('hr_admin', 'policy.configure', 'company'),
      ('hr_admin', 'task.assign', 'company'),
      ('hr_admin', 'task.review', 'company'),

      ('manager', 'employee.basic.read', 'direct_reports'),
      ('manager', 'attendance.read', 'direct_reports'),
      ('manager', 'attendance.approve', 'direct_reports'),
      ('manager', 'leave.read', 'direct_reports'),
      ('manager', 'task.assign', 'direct_reports'),
      ('manager', 'task.review', 'direct_reports'),
      ('manager', 'org.read', 'company'),
      ('manager', 'policy.read', 'company')
  ), distinct_grants AS (
    SELECT DISTINCT tg.action, tg.scope_type
    FROM template_grants tg
    WHERE tg.responsibility = ANY(v_responsibilities)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('action', dg.action, 'scopeType', dg.scope_type)
      ORDER BY dg.action, dg.scope_type
    ),
    '[]'::jsonb
  ) INTO v_grants
  FROM distinct_grants dg;

  SELECT COALESCE(jsonb_agg(enabled.key ORDER BY enabled.sort_order, enabled.key), '[]'::jsonb)
    INTO v_enabled_modules
  FROM (
    SELECT m.key, m.sort_order
    FROM public.modules m
    LEFT JOIN public.tenant_modules tm
      ON tm.tenant_id = v_tenant_id
     AND tm.module_key = m.key
    WHERE m.is_core OR tm.enabled IS TRUE
  ) enabled;

  v_access_version := FLOOR(EXTRACT(EPOCH FROM GREATEST(
    v_tenant.updated_at,
    CASE WHEN v_employee_found THEN v_employee.updated_at ELSE v_tenant.updated_at END,
    COALESCE(v_role_updated_at, v_tenant.updated_at)
  )))::bigint;

  RETURN jsonb_build_object(
    'tenantId', v_tenant_id::text,
    'membershipId', md5(v_tenant_id::text || ':' || v_uid::text)::uuid::text,
    'membershipStatus', v_membership_status,
    'employeeId', CASE WHEN v_employee_found THEN to_jsonb(v_employee.id::text) ELSE 'null'::jsonb END,
    'accessVersion', v_access_version,
    'responsibilities', to_jsonb(v_responsibilities),
    'grants', v_grants,
    'enabledModules', v_enabled_modules,
    'unavailableReason', v_unavailable_reason,
    'issuedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'contractVersion', 'v0.5'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_capability_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_capability_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.assert_distinct_approver(p_subject_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_actor_tenant_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'APPROVER_AUTHENTICATION_REQUIRED'
      USING ERRCODE = 'P1002';
  END IF;

  -- Actor identity and tenant are always re-derived from auth.uid(). P2/P3 callers must resolve
  -- p_subject_user_id from their locked workflow row; this guard accepts no tenant or employee id.
  SELECT e.tenant_id INTO v_actor_tenant_id
  FROM public.employees e
  WHERE e.user_id = v_uid
    AND e.status NOT IN ('terminated', 'inactive')
  ORDER BY e.updated_at DESC, e.id
  LIMIT 1;

  IF v_actor_tenant_id IS NULL THEN
    RAISE EXCEPTION 'APPROVER_IDENTITY_UNAVAILABLE'
      USING ERRCODE = 'P1002';
  END IF;

  -- Self-approval is classified before any authority check. Owner, Company Admin, HR Admin,
  -- Manager and Project Manager responsibilities therefore all receive the same denial class.
  IF p_subject_user_id = v_uid THEN
    RAISE EXCEPTION 'SELF_APPROVAL_DENIED'
      USING ERRCODE = 'P1001',
            DETAIL = 'A controlled request requires a distinct human approver.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees subject
    WHERE subject.user_id = p_subject_user_id
      AND subject.tenant_id = v_actor_tenant_id
  ) THEN
    RAISE EXCEPTION 'APPROVAL_SUBJECT_UNAVAILABLE'
      USING ERRCODE = 'P1003';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_distinct_approver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_distinct_approver(uuid) TO authenticated;
