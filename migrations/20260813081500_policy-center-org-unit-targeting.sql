-- Migration: Policy Center Release P4 - Normalized Org Unit Policy Targeting
-- Created: 2026-07-06T22:00:00Z

-- 1. Add org_unit_id column referencing org_units table
ALTER TABLE public.hr_policies
ADD COLUMN IF NOT EXISTS org_unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL;

-- 2. Create index for performance
CREATE INDEX IF NOT EXISTS idx_hr_policies_tenant_org_unit
ON public.hr_policies (tenant_id, org_unit_id)
WHERE org_unit_id IS NOT NULL;

-- 3. Drop existing function to change return type
DROP FUNCTION IF EXISTS public.get_employee_visible_hr_policies();

-- 4. Create employee visible policies read RPC to support org_unit_id matching and department fallback
CREATE OR REPLACE FUNCTION public.get_employee_visible_hr_policies()
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
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_employee_department text;
  v_employee_org_unit_id uuid;
BEGIN
  -- Get active tenant context
  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- Get current employee's department and org_unit_id with table prefix to avoid ambiguity with return columns
  SELECT e.department, e.org_unit_id
  INTO v_employee_department, v_employee_org_unit_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_tenant_id
  LIMIT 1;

  RETURN QUERY
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
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_visible_hr_policies() TO authenticated;
