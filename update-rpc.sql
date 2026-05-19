CREATE OR REPLACE FUNCTION public.set_employee_password_by_hr(
  target_email text,
  target_password_hash text,
  tenant_uuid uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor_role text;
  actor_tenant_id uuid;
  updated_user_id uuid;
  target_user_id uuid;
  target_user_tenant_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF target_email IS NULL OR length(trim(target_email)) = 0 THEN
    RAISE EXCEPTION 'Employee email is required';
  END IF;

  IF target_password_hash IS NULL OR length(trim(target_password_hash)) = 0 THEN
    RAISE EXCEPTION 'Password hash is required';
  END IF;

  SELECT
    u.metadata->>'role',
    NULLIF(u.metadata->>'tenant_id', '')::uuid
  INTO actor_role, actor_tenant_id
  FROM auth.users u
  WHERE u.id = (SELECT auth.uid());

  IF actor_role <> 'hr' OR actor_tenant_id IS DISTINCT FROM tenant_uuid THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Get the target user ID and their current tenant ID (if any)
  SELECT 
    u.id, 
    NULLIF(u.metadata->>'tenant_id', '')::uuid
  INTO target_user_id, target_user_tenant_id
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(target_email));

  IF target_user_id IS NULL THEN
     RAISE EXCEPTION 'Auth user not found';
  END IF;

  -- If the user already belongs to a DIFFERENT tenant, block it. 
  -- If it's NULL (not set yet), we allow claiming it.
  IF target_user_tenant_id IS NOT NULL AND target_user_tenant_id IS DISTINCT FROM tenant_uuid THEN
    RAISE EXCEPTION 'Employee not found for this tenant';
  END IF;

  UPDATE auth.users
  SET password = target_password_hash,
      email_verified = true,
      metadata = jsonb_build_object('role', 'employee', 'tenant_id', tenant_uuid),
      updated_at = now()
  WHERE id = target_user_id
  RETURNING id INTO updated_user_id;

  IF updated_user_id IS NULL THEN
    RAISE EXCEPTION 'Auth user not found during update';
  END IF;

  -- Update public.employees if they exist (they won't exist yet during initial onboarding)
  UPDATE public.employees
  SET user_id = updated_user_id
  WHERE tenant_id = tenant_uuid
    AND lower(email) = lower(trim(target_email));

  RETURN updated_user_id;
END;
$$;
