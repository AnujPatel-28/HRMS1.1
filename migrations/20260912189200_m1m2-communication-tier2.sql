-- P3-03 Tier 2: within-tenant chat/Connect authorization (contracts.md v0.5 §16 A1, A2).
-- Builds on 20260912189000/189100 (Tier 1 cross-tenant/anon isolation, accepted).
-- Applied migrations are immutable; 20260912189300_... is pre-authorized for exactly one
-- forward fix, named with evidence.

-- ---------------------------------------------------------------------------------------------
-- T2-1: catalogue grants (A1). HR Admin gains channel.manage@company (manage only, not read of
-- private channel content) and project.read@company (read-only). Communication Moderator gains
-- channel.manage@company (creation needs a company-scope action; it already holds channel.manage
-- at channel scope for §4's per-channel row). Idempotent.
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.access_template_grants (template_key, action, scope_type) VALUES
  ('hr_admin', 'channel.manage', 'company'),
  ('hr_admin', 'project.read', 'company'),
  ('communication_moderator', 'channel.manage', 'company')
ON CONFLICT (template_key, action, scope_type) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- T2-2: channel/message audience resolvers.
--
-- p3_channel_audience is the MESSAGE-READ rule: global (everyone in tenant), department
-- (org-unit match), custom (members only). No HR/company-admin/channel-manage bypass here -- this
-- is also what the realtime chat: topic predicate now delegates to, replacing the Tier 1 version
-- that only checked tenant membership of the channel row (package-review-P3-03-tier1.md §3).
--
-- p3_channel_metadata_visible is the CHANNEL-ROW visibility rule: message audience, plus any
-- explicit member row regardless of channel type, plus holders of channel.manage@company (so HR
-- can see a private channel exists and manage its membership without reading its messages).
--
-- p3_channel_scope is the explicit channel:<id> scope check (contracts.md §3): an active
-- Communication Moderator template assignment, with a matching channel-scoped grant row, AND an
-- explicit chat_channel_members row for that specific channel -- never a blanket bypass.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.p3_channel_audience(p_channel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels c
    WHERE c.id = p_channel_id
      AND c.tenant_id = public.get_auth_tenant_id()
      AND public.can_access_tenant(c.tenant_id)
      AND (
        c.type = 'global'
        OR (c.type = 'department' AND public.get_my_org_unit_id() = ANY (c.target_org_unit_ids))
        OR (c.type = 'custom' AND EXISTS (
              SELECT 1 FROM public.chat_channel_members ccm
              WHERE ccm.channel_id = c.id AND ccm.employee_id = public.get_my_employee_id()
            ))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.p3_channel_audience(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_channel_audience(uuid) TO authenticated;

CREATE FUNCTION public.p3_channel_metadata_visible(p_channel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.p3_channel_audience(p_channel_id)
    OR EXISTS (
      SELECT 1 FROM public.chat_channel_members ccm
      JOIN public.chat_channels c ON c.id = ccm.channel_id
      WHERE ccm.channel_id = p_channel_id AND c.tenant_id = public.get_auth_tenant_id()
        AND ccm.employee_id = public.get_my_employee_id()
    )
    OR (
      EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.id = p_channel_id AND c.tenant_id = public.get_auth_tenant_id())
      AND public.has_access_action('channel.manage', 'company', NULL)
    );
$$;
REVOKE ALL ON FUNCTION public.p3_channel_metadata_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_channel_metadata_visible(uuid) TO authenticated;

CREATE FUNCTION public.p3_channel_scope(p_channel_id uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.chat_channel_members ccm ON ccm.channel_id = c.id AND ccm.tenant_id = c.tenant_id
    JOIN public.tenant_memberships m ON m.tenant_id = c.tenant_id AND m.employee_id = ccm.employee_id
      AND m.user_id = (SELECT auth.uid()) AND m.status = 'active'
    JOIN public.employees e ON e.id = ccm.employee_id AND e.tenant_id = c.tenant_id
    JOIN public.membership_template_assignments a ON a.membership_id = m.id AND a.tenant_id = m.tenant_id
      AND a.is_active AND a.template_key = 'communication_moderator'
    JOIN public.access_template_grants g ON g.template_key = a.template_key AND g.action = p_action AND g.scope_type = 'channel'
    WHERE c.id = p_channel_id AND c.tenant_id = (SELECT public.get_auth_tenant_id())
      AND public.can_access_tenant(c.tenant_id)
      AND e.status NOT IN ('inactive', 'terminated', 'draft', 'pending_hr_review', 'pending_onboarding')
  );
$$;
REVOKE ALL ON FUNCTION public.p3_channel_scope(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_channel_scope(uuid, text) TO authenticated;

-- Realtime chat: subscribe now follows the message-read rule, not channel-row visibility, so a
-- channel manager (HR) cannot subscribe to a private channel it does not belong to. Exact
-- signature preserved (SECURITY INVOKER, unchanged); only the chat: branch body changed.
CREATE OR REPLACE FUNCTION public.p3_realtime_topic_readable(topic text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.chat_channels c
      WHERE topic = 'chat:' || c.tenant_id::text || ':' || c.id::text
        AND c.tenant_id = public.get_auth_tenant_id()
        AND public.p3_channel_audience(c.id))
    OR (topic = 'chat-channels:' || public.get_auth_tenant_id()::text
        AND public.can_access_tenant(public.get_auth_tenant_id())
        AND public.tenant_has_module('chat') AND public.get_my_employee_id() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.employees e
      WHERE topic = 'notifications:' || e.tenant_id::text || ':' || e.id::text
        AND e.user_id = auth.uid() AND e.tenant_id = public.get_auth_tenant_id()
        AND public.can_access_tenant(e.tenant_id))
  );
$$;
REVOKE ALL ON FUNCTION public.p3_realtime_topic_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_realtime_topic_readable(text) TO authenticated;

-- Channel/member metadata: replace employee-select and drop the blanket HR bypass.
DROP POLICY IF EXISTS channels_employee_select ON public.chat_channels;
DROP POLICY IF EXISTS channels_hr_all ON public.chat_channels;
CREATE POLICY chat_channels_select ON public.chat_channels FOR SELECT TO authenticated
  USING (public.p3_channel_metadata_visible(id));

DROP POLICY IF EXISTS members_employee_select ON public.chat_channel_members;
DROP POLICY IF EXISTS members_hr_all ON public.chat_channel_members;
CREATE POLICY chat_channel_members_select ON public.chat_channel_members FOR SELECT TO authenticated
  USING (public.p3_channel_metadata_visible(channel_id));

-- Messages: message-read rule only (global/department audience, custom = members only). No HR,
-- jwt_role_is_hr(), is_hr() or Company-Admin bypass. Direct-write policies are dropped too --
-- INSERT/UPDATE/DELETE move to definer RPCs below and the grants are revoked at the end.
DROP POLICY IF EXISTS chat_messages_hr_all ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_employee_insert ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_production_insert ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_production_update ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_self_delete ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_production_delete ON public.chat_messages;
CREATE POLICY chat_messages_read ON public.chat_messages FOR SELECT TO authenticated
  USING ((NOT is_deleted OR sender_id = public.get_my_employee_id()) AND public.p3_channel_audience(channel_id));

-- ---------------------------------------------------------------------------------------------
-- T2-3: writes through definer RPCs (P2-02/P3-02 pattern). Column allowlists, tenant fence,
-- pinned search_path, no anon EXECUTE.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.p3_create_chat_channel(
  p_name text, p_type text, p_description text DEFAULT NULL,
  p_target_org_unit_ids uuid[] DEFAULT NULL, p_is_announcement boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE v_tenant uuid; v_creator uuid; v_channel uuid;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.can_access_tenant(v_tenant) OR NOT public.tenant_has_module('chat') THEN
    RAISE EXCEPTION 'CHAT_UNAVAILABLE' USING ERRCODE = 'P1002'; END IF;
  IF NOT public.has_access_action('channel.manage', 'company', NULL) THEN
    RAISE EXCEPTION 'CHANNEL_MANAGE_DENIED' USING ERRCODE = 'P1003'; END IF;
  IF p_type NOT IN ('global', 'department', 'custom') THEN
    RAISE EXCEPTION 'CHANNEL_TYPE_INVALID' USING ERRCODE = 'P1003'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_NAME_REQUIRED' USING ERRCODE = 'P1003'; END IF;
  IF p_type = 'department' AND (p_target_org_unit_ids IS NULL OR array_length(p_target_org_unit_ids, 1) IS NULL) THEN
    RAISE EXCEPTION 'CHANNEL_ORG_UNITS_REQUIRED' USING ERRCODE = 'P1003'; END IF;
  v_creator := public.get_my_employee_id();
  INSERT INTO public.chat_channels(tenant_id, name, description, type, target_org_unit_ids, is_announcement, created_by)
    VALUES (v_tenant, btrim(p_name), p_description, p_type,
      CASE WHEN p_type = 'department' THEN p_target_org_unit_ids ELSE NULL END,
      COALESCE(p_is_announcement, false), v_creator)
    RETURNING id INTO v_channel;
  RETURN v_channel;
END; $$;
REVOKE ALL ON FUNCTION public.p3_create_chat_channel(text, text, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_create_chat_channel(text, text, text, uuid[], boolean) TO authenticated;

CREATE FUNCTION public.p3_update_chat_channel(
  p_channel_id uuid, p_name text, p_description text, p_type text,
  p_target_org_unit_ids uuid[], p_is_announcement boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.has_access_action('channel.manage', 'company', NULL) THEN
    RAISE EXCEPTION 'CHANNEL_MANAGE_DENIED' USING ERRCODE = 'P1003'; END IF;
  IF p_type NOT IN ('global', 'department', 'custom') THEN
    RAISE EXCEPTION 'CHANNEL_TYPE_INVALID' USING ERRCODE = 'P1003'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_NAME_REQUIRED' USING ERRCODE = 'P1003'; END IF;
  IF p_type = 'department' AND (p_target_org_unit_ids IS NULL OR array_length(p_target_org_unit_ids, 1) IS NULL) THEN
    RAISE EXCEPTION 'CHANNEL_ORG_UNITS_REQUIRED' USING ERRCODE = 'P1003'; END IF;
  UPDATE public.chat_channels SET name = btrim(p_name), description = p_description, type = p_type,
      target_org_unit_ids = CASE WHEN p_type = 'department' THEN p_target_org_unit_ids ELSE NULL END,
      is_announcement = COALESCE(p_is_announcement, false)
    WHERE id = p_channel_id AND tenant_id = v_tenant;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.p3_update_chat_channel(uuid, text, text, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_update_chat_channel(uuid, text, text, text, uuid[], boolean) TO authenticated;

CREATE FUNCTION public.p3_set_channel_members(p_channel_id uuid, p_employee_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE v_tenant uuid; v_employee uuid; v_added integer := 0;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.has_access_action('channel.manage', 'company', NULL) THEN
    RAISE EXCEPTION 'CHANNEL_MANAGE_DENIED' USING ERRCODE = 'P1003'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.id = p_channel_id AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'CHANNEL_NOT_FOUND' USING ERRCODE = 'P1003'; END IF;
  IF p_employee_ids IS NULL THEN RETURN 0; END IF;
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

-- Archive == delete_chat_channel. Same signature (CREATE OR REPLACE is correct: no overload
-- risk). Derived from the live pg_get_functiondef body; only the authorization check and
-- search_path changed -- the general-channel guard and tenant-scoped delete are preserved.
CREATE OR REPLACE FUNCTION public.delete_chat_channel(channel_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $function$
BEGIN
  IF NOT public.has_access_action('channel.manage', 'company', NULL) THEN
    RAISE EXCEPTION 'Permission denied: channel.manage required to delete channels';
  END IF;

  IF EXISTS (SELECT 1 FROM public.chat_channels WHERE id = channel_id AND name = 'general') THEN
    RAISE EXCEPTION 'Cannot delete the general channel';
  END IF;

  DELETE FROM public.chat_channels WHERE id = channel_id AND tenant_id = (SELECT public.get_auth_tenant_id());
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_chat_channel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_chat_channel(uuid) TO authenticated;

-- Send: by channel_id, sender derived server-side, caller must pass the message-read rule,
-- announcement channels require channel.manage@company. Idempotent on (channel_id,
-- client_message_id) -- the unique index chat_messages_client_message_id_channel_id_key already
-- exists (20260817-era) and nothing else's ON CONFLICT relies on a different one (grepped).
CREATE FUNCTION public.p3_send_chat_message(
  p_channel_id uuid, p_content text, p_client_message_id uuid,
  p_attachment_url text DEFAULT NULL, p_attachment_name text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE v_tenant uuid; v_sender uuid; v_channel public.chat_channels%ROWTYPE; v_id uuid;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.can_access_tenant(v_tenant) OR NOT public.tenant_has_module('chat') THEN
    RAISE EXCEPTION 'CHAT_UNAVAILABLE' USING ERRCODE = 'P1002'; END IF;
  v_sender := public.get_my_employee_id();
  IF v_sender IS NULL THEN RAISE EXCEPTION 'CHAT_EMPLOYEE_REQUIRED' USING ERRCODE = 'P1003'; END IF;
  IF NULLIF(btrim(p_content), '') IS NULL THEN RAISE EXCEPTION 'CHAT_MESSAGE_EMPTY' USING ERRCODE = 'P1003'; END IF;
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_CHANNEL_NOT_FOUND' USING ERRCODE = 'P1003'; END IF;
  IF NOT public.p3_channel_audience(p_channel_id) THEN
    RAISE EXCEPTION 'CHAT_MESSAGE_DENIED' USING ERRCODE = 'P1003'; END IF;
  IF v_channel.is_announcement AND NOT public.has_access_action('channel.manage', 'company', NULL) THEN
    RAISE EXCEPTION 'CHAT_ANNOUNCEMENT_DENIED' USING ERRCODE = 'P1003'; END IF;
  INSERT INTO public.chat_messages(tenant_id, sender_id, channel, channel_id, content, attachment_url, attachment_name, client_message_id)
    VALUES (v_tenant, v_sender, v_channel.name, p_channel_id, p_content, p_attachment_url, p_attachment_name,
      COALESCE(p_client_message_id, gen_random_uuid()))
    ON CONFLICT (channel_id, client_message_id) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.chat_messages WHERE channel_id = p_channel_id AND client_message_id = p_client_message_id;
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.p3_send_chat_message(uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_send_chat_message(uuid, text, uuid, text, text) TO authenticated;

-- Edit: own message only, no moderate bypass.
CREATE FUNCTION public.p3_edit_chat_message(p_message_id uuid, p_content text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE v_tenant uuid; v_sender uuid;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  v_sender := public.get_my_employee_id();
  IF v_tenant IS NULL OR v_sender IS NULL THEN RAISE EXCEPTION 'CHAT_EMPLOYEE_REQUIRED' USING ERRCODE = 'P1003'; END IF;
  IF NULLIF(btrim(p_content), '') IS NULL THEN RAISE EXCEPTION 'CHAT_MESSAGE_EMPTY' USING ERRCODE = 'P1003'; END IF;
  UPDATE public.chat_messages SET content = btrim(p_content)
    WHERE id = p_message_id AND tenant_id = v_tenant AND sender_id = v_sender AND NOT is_deleted;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.p3_edit_chat_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_edit_chat_message(uuid, text) TO authenticated;

-- Soft-delete: own message, or an explicit channel-scoped message.moderate grant (never HR).
CREATE FUNCTION public.p3_delete_chat_message(p_message_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE v_tenant uuid; v_sender uuid; v_msg public.chat_messages%ROWTYPE;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CHAT_UNAVAILABLE' USING ERRCODE = 'P1002'; END IF;
  v_sender := public.get_my_employee_id();
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_msg.sender_id IS DISTINCT FROM v_sender AND NOT public.p3_channel_scope(v_msg.channel_id, 'message.moderate') THEN
    RAISE EXCEPTION 'CHAT_MESSAGE_MODERATE_DENIED' USING ERRCODE = 'P1003'; END IF;
  UPDATE public.chat_messages SET is_deleted = true WHERE id = p_message_id AND tenant_id = v_tenant;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.p3_delete_chat_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_delete_chat_message(uuid) TO authenticated;

-- Direct writes are no longer reachable: every mutation goes through the RPCs above.
REVOKE INSERT, UPDATE, DELETE ON public.chat_channels, public.chat_channel_members, public.chat_messages FROM authenticated;

-- ---------------------------------------------------------------------------------------------
-- T2-4: Connect. RESTRICTIVE tenant fence on posts and post_reactions (post_reactions previously
-- had only a PERMISSIVE one). Update/delete: author or feed.moderate@company. Insert: author =
-- self, feed.post. Reactions: insert/delete own only (existing unique (post_id, employee_id)
-- already makes a retry idempotent -- one row per employee per post). Dead posts/post_reactions
-- realtime subscribes in Connect.tsx are removed in the frontend change below; no trigger
-- publishes them and no realtime.channels pattern exists for either.
-- ---------------------------------------------------------------------------------------------
CREATE POLICY tenant_isolation ON public.posts AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY tenant_isolation ON public.post_reactions AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id());

DROP POLICY IF EXISTS posts_update ON public.posts;
CREATE POLICY posts_update ON public.posts FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id())
    AND (author_id = (SELECT public.get_my_employee_id()) OR (SELECT public.has_access_action('feed.moderate', 'company', NULL))))
  WITH CHECK (tenant_id = (SELECT public.get_auth_tenant_id())
    AND (author_id = (SELECT public.get_my_employee_id()) OR (SELECT public.has_access_action('feed.moderate', 'company', NULL))));

DROP POLICY IF EXISTS posts_delete ON public.posts;
CREATE POLICY posts_delete ON public.posts FOR DELETE TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id())
    AND (author_id = (SELECT public.get_my_employee_id()) OR (SELECT public.has_access_action('feed.moderate', 'company', NULL))));

DROP POLICY IF EXISTS posts_insert ON public.posts;
CREATE POLICY posts_insert ON public.posts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT public.get_auth_tenant_id())
    AND author_id = (SELECT public.get_my_employee_id())
    AND (SELECT public.has_access_action('feed.post', 'company', NULL))
    AND (type <> 'announcement' OR (SELECT public.has_access_action('feed.moderate', 'company', NULL))));

DROP POLICY IF EXISTS post_reactions_tenant_isolation ON public.post_reactions;
CREATE POLICY post_reactions_select ON public.post_reactions FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()));
CREATE POLICY post_reactions_insert ON public.post_reactions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT public.get_auth_tenant_id()) AND employee_id = (SELECT public.get_my_employee_id()));
CREATE POLICY post_reactions_update ON public.post_reactions FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()) AND employee_id = (SELECT public.get_my_employee_id()))
  WITH CHECK (tenant_id = (SELECT public.get_auth_tenant_id()) AND employee_id = (SELECT public.get_my_employee_id()));
CREATE POLICY post_reactions_delete ON public.post_reactions FOR DELETE TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()) AND employee_id = (SELECT public.get_my_employee_id()));

