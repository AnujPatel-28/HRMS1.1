-- P3-03 Tier 2 lead forward fix (2026-09-21), authorized by the lead after 189300.
-- Defect: p3_set_channel_members lets any channel.manage holder add THEMSELVES to an existing
-- private (custom) channel and then read its full history -- defeating contracts §16 A1 ("HR
-- manages channels, never reads private ones unless a member"). A manager may self-add only to a
-- custom channel they created (creation does not auto-add the creator). Adding other people is
-- unchanged. Same signature; body derived from 189200 with only the self-add guard inserted.
CREATE OR REPLACE FUNCTION public.p3_set_channel_members(p_channel_id uuid, p_employee_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE v_tenant uuid; v_employee uuid; v_added integer := 0; v_caller uuid; v_channel public.chat_channels%ROWTYPE;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.has_access_action('channel.manage', 'company', NULL) THEN
    RAISE EXCEPTION 'CHANNEL_MANAGE_DENIED' USING ERRCODE = 'P1003'; END IF;
  SELECT * INTO v_channel FROM public.chat_channels c WHERE c.id = p_channel_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHANNEL_NOT_FOUND' USING ERRCODE = 'P1003'; END IF;
  IF p_employee_ids IS NULL THEN RETURN 0; END IF;
  v_caller := public.get_my_employee_id();
  IF v_channel.type = 'custom' AND v_caller = ANY (p_employee_ids)
     AND v_channel.created_by IS DISTINCT FROM v_caller
     AND NOT EXISTS (SELECT 1 FROM public.chat_channel_members m
                     WHERE m.channel_id = p_channel_id AND m.employee_id = v_caller) THEN
    RAISE EXCEPTION 'CHANNEL_SELF_ADD_DENIED' USING ERRCODE = 'P1003'; END IF;
  FOREACH v_employee IN ARRAY p_employee_ids LOOP
    IF EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_employee AND e.tenant_id = v_tenant
        AND e.status NOT IN ('inactive', 'terminated', 'draft', 'pending_hr_review', 'pending_onboarding')) THEN
      INSERT INTO public.chat_channel_members(tenant_id, channel_id, employee_id)
        VALUES (v_tenant, p_channel_id, v_employee)
        ON CONFLICT (channel_id, employee_id) DO NOTHING;
      IF FOUND THEN v_added := v_added + 1; END IF;
    END IF;
  END LOOP;
  RETURN v_added;
END; $$;
REVOKE ALL ON FUNCTION public.p3_set_channel_members(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_set_channel_members(uuid, uuid[]) TO authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname='p3_set_channel_members') <> 1 THEN
    RAISE EXCEPTION 'P3 function overload invariant failed: p3_set_channel_members';
  END IF;
END $$;
