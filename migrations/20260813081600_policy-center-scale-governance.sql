-- Migration: Policy Center Release P5 - Scale, Versioning, Acknowledgement, and Operational UX
-- Created: 2026-07-06T23:00:00Z

-- 1. Add versioning columns to hr_policies
ALTER TABLE public.hr_policies
ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS effective_date date,
ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS requires_acknowledgement boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS supersedes_policy_id uuid REFERENCES public.hr_policies(id) ON DELETE SET NULL;

-- 2. Create employee_policy_acknowledgements table
CREATE TABLE IF NOT EXISTS public.employee_policy_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.hr_policies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  acknowledged_at timestamp with time zone NOT NULL DEFAULT now(),
  acknowledgement_text text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT employee_policy_acknowledgements_tenant_policy_employee_key UNIQUE (tenant_id, policy_id, employee_id)
);

-- 3. Enable RLS on employee_policy_acknowledgements
ALTER TABLE public.employee_policy_acknowledgements ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies for employee_policy_acknowledgements
DROP POLICY IF EXISTS tenant_isolation ON public.employee_policy_acknowledgements;
CREATE POLICY tenant_isolation ON public.employee_policy_acknowledgements
  FOR ALL
  TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

DROP POLICY IF EXISTS tenant_active_restrictive ON public.employee_policy_acknowledgements;
CREATE POLICY tenant_active_restrictive ON public.employee_policy_acknowledgements
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING (public.can_access_tenant(tenant_id))
  WITH CHECK (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS acknowledgements_hr_all ON public.employee_policy_acknowledgements;
CREATE POLICY acknowledgements_hr_all ON public.employee_policy_acknowledgements
  FOR SELECT
  TO authenticated
  USING (public.is_hr());

DROP POLICY IF EXISTS acknowledgements_employee_self ON public.employee_policy_acknowledgements;
CREATE POLICY acknowledgements_employee_self ON public.employee_policy_acknowledgements
  FOR ALL
  TO authenticated
  USING (
    employee_id IN (
      SELECT e.id FROM public.employees e 
      WHERE e.user_id = auth.uid() AND e.tenant_id = tenant_id
    )
  )
  WITH CHECK (
    employee_id IN (
      SELECT e.id FROM public.employees e 
      WHERE e.user_id = auth.uid() AND e.tenant_id = tenant_id
    )
  );

-- 5. RPC: create_policy_notifications_transaction
CREATE OR REPLACE FUNCTION public.create_policy_notifications_transaction(
  p_policy_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_actor_id uuid;
  v_policy_title text;
  v_visible_to text;
  v_department_filter text;
  v_org_unit_id uuid;
  v_org_unit_name text;
  v_title_prefix text;
  v_inserted_count integer := 0;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can trigger notifications';
  END IF;

  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- Get policy metadata
  SELECT p.title, p.visible_to, p.department_filter, p.org_unit_id, ou.name
  INTO v_policy_title, v_visible_to, v_department_filter, v_org_unit_id, v_org_unit_name
  FROM public.hr_policies p
  LEFT JOIN public.org_units ou ON p.org_unit_id = ou.id
  WHERE p.id = p_policy_id AND p.tenant_id = v_tenant_id;

  IF v_policy_title IS NULL THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Policy not found';
  END IF;

  -- Get actor employee id for audit log
  SELECT e.id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid() AND e.tenant_id = v_tenant_id
  LIMIT 1;

  -- Determine title prefix
  IF v_visible_to = 'all' THEN
    v_title_prefix := 'New Company Policy:';
  ELSIF v_visible_to = 'hr_only' THEN
    v_title_prefix := 'New HR-Only Policy:';
  ELSE
    IF v_org_unit_id IS NOT NULL THEN
      v_title_prefix := 'New Policy for ' || coalesce(v_org_unit_name, 'Org Unit') || ':';
    ELSE
      v_title_prefix := 'New Policy for ' || coalesce(v_department_filter, 'Department') || ':';
    END IF;
  END IF;

  -- Insert notifications in a server-side batch
  WITH inserted_rows AS (
    INSERT INTO public.notifications (tenant_id, employee_id, title, body, type)
    SELECT 
      v_tenant_id,
      e.id,
      'New HR Policy Document',
      v_title_prefix || ' ' || v_policy_title,
      'new_policy'
    FROM public.employees e
    WHERE e.tenant_id = v_tenant_id
      AND e.status = 'active'
      AND (
        v_visible_to = 'all'
        OR (v_visible_to = 'hr_only' AND e.department = 'operations')
        OR (
          v_visible_to = 'department-specific'
          AND (
            (v_org_unit_id IS NOT NULL AND e.org_unit_id = v_org_unit_id)
            OR
            (v_org_unit_id IS NULL AND v_department_filter IS NOT NULL AND e.department = v_department_filter)
          )
        )
      )
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_count FROM inserted_rows;

  -- Log action
  INSERT INTO public.audit_logs (
    tenant_id,
    action,
    target_type,
    target_id,
    actor_id,
    metadata
  ) VALUES (
    v_tenant_id,
    'policy.notified',
    'hr_policy',
    p_policy_id,
    v_actor_id,
    jsonb_build_object('policy_id', p_policy_id, 'notification_count', v_inserted_count)
  );

  RETURN jsonb_build_object('count', v_inserted_count);
END;
$$;

-- 6. RPC: get_hr_policy_library (paginated, HR)
CREATE OR REPLACE FUNCTION public.get_hr_policy_library(
  p_search text DEFAULT NULL,
  p_visibility text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  title text,
  description text,
  file_url text,
  file_name text,
  visible_to text,
  department_filter text,
  org_unit_id uuid,
  org_unit_name text,
  storage_path text,
  version_number integer,
  effective_date date,
  expires_at timestamp with time zone,
  requires_acknowledgement boolean,
  supersedes_policy_id uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  acknowledged_count bigint,
  total_targeted bigint,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can view policy library';
  END IF;

  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered_policies AS (
    SELECT 
      p.id,
      p.tenant_id,
      p.title,
      p.description,
      p.file_url,
      p.file_name,
      p.visible_to,
      p.department_filter,
      p.org_unit_id,
      ou.name AS org_unit_name,
      p.storage_path,
      p.version_number,
      p.effective_date,
      p.expires_at,
      p.requires_acknowledgement,
      p.supersedes_policy_id,
      p.created_at,
      p.updated_at
    FROM public.hr_policies p
    LEFT JOIN public.org_units ou ON p.org_unit_id = ou.id
    WHERE p.tenant_id = v_tenant_id
      AND (p_search IS NULL OR p_search = '' OR p.title ILIKE '%' || p_search || '%')
      AND (p_visibility IS NULL OR p_visibility = '' OR p_visibility = 'all_types' OR p.visible_to = p_visibility)
  ),
  stats AS (
    SELECT 
      fp.id,
      (
        SELECT count(*) 
        FROM public.employee_policy_acknowledgements epa 
        WHERE epa.policy_id = fp.id AND epa.tenant_id = v_tenant_id
      ) AS ack_count,
      (
        SELECT count(*)
        FROM public.employees e
        WHERE e.tenant_id = v_tenant_id
          AND e.status = 'active'
          AND (
            fp.visible_to = 'all'
            OR (fp.visible_to = 'hr_only' AND e.department = 'operations')
            OR (
              fp.visible_to = 'department-specific'
              AND (
                (fp.org_unit_id IS NOT NULL AND e.org_unit_id = fp.org_unit_id)
                OR
                (fp.org_unit_id IS NULL AND fp.department_filter IS NOT NULL AND e.department = fp.department_filter)
              )
            )
          )
      ) AS target_count
    FROM filtered_policies fp
  ),
  count_total AS (
    SELECT count(*) AS total FROM filtered_policies
  )
  SELECT 
    fp.id,
    fp.tenant_id,
    fp.title,
    fp.description,
    fp.file_url,
    fp.file_name,
    fp.visible_to,
    fp.department_filter,
    fp.org_unit_id,
    fp.org_unit_name,
    fp.storage_path,
    fp.version_number,
    fp.effective_date,
    fp.expires_at,
    fp.requires_acknowledgement,
    fp.supersedes_policy_id,
    fp.created_at,
    fp.updated_at,
    s.ack_count,
    s.target_count,
    ct.total
  FROM filtered_policies fp
  JOIN stats s ON fp.id = s.id
  CROSS JOIN count_total ct
  ORDER BY fp.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- 7. RPC: get_employee_visible_hr_policies (paginated, Employee)
DROP FUNCTION IF EXISTS public.get_employee_visible_hr_policies();
CREATE OR REPLACE FUNCTION public.get_employee_visible_hr_policies(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  title text,
  description text,
  file_url text,
  file_name text,
  visible_to text,
  department_filter text,
  org_unit_id uuid,
  org_unit_name text,
  storage_path text,
  version_number integer,
  effective_date date,
  expires_at timestamp with time zone,
  requires_acknowledgement boolean,
  supersedes_policy_id uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  acknowledged_at timestamp with time zone,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_employee_department text;
  v_employee_org_unit_id uuid;
  v_employee_id uuid;
BEGIN
  -- Get active tenant context
  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- Get current employee's info
  SELECT e.id, e.department, e.org_unit_id
  INTO v_employee_id, v_employee_department, v_employee_org_unit_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_tenant_id
  LIMIT 1;

  RETURN QUERY
  WITH visible_policies AS (
    SELECT 
      p.id,
      p.tenant_id,
      p.title,
      p.description,
      p.file_url,
      p.file_name,
      p.visible_to,
      p.department_filter,
      p.org_unit_id,
      ou.name AS org_unit_name,
      p.storage_path,
      p.version_number,
      p.effective_date,
      p.expires_at,
      p.requires_acknowledgement,
      p.supersedes_policy_id,
      p.created_at,
      p.updated_at
    FROM public.hr_policies p
    LEFT JOIN public.org_units ou ON p.org_unit_id = ou.id
    WHERE p.tenant_id = v_tenant_id
      AND (
        p.visible_to = 'all'
        OR (
          p.visible_to = 'department-specific'
          AND (
            (p.org_unit_id IS NOT NULL AND p.org_unit_id = v_employee_org_unit_id)
            OR
            (p.org_unit_id IS NULL AND p.department_filter = v_employee_department)
          )
        )
      )
      AND (p_search IS NULL OR p_search = '' OR p.title ILIKE '%' || p_search || '%')
  ),
  count_total AS (
    SELECT count(*) AS total FROM visible_policies
  )
  SELECT 
    vp.id,
    vp.tenant_id,
    vp.title,
    vp.description,
    vp.file_url,
    vp.file_name,
    vp.visible_to,
    vp.department_filter,
    vp.org_unit_id,
    vp.org_unit_name,
    vp.storage_path,
    vp.version_number,
    vp.effective_date,
    vp.expires_at,
    vp.requires_acknowledgement,
    vp.supersedes_policy_id,
    vp.created_at,
    vp.updated_at,
    epa.acknowledged_at,
    ct.total
  FROM visible_policies vp
  LEFT JOIN public.employee_policy_acknowledgements epa 
    ON vp.id = epa.policy_id AND epa.employee_id = v_employee_id
  CROSS JOIN count_total ct
  ORDER BY vp.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- 8. RPC: acknowledge_policy_transaction (Employee)
CREATE OR REPLACE FUNCTION public.acknowledge_policy_transaction(
  p_policy_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_employee_id uuid;
  v_visible boolean := false;
  v_new_ack_id uuid;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- Get current employee's info
  SELECT e.id
  INTO v_employee_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_tenant_id
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Employee profile not found';
  END IF;

  -- Verify policy visibility to this employee
  SELECT EXISTS (
    SELECT 1
    FROM public.hr_policies p
    JOIN public.employees e ON e.id = v_employee_id
    WHERE p.id = p_policy_id
      AND p.tenant_id = v_tenant_id
      AND (
        p.visible_to = 'all'
        OR (
          p.visible_to = 'department-specific'
          AND (
            (p.org_unit_id IS NOT NULL AND p.org_unit_id = e.org_unit_id)
            OR
            (p.org_unit_id IS NULL AND p.department_filter = e.department)
          )
        )
      )
  ) INTO v_visible;

  IF NOT v_visible THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Policy not visible to this employee';
  END IF;

  -- Insert acknowledgement with duplicate check
  INSERT INTO public.employee_policy_acknowledgements (
    tenant_id,
    policy_id,
    employee_id,
    acknowledged_at,
    acknowledgement_text
  ) VALUES (
    v_tenant_id,
    p_policy_id,
    v_employee_id,
    now(),
    'Acknowledged electronically'
  )
  ON CONFLICT (tenant_id, policy_id, employee_id) DO NOTHING
  RETURNING id INTO v_new_ack_id;

  IF v_new_ack_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Policy already acknowledged';
  END IF;

  -- Log action
  INSERT INTO public.audit_logs (
    tenant_id,
    action,
    target_type,
    target_id,
    actor_id,
    metadata
  ) VALUES (
    v_tenant_id,
    'policy.acknowledged',
    'hr_policy',
    p_policy_id,
    v_employee_id,
    jsonb_build_object('policy_id', p_policy_id)
  );

  RETURN jsonb_build_object('acknowledged', true);
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.create_policy_notifications_transaction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hr_policy_library(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_visible_hr_policies(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_policy_transaction(uuid) TO authenticated;
