-- P1-02 forward repair for the access audit writer applied in 20260912181000.
-- Keep the public function signature stable: every existing caller passes target ids as text.

CREATE OR REPLACE FUNCTION public.write_access_audit(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_details jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_actor_membership_id uuid;
  v_actor_employee_id uuid;
BEGIN
  IF p_action !~ '^access\.' THEN
    RAISE EXCEPTION 'ACCESS_AUDIT_ACTION_REQUIRED';
  END IF;

  -- Validate before INSERT so callers get a stable domain error instead of PostgreSQL's raw cast
  -- failure. The cast is repeated at the write site to keep audit_logs.target_id UUID-typed.
  BEGIN
    PERFORM NULLIF(p_target_id, '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'ACCESS_AUDIT_TARGET_ID_INVALID' USING ERRCODE = 'P1001';
  END;

  SELECT m.id, m.employee_id
  INTO v_actor_membership_id, v_actor_employee_id
  FROM public.tenant_memberships m
  WHERE m.tenant_id = p_tenant_id AND m.user_id = p_actor_user_id;

  INSERT INTO public.audit_logs (
    tenant_id, actor_id, actor_role, action, target_type, target_id, details
  ) VALUES (
    p_tenant_id,
    v_actor_employee_id,
    'membership',
    p_action,
    p_target_type,
    NULLIF(p_target_id, '')::uuid,
    COALESCE(p_details, '{}'::jsonb) || jsonb_build_object(
      'actor_user_id', p_actor_user_id,
      'actor_membership_id', v_actor_membership_id,
      'server_written_at', clock_timestamp()
    )
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_access_audit(uuid,uuid,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
