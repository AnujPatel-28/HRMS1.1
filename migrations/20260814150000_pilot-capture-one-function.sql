-- PILOT: verify the migration runner handles dollar-quoted bodies containing semicolons.
-- Mechanical capture of the live definition. CREATE OR REPLACE preserves ownership and grants.

CREATE OR REPLACE FUNCTION public.get_auth_employee_id(p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT e.id
  FROM public.employees e
  WHERE e.user_id = (SELECT auth.uid())
    AND e.tenant_id = p_tenant_id
    AND e.status = 'active'
  LIMIT 1;
$function$

