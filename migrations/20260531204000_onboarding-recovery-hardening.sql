-- Migration: Onboarding Recovery Hardening (v2 RPC & Active Check)
-- Path: migrations/20260531204000_onboarding-recovery-hardening.sql

-- 1. Create v2 of get_auth_user_details_by_email to expose tenant_id safely
CREATE OR REPLACE FUNCTION public.get_auth_user_details_by_email_v2(user_email text)
RETURNS TABLE(id uuid, created_at timestamp with time zone, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT au.id, au.created_at, NULLIF(au.metadata->>'tenant_id', '')::uuid
  FROM auth.users au
  WHERE lower(au.email) = lower(trim(user_email))
  LIMIT 1;
END;
$$;

-- 2. Redefine check_onboarding_resumable to prevent resuming active employee profiles
CREATE OR REPLACE FUNCTION public.check_onboarding_resumable(p_email text, p_tenant_id uuid)
RETURNS TABLE(auth_user_id uuid, status text, employee_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_auth_user_id uuid;
  v_status text;
  v_employee_id uuid;
  v_employee_status text;
BEGIN
  -- Security check: caller must have access to the target tenant
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Get the auth user details by email, strictly scoped to target tenant in metadata
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
    AND (metadata->>'tenant_id')::uuid = p_tenant_id;

  IF v_auth_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Check if employee record already exists in this tenant
  SELECT id, status INTO v_employee_id, v_employee_status
  FROM public.employees
  WHERE user_id = v_auth_user_id
    AND tenant_id = p_tenant_id;

  -- If employee exists and is active, onboarding is complete, NOT resumable.
  IF v_employee_id IS NOT NULL AND v_employee_status = 'active' THEN
    RETURN;
  END IF;

  -- Get onboarding status for this user in this tenant
  SELECT eo.status INTO v_status
  FROM public.employee_onboarding eo
  WHERE eo.auth_user_id = v_auth_user_id
    AND eo.tenant_id = p_tenant_id;

  -- Only return if onboarding status exists and is not 'active'
  IF v_status IS NOT NULL AND v_status != 'active' THEN
    RETURN QUERY SELECT v_auth_user_id, v_status, v_employee_id;
  END IF;
END;
$$;
