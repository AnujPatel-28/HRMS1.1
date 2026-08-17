-- Migration: Policy Center Release P1 - Document Privacy Foundation
-- Created: 2026-07-06T19:00:00Z
-- Adds storage_path column to hr_policies, indices for search, backfills, and safe employee read RPC.

ALTER TABLE public.hr_policies
ADD COLUMN IF NOT EXISTS storage_path text;

CREATE INDEX IF NOT EXISTS idx_hr_policies_tenant_visible_created
ON public.hr_policies (tenant_id, visible_to, created_at desc);

CREATE INDEX IF NOT EXISTS idx_hr_policies_tenant_department
ON public.hr_policies (tenant_id, department_filter)
WHERE department_filter IS NOT NULL;

-- Backfill storage_path from file_url for existing objects in the hr-policies storage bucket
UPDATE public.hr_policies
SET storage_path = replace(split_part(file_url, '/objects/', 2), '%2F', '/')
WHERE storage_path IS NULL
  AND file_url LIKE '%/objects/%';

UPDATE public.hr_policies
SET storage_path = split_part(file_url, '/hr-policies/', 2)
WHERE storage_path IS NULL
  AND file_url LIKE '%/hr-policies/%';

-- Create public employee read RPC
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
BEGIN
  -- Get active tenant context securely via the helper function
  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- Get current employee's department from employees table matching current authenticated user
  SELECT e.department
  INTO v_employee_department
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
    p.created_at,
    p.updated_at
  FROM public.hr_policies p
  WHERE p.tenant_id = v_tenant_id
    AND (
      p.visible_to = 'all'
      OR (
        p.visible_to = 'department-specific'
        AND p.department_filter = v_employee_department
      )
    )
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_visible_hr_policies() TO authenticated;
