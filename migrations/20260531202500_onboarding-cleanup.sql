-- Migration: Onboarding Cleanup Job & Recovery RPC
-- Path: migrations/20260531202500_onboarding-cleanup.sql

-- 1. Add expired_at column if not exists
ALTER TABLE public.employee_onboarding ADD COLUMN IF NOT EXISTS expired_at timestamptz;

-- 2. Create the stored procedure to clean up stale onboarding flows
CREATE OR REPLACE FUNCTION public.fn_cleanup_expired_onboarding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    UPDATE public.employee_onboarding
    SET status = 'expired',
        expired_at = NOW(),
        updated_at = NOW()
    WHERE status != 'active'
      AND status != 'expired'
      AND created_at < NOW() - INTERVAL '7 days';
END;
$$;

-- 3. Schedule the cleanup job via pg_cron (daily at midnight)
SELECT cron.schedule('cleanup-expired-onboarding', '0 0 * * *', 'SELECT public.fn_cleanup_expired_onboarding()');

-- 4. Create the secure onboarding recovery check RPC
CREATE OR REPLACE FUNCTION public.check_onboarding_resumable(p_email text, p_tenant_id uuid)
RETURNS TABLE(auth_user_id uuid, status text, employee_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_auth_user_id uuid;
  v_status text;
  v_employee_id uuid;
BEGIN
  -- Security check: caller must have access to the target tenant
  IF NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Get the auth user details by email, strictly scoped to target tenant in metadata
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = p_email
    AND (metadata->>'tenant_id')::uuid = p_tenant_id;

  IF v_auth_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Get onboarding status for this user in this tenant
  SELECT eo.status INTO v_status
  FROM public.employee_onboarding eo
  WHERE eo.auth_user_id = v_auth_user_id
    AND eo.tenant_id = p_tenant_id;

  -- Get employee ID if it exists (e.g. if profile was inserted but onboarding wasn't finalized)
  SELECT e.id INTO v_employee_id
  FROM public.employees e
  WHERE e.user_id = v_auth_user_id
    AND e.tenant_id = p_tenant_id;

  -- Only return if onboarding status exists and is not 'active'
  IF v_status IS NOT NULL AND v_status != 'active' THEN
    RETURN QUERY SELECT v_auth_user_id, v_status, v_employee_id;
  END IF;
END;
$$;