-- ---------------------------------------------------------------------------------------------
-- T2-5: HR reads all projects (A1: project.read@company, read-only). Every P3-02 manage RPC
-- still gates on p3_project_scope('project.manage'/'project.members.manage'), which HR never
-- satisfies without an actual project_memberships row -- read visibility only.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS projects_p302_read ON public.projects;
CREATE POLICY projects_p302_read ON public.projects FOR SELECT TO authenticated
  USING (public.p3_project_scope(id, 'project.read') OR public.has_access_action('project.read', 'company', NULL));

DROP POLICY IF EXISTS project_memberships_read ON public.project_memberships;
CREATE POLICY project_memberships_read ON public.project_memberships FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, NULL)
    OR public.p3_project_scope(project_id, 'project.members.manage')
    OR public.has_access_action('project.read', 'company', NULL));

-- ---------------------------------------------------------------------------------------------
-- Hygiene: one pg_proc row per touched/created name.
-- ---------------------------------------------------------------------------------------------
DO $verify$
DECLARE fn text; v_count integer;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'p3_channel_audience', 'p3_channel_metadata_visible', 'p3_channel_scope',
    'p3_realtime_topic_readable', 'p3_create_chat_channel', 'p3_update_chat_channel',
    'p3_set_channel_members', 'delete_chat_channel', 'p3_send_chat_message',
    'p3_edit_chat_message', 'p3_delete_chat_message'
  ] LOOP
    SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn;
    IF v_count <> 1 THEN RAISE EXCEPTION 'P3-03 Tier 2 function overload invariant failed: % (%)', fn, v_count; END IF;
  END LOOP;
END $verify$;
