-- Migration: Phase 2 User-Based Rate Limiting

CREATE TABLE IF NOT EXISTS public.rate_limits (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  request_count int NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, endpoint)
);

-- RLS
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No standard RLS policies needed if accessed exclusively via SECURITY DEFINER RPC.

-- RPC to check rate limits
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_tenant_id uuid,
  p_user_id uuid,
  p_endpoint text,
  p_max_requests int,
  p_window_interval interval
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_time timestamptz := now();
  v_record public.rate_limits%ROWTYPE;
BEGIN
  -- Cleanup old records for this specific key
  DELETE FROM public.rate_limits 
  WHERE tenant_id = p_tenant_id 
    AND user_id = p_user_id 
    AND endpoint = p_endpoint
    AND window_start < v_current_time - p_window_interval;

  SELECT * INTO v_record FROM public.rate_limits
  WHERE tenant_id = p_tenant_id 
    AND user_id = p_user_id 
    AND endpoint = p_endpoint;

  IF FOUND THEN
    IF v_record.request_count >= p_max_requests THEN
      RETURN false; -- Rate limit exceeded
    ELSE
      UPDATE public.rate_limits
      SET request_count = request_count + 1
      WHERE tenant_id = p_tenant_id 
        AND user_id = p_user_id 
        AND endpoint = p_endpoint;
      RETURN true;
    END IF;
  ELSE
    INSERT INTO public.rate_limits (tenant_id, user_id, endpoint, request_count, window_start)
    VALUES (p_tenant_id, p_user_id, p_endpoint, 1, v_current_time);
    RETURN true;
  END IF;
END;
$$;
