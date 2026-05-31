-- Migration: Onboarding Cleanup Refinement
-- Path: migrations/20260531203500_onboarding-cleanup-refinement.sql

CREATE OR REPLACE FUNCTION public.fn_cleanup_expired_onboarding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    UPDATE public.employee_onboarding eo
    SET status = 'expired',
        expired_at = NOW(),
        updated_at = NOW()
    WHERE eo.status IN ('pending_auth', 'otp_verified', 'password_set')
      AND eo.created_at < NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.user_id = eo.auth_user_id
          AND e.tenant_id = eo.tenant_id
      );
END;
$$;
