-- P3-02b: advertise project:<id> and channel:<id> scopes in the capability summary, driven by
-- the same server predicate has_access_action already enforces (contracts.md v0.5 §3, §16 A1).
--
-- D1: one predicate. access_scope_allows(scope_type, scope_id, action) delegates to
-- p3_project_scope / p3_channel_scope (untouched) and adds the one fallback each does not cover:
--   - project: task.submit (an explicit member's self-submit action; p3_project_scope's branches
--     cover project.read and the project_manager manage actions only).
--   - channel: channel.read / message.send (p3_channel_scope hardcodes template_key =
--     'communication_moderator'; a plain 'employee' explicit member never matches it).
-- Both fallbacks re-derive current membership from server tables, never a caller-supplied claim.
--
-- D2: has_access_action(text,text,uuid) — exact signature preserved, CREATE OR REPLACE is safe.
-- Body is byte-identical to the live TB-M1M2 function (verified via pg_get_functiondef 2026-09-21)
-- with exactly one added OR branch, gated on p_scope_type IN ('project','channel') AND
-- p_scope_id IS NOT NULL. Every existing call site passes p_scope_id = NULL with a non-project/
-- channel scope_type, so the new branch is unreachable from any existing policy or RPC.
--
-- D3: get_my_capability_summary() — exact signature preserved. Body is byte-identical to the live
-- TB-M1M2 function (verified via pg_get_functiondef 2026-09-21) except the grants subquery, which
-- now UNIONs two more candidate sets (current project_memberships / chat_channel_members rows for
-- this membership's employee, crossed with the actions the caller's active templates hold at that
-- scope) and gates each candidate through access_scope_allows(...) -- so agreement between the
-- summary and has_access_action is structural, not coincidental. scopeId is included in the
-- returned object only for project/channel rows -- self/direct_reports/company/owner.transfer rows
-- keep exactly the two keys they have today (no `"scopeId": null`; AuthContext ~99-104 requires
-- the key to be entirely absent for those scopes).

CREATE FUNCTION public.access_scope_allows(p_scope_type text, p_scope_id uuid, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE p_scope_type
      WHEN 'project' THEN
        p_scope_id IS NOT NULL AND (
          COALESCE(public.p3_project_scope(p_scope_id, p_action), false)
          OR (
            p_action = 'task.submit'
            AND (SELECT public.is_project_member(p_scope_id, NULL))
            AND EXISTS (
              SELECT 1
              FROM public.tenant_memberships m
              JOIN public.employees e ON e.id = m.employee_id AND e.tenant_id = m.tenant_id
              JOIN public.membership_template_assignments a
                ON a.membership_id = m.id AND a.tenant_id = m.tenant_id AND a.is_active
              JOIN public.access_template_grants g
                ON g.template_key = a.template_key AND g.action = 'task.submit' AND g.scope_type = 'project'
              WHERE m.user_id = (SELECT auth.uid())
                AND m.tenant_id = (SELECT public.get_auth_tenant_id())
                AND m.status = 'active'
                AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
            )
          )
        )
      WHEN 'channel' THEN
        p_scope_id IS NOT NULL AND (
          COALESCE(public.p3_channel_scope(p_scope_id, p_action), false)
          OR (
            p_action IN ('channel.read', 'message.send')
            AND EXISTS (
              SELECT 1
              FROM public.chat_channel_members ccm
              JOIN public.chat_channels c ON c.id = ccm.channel_id AND c.tenant_id = (SELECT public.get_auth_tenant_id())
              JOIN public.tenant_memberships m
                ON m.tenant_id = c.tenant_id AND m.employee_id = ccm.employee_id
               AND m.user_id = (SELECT auth.uid()) AND m.status = 'active'
              JOIN public.employees e ON e.id = ccm.employee_id AND e.tenant_id = c.tenant_id
              JOIN public.membership_template_assignments a
                ON a.membership_id = m.id AND a.tenant_id = m.tenant_id AND a.is_active
              JOIN public.access_template_grants g
                ON g.template_key = a.template_key AND g.action = p_action AND g.scope_type = 'channel'
              WHERE ccm.channel_id = p_scope_id
                AND public.can_access_tenant(c.tenant_id)
                AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
            )
          )
        )
      ELSE false
    END;
$$;
REVOKE ALL ON FUNCTION public.access_scope_allows(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_scope_allows(text, uuid, text) TO authenticated;

-- D2: exact signature (text,text,uuid) preserved from migrations/20260912181000. Body derived
-- from pg_get_functiondef() on TB-M1M2, unchanged except the appended OR branch.
CREATE OR REPLACE FUNCTION public.has_access_action(
  p_action text,
  p_scope_type text,
  p_scope_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH current_membership AS (
    SELECT m.*
    FROM public.tenant_memberships m
    JOIN auth.users u ON u.id = m.user_id
    JOIN public.tenants t ON t.id = m.tenant_id
    WHERE m.user_id = (SELECT auth.uid())
      AND m.tenant_id = NULLIF(u.metadata->>'tenant_id','')::uuid
      AND m.status = 'active'
      AND t.status NOT IN ('suspended','cancelled')
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM current_membership m
      JOIN public.membership_template_assignments a
        ON a.membership_id = m.id AND a.tenant_id = m.tenant_id AND a.is_active
      JOIN public.access_templates template ON template.key = a.template_key
      JOIN public.access_template_grants grant_row ON grant_row.template_key = template.key
      LEFT JOIN public.employees employee
        ON employee.id = m.employee_id AND employee.tenant_id = m.tenant_id
      WHERE grant_row.action = p_action
        AND grant_row.scope_type = p_scope_type
        AND grant_row.scope_type NOT IN ('project','channel')
        AND p_scope_id IS NULL
        AND (
          NOT template.requires_employee
          OR (employee.id IS NOT NULL AND employee.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding'))
        )
    )
    OR (
      p_action = 'owner.transfer'
      AND p_scope_type = 'company'
      AND p_scope_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM current_membership m
        JOIN public.tenant_ownerships owner_row
          ON owner_row.membership_id = m.id
         AND owner_row.tenant_id = m.tenant_id
         AND owner_row.ended_at IS NULL
      )
    )
    OR (
      p_scope_type IN ('project','channel')
      AND p_scope_id IS NOT NULL
      AND public.access_scope_allows(p_scope_type, p_scope_id, p_action)
    );
$$;
REVOKE ALL ON FUNCTION public.has_access_action(text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_access_action(text,text,uuid) TO authenticated;

-- D3: exact signature (no params) preserved from migrations/20260912181000. Body derived from
-- pg_get_functiondef() on TB-M1M2; only the v_grants subquery changed (two more UNION branches).
CREATE OR REPLACE FUNCTION public.get_my_capability_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tenant_id uuid;
  v_membership public.tenant_memberships%ROWTYPE;
  v_employee public.employees%ROWTYPE;
  v_employee_active boolean := false;
  v_is_owner boolean := false;
  v_responsibilities text[] := ARRAY[]::text[];
  v_grants jsonb := '[]'::jsonb;
  v_enabled_modules jsonb := '[]'::jsonb;
  v_unavailable_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CAPABILITY_AUTHENTICATION_REQUIRED' USING ERRCODE = 'P1002';
  END IF;

  SELECT NULLIF(u.metadata->>'tenant_id','')::uuid INTO v_tenant_id
  FROM auth.users u WHERE u.id = v_uid;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'CAPABILITY_TENANT_UNAVAILABLE' USING ERRCODE = 'P1002';
  END IF;

  SELECT * INTO v_membership
  FROM public.tenant_memberships m
  WHERE m.tenant_id = v_tenant_id AND m.user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPABILITY_MEMBERSHIP_UNAVAILABLE' USING ERRCODE = 'P1002';
  END IF;

  IF v_membership.employee_id IS NOT NULL THEN
    SELECT * INTO v_employee
    FROM public.employees e
    WHERE e.id = v_membership.employee_id AND e.tenant_id = v_membership.tenant_id;
    v_employee_active := FOUND AND v_employee.status NOT IN (
      'inactive','terminated','draft','pending_hr_review','pending_onboarding'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tenant_ownerships owner_row
    WHERE owner_row.tenant_id = v_membership.tenant_id
      AND owner_row.membership_id = v_membership.id
      AND owner_row.ended_at IS NULL
  ) INTO v_is_owner;

  SELECT COALESCE(array_agg(eligible.template_key ORDER BY eligible.template_key), ARRAY[]::text[])
  INTO v_responsibilities
  FROM (
    SELECT DISTINCT a.template_key
    FROM public.membership_template_assignments a
    JOIN public.access_templates template ON template.key = a.template_key
    WHERE a.membership_id = v_membership.id
      AND a.is_active
      AND (NOT template.requires_employee OR v_employee_active)
  ) eligible;
  IF v_is_owner THEN
    v_responsibilities := array_prepend('owner', v_responsibilities);
  END IF;

  -- Candidates are the cross of (current server membership) x (actions the caller's active
  -- templates hold at that scope); access_scope_allows(...) is the filter, so a summary row can
  -- never disagree with has_access_action for the same (action, scopeType, scopeId).
  SELECT COALESCE(jsonb_agg(
    CASE WHEN allowed.scope_id IS NULL
      THEN jsonb_build_object('action', allowed.action, 'scopeType', allowed.scope_type)
      ELSE jsonb_build_object('action', allowed.action, 'scopeType', allowed.scope_type, 'scopeId', allowed.scope_id::text)
    END
    ORDER BY allowed.action, allowed.scope_type, allowed.scope_id
  ), '[]'::jsonb)
  INTO v_grants
  FROM (
    SELECT grant_row.action, grant_row.scope_type, NULL::uuid AS scope_id
    FROM public.membership_template_assignments a
    JOIN public.access_templates template ON template.key = a.template_key
    JOIN public.access_template_grants grant_row ON grant_row.template_key = a.template_key
    WHERE a.membership_id = v_membership.id
      AND a.is_active
      AND v_membership.status = 'active'
      AND grant_row.scope_type NOT IN ('project','channel')
      AND (NOT template.requires_employee OR v_employee_active)
    UNION
    SELECT 'owner.transfer', 'company', NULL::uuid
    WHERE v_is_owner AND v_membership.status = 'active'
    UNION
    SELECT g.action, 'project', pm.project_id
    FROM public.project_memberships pm
    JOIN public.membership_template_assignments a
      ON a.membership_id = v_membership.id AND a.tenant_id = v_membership.tenant_id AND a.is_active
    JOIN public.access_template_grants g ON g.template_key = a.template_key AND g.scope_type = 'project'
    WHERE v_membership.status = 'active'
      AND v_employee_active
      AND pm.tenant_id = v_membership.tenant_id
      AND pm.employee_id = v_membership.employee_id
      AND pm.is_active
      AND public.access_scope_allows('project', pm.project_id, g.action)
    UNION
    SELECT g.action, 'channel', ccm.channel_id
    FROM public.chat_channel_members ccm
    JOIN public.membership_template_assignments a
      ON a.membership_id = v_membership.id AND a.tenant_id = v_membership.tenant_id AND a.is_active
    JOIN public.access_template_grants g ON g.template_key = a.template_key AND g.scope_type = 'channel'
    WHERE v_membership.status = 'active'
      AND v_employee_active
      AND ccm.tenant_id = v_membership.tenant_id
      AND ccm.employee_id = v_membership.employee_id
      AND public.access_scope_allows('channel', ccm.channel_id, g.action)
  ) allowed;

  SELECT COALESCE(jsonb_agg(enabled.key ORDER BY enabled.sort_order, enabled.key), '[]'::jsonb)
  INTO v_enabled_modules
  FROM (
    SELECT module.key, module.sort_order
    FROM public.modules module
    LEFT JOIN public.tenant_modules tm
      ON tm.tenant_id = v_membership.tenant_id AND tm.module_key = module.key
    WHERE module.is_core OR tm.enabled IS TRUE
  ) enabled;

  v_unavailable_reason := CASE
    WHEN v_membership.status <> 'active' THEN 'membership_' || v_membership.status
    WHEN NOT (SELECT public.tenant_is_active(v_membership.tenant_id)) THEN 'tenant_inactive'
    WHEN v_membership.employee_id IS NULL
      AND NOT v_is_owner
      AND NOT EXISTS (
        SELECT 1
        FROM public.membership_template_assignments a
        JOIN public.access_templates template ON template.key = a.template_key
        WHERE a.membership_id = v_membership.id AND a.is_active AND NOT template.requires_employee
      )
      AND EXISTS (
        SELECT 1
        FROM public.membership_template_assignments a
        JOIN public.access_templates template ON template.key = a.template_key
        WHERE a.membership_id = v_membership.id AND a.is_active AND template.requires_employee
      ) THEN 'employee_association_required'
    WHEN v_membership.employee_id IS NOT NULL AND NOT v_employee_active
      AND NOT EXISTS (
        SELECT 1
        FROM public.membership_template_assignments a
        JOIN public.access_templates template ON template.key = a.template_key
        WHERE a.membership_id = v_membership.id AND a.is_active AND NOT template.requires_employee
      ) THEN 'employee_not_active'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'tenantId', v_membership.tenant_id::text,
    'membershipId', v_membership.id::text,
    'membershipStatus', v_membership.status,
    'employeeId', CASE WHEN v_membership.employee_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_membership.employee_id::text) END,
    'accessVersion', v_membership.access_version,
    'responsibilities', to_jsonb(v_responsibilities),
    'grants', v_grants,
    'enabledModules', v_enabled_modules,
    'unavailableReason', v_unavailable_reason,
    'issuedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'contractVersion', 'v0.5'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_capability_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_capability_summary() TO authenticated;

DO $verify$
DECLARE v_name text; v_count integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['access_scope_allows','has_access_action','get_my_capability_summary'] LOOP
    SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_name;
    IF v_count<>1 THEN RAISE EXCEPTION 'P3-02b overload count for %: %',v_name,v_count; END IF;
  END LOOP;
END $verify$;
