-- P1-02: named tenant membership, fixed access templates, invitations, revocation,
-- protected access audit and ownership lifecycle (contracts v0.5 §§2,4,5,8,13,14).
--
-- `id` is GENERATED rather than a DEFAULT because PostgreSQL forbids a DEFAULT expression
-- from referencing sibling columns. The generated expression is exactly the frozen P1-01
-- expression, is non-overridable, and is therefore stronger than a caller-overridable default.

CREATE TABLE public.access_templates (
  key text PRIMARY KEY,
  display_name text NOT NULL UNIQUE,
  requires_employee boolean NOT NULL,
  is_fixed boolean NOT NULL DEFAULT true CHECK (is_fixed),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.access_template_grants (
  template_key text NOT NULL REFERENCES public.access_templates(key) ON DELETE RESTRICT,
  action text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('self','direct_reports','company','project','channel')),
  PRIMARY KEY (template_key, action, scope_type)
);

INSERT INTO public.access_templates (key, display_name, requires_employee) VALUES
  ('company_admin', 'Company Admin', false),
  ('hr_admin', 'HR Admin', true),
  ('manager', 'Manager', true),
  ('employee', 'Employee', true),
  ('project_manager', 'Project Manager', true),
  ('communication_moderator', 'Communication Moderator', true);

INSERT INTO public.access_template_grants (template_key, action, scope_type) VALUES
  ('company_admin','membership.read','company'),
  ('company_admin','membership.invite','company'),
  ('company_admin','membership.revoke','company'),
  ('company_admin','membership.employee_associate','company'),
  ('company_admin','access.manage','company'),
  ('company_admin','org.read','company'),
  ('company_admin','org.manage','company'),
  ('company_admin','reporting.manage','company'),
  ('company_admin','designation.manage','company'),

  ('hr_admin','org.read','company'),
  ('hr_admin','employee.basic.read','company'),
  ('hr_admin','employee.sensitive.read','company'),
  ('hr_admin','employee.write','company'),
  ('hr_admin','employee.export','company'),
  ('hr_admin','attendance.read','company'),
  ('hr_admin','attendance.correct','company'),
  ('hr_admin','attendance.approve','company'),
  ('hr_admin','shift.read','company'),
  ('hr_admin','shift.manage','company'),
  ('hr_admin','device.manage','company'),
  ('hr_admin','leave.read','company'),
  ('hr_admin','leave.approve','company'),
  ('hr_admin','leave.configure','company'),
  ('hr_admin','policy.read','company'),
  ('hr_admin','policy.publish','company'),
  ('hr_admin','policy.configure','company'),
  ('hr_admin','task.assign','company'),
  ('hr_admin','task.review','company'),

  ('manager','employee.basic.read','direct_reports'),
  ('manager','attendance.read','direct_reports'),
  ('manager','attendance.approve','direct_reports'),
  ('manager','leave.read','direct_reports'),
  ('manager','task.assign','direct_reports'),
  ('manager','task.review','direct_reports'),
  ('manager','org.read','company'),
  ('manager','policy.read','company'),

  ('employee','employee.basic.read','self'),
  ('employee','employee.write','self'),
  ('employee','attendance.read','self'),
  ('employee','attendance.correction.request','self'),
  ('employee','shift.read','self'),
  ('employee','leave.read','self'),
  ('employee','leave.request','self'),
  ('employee','policy.read','self'),
  ('employee','policy.acknowledge','self'),
  ('employee','task.submit','self'),
  ('employee','org.read','company'),
  ('employee','policy.read','company'),
  ('employee','feed.read','company'),
  ('employee','feed.post','company'),
  ('employee','project.read','project'),
  ('employee','task.submit','project'),
  ('employee','channel.read','channel'),
  ('employee','message.send','channel'),

  ('project_manager','org.read','company'),
  ('project_manager','project.read','project'),
  ('project_manager','project.manage','project'),
  ('project_manager','project.members.manage','project'),
  ('project_manager','task.assign','project'),
  ('project_manager','task.review','project'),

  ('communication_moderator','feed.read','company'),
  ('communication_moderator','feed.post','company'),
  ('communication_moderator','feed.moderate','company'),
  ('communication_moderator','channel.read','channel'),
  ('communication_moderator','channel.manage','channel'),
  ('communication_moderator','message.send','channel'),
  ('communication_moderator','message.moderate','channel');

CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_id_id_key
  ON public.employees (tenant_id, id);

CREATE TABLE public.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  id uuid GENERATED ALWAYS AS (md5(tenant_id::text || ':' || user_id::text)::uuid) STORED PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  access_version bigint NOT NULL DEFAULT 1 CHECK (access_version > 0),
  employee_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  revoked_at timestamptz NULL,
  revoked_by uuid NULL,
  revoke_reason text NULL,
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id),
  CONSTRAINT tenant_memberships_employee_same_tenant
    FOREIGN KEY (tenant_id, employee_id) REFERENCES public.employees(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT tenant_memberships_revocation_shape CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND nullif(btrim(revoke_reason),'') IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
  )
);

CREATE UNIQUE INDEX tenant_memberships_one_active_account_per_tenant
  ON public.tenant_memberships (tenant_id, user_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX tenant_memberships_one_employee_association
  ON public.tenant_memberships (tenant_id, employee_id)
  WHERE employee_id IS NOT NULL AND status <> 'revoked';

CREATE TABLE public.membership_template_assignments (
  membership_id uuid NOT NULL REFERENCES public.tenant_memberships(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL,
  template_key text NOT NULL REFERENCES public.access_templates(key) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NULL,
  revoked_at timestamptz NULL,
  revoked_by uuid NULL,
  revoke_reason text NULL,
  PRIMARY KEY (membership_id, template_key),
  CONSTRAINT membership_template_same_tenant
    FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    (is_active AND revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (NOT is_active AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND nullif(btrim(revoke_reason),'') IS NOT NULL)
  )
);

CREATE TABLE public.tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  email text NOT NULL,
  token_digest text NOT NULL UNIQUE,
  template_key text NOT NULL REFERENCES public.access_templates(key) ON DELETE RESTRICT,
  scope_type text NOT NULL DEFAULT 'company' CHECK (scope_type = 'company'),
  employee_id uuid NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at timestamptz NOT NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  invited_by uuid NOT NULL,
  accepted_at timestamptz NULL,
  accepted_by uuid NULL,
  accepted_membership_id uuid NULL REFERENCES public.tenant_memberships(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT tenant_invitations_employee_same_tenant
    FOREIGN KEY (tenant_id, employee_id) REFERENCES public.employees(tenant_id, id) ON DELETE RESTRICT,
  CHECK (email = lower(btrim(email))),
  CHECK (expires_at > invited_at),
  CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND accepted_membership_id IS NOT NULL)
    OR (status <> 'accepted' AND accepted_at IS NULL AND accepted_by IS NULL AND accepted_membership_id IS NULL)
  )
);
CREATE UNIQUE INDEX tenant_invitations_one_pending_email_template
  ON public.tenant_invitations (tenant_id, lower(email), template_key)
  WHERE status = 'pending';

CREATE TABLE public.tenant_ownerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid NOT NULL,
  ended_at timestamptz NULL,
  ended_by uuid NULL,
  end_reason text NULL,
  CONSTRAINT tenant_ownership_membership_same_tenant
    FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    (ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL)
    OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND nullif(btrim(end_reason),'') IS NOT NULL)
  )
);
CREATE UNIQUE INDEX tenant_ownerships_one_active_owner
  ON public.tenant_ownerships (tenant_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX tenant_ownerships_one_active_membership
  ON public.tenant_ownerships (membership_id) WHERE ended_at IS NULL;

CREATE TABLE public.tenant_owner_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  source_membership_id uuid NOT NULL REFERENCES public.tenant_memberships(id) ON DELETE RESTRICT,
  target_membership_id uuid NOT NULL REFERENCES public.tenant_memberships(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','abandoned','expired')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  resolved_by uuid NULL,
  CHECK (source_membership_id <> target_membership_id),
  CHECK (expires_at > requested_at),
  CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);
CREATE UNIQUE INDEX tenant_owner_transfers_one_pending
  ON public.tenant_owner_transfers (tenant_id) WHERE status = 'pending';

-- Catalog rows are readable; all state changes are through the definer operations below.
GRANT SELECT ON public.access_templates, public.access_template_grants TO authenticated;
GRANT SELECT ON public.tenant_memberships, public.membership_template_assignments,
  public.tenant_invitations, public.tenant_ownerships, public.tenant_owner_transfers TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.access_templates, public.access_template_grants,
  public.tenant_memberships, public.membership_template_assignments, public.tenant_invitations,
  public.tenant_ownerships, public.tenant_owner_transfers FROM PUBLIC, anon, authenticated;

ALTER TABLE public.access_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_template_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_template_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_ownerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_owner_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_templates_authenticated_read ON public.access_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY access_template_grants_authenticated_read ON public.access_template_grants
  FOR SELECT TO authenticated USING (true);

-- Materialise the P1-01 compatibility state. This carries existing facts forward; it does not
-- infer Company Admin or ownership from HR metadata, job title, or employee association.
INSERT INTO public.tenant_memberships (
  tenant_id, user_id, employee_id, status, access_version, created_by, updated_by
)
SELECT
  (u.metadata->>'tenant_id')::uuid,
  u.id,
  e.id,
  'active',
  1,
  u.id,
  u.id
FROM auth.users u
JOIN public.tenants t ON t.id = NULLIF(u.metadata->>'tenant_id','')::uuid
LEFT JOIN LATERAL (
  SELECT employee.id
  FROM public.employees employee
  WHERE employee.tenant_id = t.id AND employee.user_id = u.id
  ORDER BY employee.updated_at DESC, employee.id
  LIMIT 1
) e ON true
WHERE NULLIF(u.metadata->>'tenant_id','') IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO public.membership_template_assignments (
  membership_id, tenant_id, template_key, assigned_by
)
SELECT m.id, m.tenant_id, 'employee', m.user_id
FROM public.tenant_memberships m
WHERE m.employee_id IS NOT NULL
ON CONFLICT (membership_id, template_key) DO NOTHING;

INSERT INTO public.membership_template_assignments (
  membership_id, tenant_id, template_key, assigned_by
)
SELECT DISTINCT m.id, m.tenant_id, 'hr_admin', m.user_id
FROM public.tenant_memberships m
JOIN auth.users u ON u.id = m.user_id
LEFT JOIN public.employee_roles r
  ON r.tenant_id = m.tenant_id
 AND r.employee_id = m.employee_id
 AND r.role = 'hr_admin'
 AND r.is_active
WHERE u.metadata->>'role' = 'hr' OR r.id IS NOT NULL
ON CONFLICT (membership_id, template_key) DO NOTHING;

INSERT INTO public.membership_template_assignments (
  membership_id, tenant_id, template_key, assigned_by
)
SELECT DISTINCT m.id, m.tenant_id, 'manager', m.user_id
FROM public.tenant_memberships m
JOIN public.employee_roles r
  ON r.tenant_id = m.tenant_id
 AND r.employee_id = m.employee_id
 AND r.role = 'manager'
 AND r.is_active
ON CONFLICT (membership_id, template_key) DO NOTHING;

-- Earlier migrations already recorded explicit owners in employee_roles. Preserve those recorded
-- designations, but deliberately do not manufacture owners for ownerless tenants.
INSERT INTO public.tenant_ownerships (tenant_id, membership_id, started_by)
SELECT DISTINCT ON (m.tenant_id) m.tenant_id, m.id, m.user_id
FROM public.tenant_memberships m
JOIN public.employee_roles r
  ON r.tenant_id = m.tenant_id
 AND r.employee_id = m.employee_id
 AND r.role = 'owner'
 AND r.is_active
WHERE m.status = 'active'
ORDER BY m.tenant_id, r.created_at, r.id
ON CONFLICT DO NOTHING;

-- Revocation becomes part of the common tenant fence. Compatibility is fail-closed only when a
-- materialised membership exists; the migration above materialises every current tenant account.
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NULLIF(u.metadata->>'tenant_id','')::uuid
  FROM auth.users u
  WHERE u.id = (SELECT auth.uid())
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships any_membership
        WHERE any_membership.user_id = u.id
          AND any_membership.tenant_id = NULLIF(u.metadata->>'tenant_id','')::uuid
      )
      OR EXISTS (
        SELECT 1 FROM public.tenant_memberships active_membership
        WHERE active_membership.user_id = u.id
          AND active_membership.tenant_id = NULLIF(u.metadata->>'tenant_id','')::uuid
          AND active_membership.status = 'active'
      )
    );
$$;

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
    );
$$;

REVOKE ALL ON FUNCTION public.has_access_action(text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_access_action(text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assert_access_action(
  p_action text,
  p_scope_type text,
  p_expected_access_version bigint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tenant_id uuid;
  v_membership public.tenant_memberships%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ACCESS_AUTHENTICATION_REQUIRED' USING ERRCODE = 'P1002';
  END IF;

  SELECT NULLIF(u.metadata->>'tenant_id','')::uuid INTO v_tenant_id
  FROM auth.users u WHERE u.id = v_uid;

  SELECT * INTO v_membership
  FROM public.tenant_memberships m
  WHERE m.user_id = v_uid AND m.tenant_id = v_tenant_id;

  IF NOT FOUND OR v_membership.status <> 'active' THEN
    RAISE EXCEPTION 'ACCESS_MEMBERSHIP_INACTIVE' USING ERRCODE = 'P1001';
  END IF;
  IF p_expected_access_version IS NOT NULL
     AND p_expected_access_version <> v_membership.access_version THEN
    RAISE EXCEPTION 'ACCESS_VERSION_STALE' USING ERRCODE = 'P1001';
  END IF;
  IF NOT (SELECT public.tenant_is_active(v_tenant_id)) THEN
    RAISE EXCEPTION 'ACCESS_TENANT_INACTIVE' USING ERRCODE = 'P1001';
  END IF;

  IF NOT public.has_access_action(p_action, p_scope_type, NULL) THEN
    IF v_membership.employee_id IS NULL AND EXISTS (
      SELECT 1
      FROM public.membership_template_assignments a
      JOIN public.access_templates template ON template.key = a.template_key
      JOIN public.access_template_grants grant_row ON grant_row.template_key = a.template_key
      WHERE a.membership_id = v_membership.id
        AND a.is_active
        AND template.requires_employee
        AND grant_row.action = p_action
        AND grant_row.scope_type = p_scope_type
    ) THEN
      RAISE EXCEPTION 'EMPLOYEE_ASSOCIATION_REQUIRED' USING ERRCODE = 'P1001';
    END IF;
    RAISE EXCEPTION 'ACCESS_ACTION_DENIED' USING ERRCODE = 'P1001';
  END IF;

  RETURN v_membership.id;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_access_action(text,text,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_access_action(text,text,bigint) TO authenticated;

-- Read policies use a RESTRICTIVE tenant fence plus separate permissive authorization. The
-- restricted predicate can never grant a row by itself.
CREATE POLICY tenant_memberships_tenant_fence ON public.tenant_memberships
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()));
CREATE POLICY tenant_memberships_authorized_read ON public.tenant_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.has_access_action('membership.read','company',NULL))
  );

CREATE POLICY membership_templates_tenant_fence ON public.membership_template_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()));
CREATE POLICY membership_templates_authorized_read ON public.membership_template_assignments
  FOR SELECT TO authenticated
  USING (
    membership_id = md5(tenant_id::text || (SELECT auth.uid())::text)::uuid
    OR (SELECT public.has_access_action('membership.read','company',NULL))
  );

CREATE POLICY invitations_tenant_fence ON public.tenant_invitations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()));
CREATE POLICY invitations_access_manager_read ON public.tenant_invitations
  FOR SELECT TO authenticated
  USING ((SELECT public.has_access_action('membership.read','company',NULL)));

CREATE POLICY ownerships_tenant_fence ON public.tenant_ownerships
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()));
CREATE POLICY ownerships_member_read ON public.tenant_ownerships
  FOR SELECT TO authenticated USING (true);

CREATE POLICY owner_transfers_tenant_fence ON public.tenant_owner_transfers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()));
CREATE POLICY owner_transfers_participant_read ON public.tenant_owner_transfers
  FOR SELECT TO authenticated
  USING (
    source_membership_id = md5(tenant_id::text || (SELECT auth.uid())::text)::uuid
    OR target_membership_id = md5(tenant_id::text || (SELECT auth.uid())::text)::uuid
  );

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
BEGIN
  IF p_action !~ '^access\.' THEN
    RAISE EXCEPTION 'ACCESS_AUDIT_ACTION_REQUIRED';
  END IF;
  SELECT m.id INTO v_actor_membership_id
  FROM public.tenant_memberships m
  WHERE m.tenant_id = p_tenant_id AND m.user_id = p_actor_user_id;

  INSERT INTO public.audit_logs (
    tenant_id, actor_id, actor_role, action, target_type, target_id, details
  ) VALUES (
    p_tenant_id,
    p_actor_user_id,
    'membership',
    p_action,
    p_target_type,
    p_target_id,
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
REVOKE ALL ON FUNCTION public.write_access_audit(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

-- Browsers may continue recording non-protected UX events, but cannot claim an access.* event.
-- Server definer writers use project_admin's existing admin_bypass policy.
DROP POLICY IF EXISTS "Users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert non-access audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    ((tenant_id = (SELECT public.get_auth_tenant_id())) OR (SELECT public.is_superadmin()))
    AND action !~ '^access\.'
  );
CREATE POLICY "Access managers can view tenant access audit" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.get_auth_tenant_id())
    AND action ~ '^access\.'
    AND (SELECT public.has_access_action('membership.read','company',NULL))
  );

-- employee_roles is a compatibility projection for employee-bound HR/manager templates. Its
-- writer is now the narrow server mutation path, not legacy is_hr().
DROP POLICY IF EXISTS employee_roles_hr_all ON public.employee_roles;
CREATE POLICY employee_roles_access_admin_all ON public.employee_roles
  FOR ALL TO authenticated
  USING (
    (SELECT public.has_access_action('access.manage','company',NULL))
    AND tenant_id = (SELECT public.get_auth_tenant_id())
  )
  WITH CHECK (
    (SELECT public.has_access_action('access.manage','company',NULL))
    AND tenant_id = (SELECT public.get_auth_tenant_id())
  );

-- Company Admin configuration mapping from §4. These grants do not make the caller HR and do not
-- open employees, attendance, leave, payroll, insurance, projects, or private communication.
CREATE POLICY org_units_company_admin_all ON public.org_units
  FOR ALL TO authenticated
  USING ((SELECT public.has_access_action('org.manage','company',NULL)))
  WITH CHECK ((SELECT public.has_access_action('org.manage','company',NULL)));
CREATE POLICY locations_company_admin_all ON public.locations
  FOR ALL TO authenticated
  USING ((SELECT public.has_access_action('org.manage','company',NULL)))
  WITH CHECK ((SELECT public.has_access_action('org.manage','company',NULL)));
CREATE POLICY employment_types_company_admin_all ON public.employment_types
  FOR ALL TO authenticated
  USING ((SELECT public.has_access_action('org.manage','company',NULL)))
  WITH CHECK ((SELECT public.has_access_action('org.manage','company',NULL)));
CREATE POLICY job_titles_company_admin_all ON public.job_titles
  FOR ALL TO authenticated
  USING ((SELECT public.has_access_action('designation.manage','company',NULL)))
  WITH CHECK ((SELECT public.has_access_action('designation.manage','company',NULL)));
CREATE POLICY reporting_relationships_company_admin_all ON public.employee_reporting_relationships
  FOR ALL TO authenticated
  USING ((SELECT public.has_access_action('reporting.manage','company',NULL)))
  WITH CHECK ((SELECT public.has_access_action('reporting.manage','company',NULL)));

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

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('action', allowed.action, 'scopeType', allowed.scope_type)
    ORDER BY allowed.action, allowed.scope_type
  ), '[]'::jsonb)
  INTO v_grants
  FROM (
    SELECT DISTINCT grant_row.action, grant_row.scope_type
    FROM public.membership_template_assignments a
    JOIN public.access_templates template ON template.key = a.template_key
    JOIN public.access_template_grants grant_row ON grant_row.template_key = a.template_key
    WHERE a.membership_id = v_membership.id
      AND a.is_active
      AND v_membership.status = 'active'
      AND grant_row.scope_type NOT IN ('project','channel')
      AND (NOT template.requires_employee OR v_employee_active)
    UNION
    SELECT 'owner.transfer', 'company'
    WHERE v_is_owner AND v_membership.status = 'active'
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

CREATE OR REPLACE FUNCTION public.list_tenant_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_membership uuid;
  v_tenant_id uuid;
BEGIN
  v_actor_membership := public.assert_access_action('membership.read','company',NULL);
  SELECT tenant_id INTO v_tenant_id FROM public.tenant_memberships WHERE id = v_actor_membership;

  RETURN jsonb_build_object(
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'userId', m.user_id,
        'email', u.email,
        'status', m.status,
        'accessVersion', m.access_version,
        'employeeId', m.employee_id,
        'templates', COALESCE((
          SELECT jsonb_agg(a.template_key ORDER BY a.template_key)
          FROM public.membership_template_assignments a
          WHERE a.membership_id = m.id AND a.is_active
        ), '[]'::jsonb),
        'isOwner', EXISTS (
          SELECT 1 FROM public.tenant_ownerships owner_row
          WHERE owner_row.membership_id = m.id AND owner_row.ended_at IS NULL
        )
      ) ORDER BY lower(u.email))
      FROM public.tenant_memberships m
      JOIN auth.users u ON u.id = m.user_id
      WHERE m.tenant_id = v_tenant_id
    ), '[]'::jsonb),
    'pendingInvitations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', invitation.id,
        'email', invitation.email,
        'templateKey', invitation.template_key,
        'status', invitation.status,
        'expiresAt', invitation.expires_at
      ) ORDER BY invitation.invited_at DESC)
      FROM public.tenant_invitations invitation
      WHERE invitation.tenant_id = v_tenant_id AND invitation.status = 'pending'
    ), '[]'::jsonb),
    'surfaces', jsonb_build_object(
      'databaseRpc', 'enabled',
      'edgeFunctions', 'enabled',
      'privateStorage', 'incomplete',
      'realtime', 'incomplete'
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.list_tenant_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_tenant_access(
  p_operation text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_expected_access_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tenant_id uuid;
  v_actor public.tenant_memberships%ROWTYPE;
  v_target public.tenant_memberships%ROWTYPE;
  v_target_id uuid;
  v_template text;
  v_reason text;
  v_email text;
  v_token text;
  v_invitation public.tenant_invitations%ROWTYPE;
  v_transfer public.tenant_owner_transfers%ROWTYPE;
  v_employee_id uuid;
  v_is_owner boolean;
  v_correlation_id uuid := gen_random_uuid();
  v_prior jsonb;
  v_new jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ACCESS_AUTHENTICATION_REQUIRED' USING ERRCODE = 'P1002';
  END IF;
  SELECT NULLIF(u.metadata->>'tenant_id','')::uuid INTO v_tenant_id
  FROM auth.users u WHERE u.id = v_uid;

  SELECT * INTO v_actor
  FROM public.tenant_memberships m
  WHERE m.user_id = v_uid AND m.tenant_id = v_tenant_id
  FOR UPDATE;
  IF NOT FOUND OR v_actor.status <> 'active' THEN
    RAISE EXCEPTION 'ACCESS_MEMBERSHIP_INACTIVE' USING ERRCODE = 'P1001';
  END IF;
  IF p_expected_access_version IS NOT NULL
     AND p_expected_access_version <> v_actor.access_version THEN
    RAISE EXCEPTION 'ACCESS_VERSION_STALE' USING ERRCODE = 'P1001';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_ownerships owner_row
    WHERE owner_row.tenant_id = v_actor.tenant_id
      AND owner_row.membership_id = v_actor.id
      AND owner_row.ended_at IS NULL
  ) INTO v_is_owner;
  IF NOT v_is_owner AND NOT public.has_access_action('access.manage','company',NULL) THEN
    RAISE EXCEPTION 'ACCESS_MANAGEMENT_DENIED' USING ERRCODE = 'P1001';
  END IF;

  IF p_operation = 'invitation.create' THEN
    v_email := lower(btrim(COALESCE(p_payload->>'email','')));
    v_template := p_payload->>'templateKey';
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'INVITATION_EMAIL_INVALID' USING ERRCODE = 'P1001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.access_templates WHERE key = v_template) THEN
      RAISE EXCEPTION 'ACCESS_TEMPLATE_UNKNOWN' USING ERRCODE = 'P1001';
    END IF;
    IF COALESCE(p_payload->>'scopeType','company') <> 'company' THEN
      RAISE EXCEPTION 'ACCESS_SCOPE_UNSUPPORTED' USING ERRCODE = 'P1001';
    END IF;
    IF NULLIF(p_payload->>'employeeId','') IS NOT NULL THEN
      v_employee_id := (p_payload->>'employeeId')::uuid;
      IF NOT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = v_employee_id AND e.tenant_id = v_actor.tenant_id
      ) THEN
        RAISE EXCEPTION 'INVITATION_EMPLOYEE_TENANT_MISMATCH' USING ERRCODE = 'P1001';
      END IF;
    END IF;

    UPDATE public.tenant_invitations
    SET status = 'revoked'
    WHERE tenant_id = v_actor.tenant_id
      AND lower(email) = v_email
      AND template_key = v_template
      AND status = 'pending';

    v_token := encode(gen_random_bytes(32), 'hex');
    INSERT INTO public.tenant_invitations (
      tenant_id, email, token_digest, template_key, employee_id, expires_at, invited_by
    ) VALUES (
      v_actor.tenant_id,
      v_email,
      encode(digest(v_token,'sha256'),'hex'),
      v_template,
      v_employee_id,
      clock_timestamp() + make_interval(hours => LEAST(GREATEST(COALESCE((p_payload->>'expiresInHours')::int,24),1),168)),
      v_uid
    ) RETURNING * INTO v_invitation;

    PERFORM public.write_access_audit(
      v_actor.tenant_id, v_uid, 'access.invitation_created', 'tenant_invitation',
      v_invitation.id::text,
      jsonb_build_object(
        'subject_email', v_email,
        'template_key', v_template,
        'scope_type', 'company',
        'employee_id', v_employee_id,
        'expires_at', v_invitation.expires_at,
        'correlation_id', v_invitation.correlation_id,
        'prior', NULL,
        'new', jsonb_build_object('status','pending')
      )
    );
    RETURN jsonb_build_object(
      'invitationId', v_invitation.id,
      'token', v_token,
      'expiresAt', v_invitation.expires_at,
      'correlationId', v_invitation.correlation_id
    );
  END IF;

  IF p_operation IN ('membership.revoke','membership.suspend','membership.activate',
                     'template.assign','template.revoke','employee.associate') THEN
    v_target_id := NULLIF(p_payload->>'membershipId','')::uuid;
    SELECT * INTO v_target
    FROM public.tenant_memberships m
    WHERE m.id = v_target_id AND m.tenant_id = v_actor.tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ACCESS_TARGET_NOT_FOUND' USING ERRCODE = 'P1001';
    END IF;
    IF v_target.id = v_actor.id THEN
      RAISE EXCEPTION 'ACCESS_SELF_ESCALATION_DENIED' USING ERRCODE = 'P1001';
    END IF;
  END IF;

  IF p_operation = 'membership.revoke' THEN
    v_reason := btrim(COALESCE(p_payload->>'reason',''));
    IF v_reason = '' THEN
      RAISE EXCEPTION 'ACCESS_REASON_REQUIRED' USING ERRCODE = 'P1001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tenant_ownerships owner_row
      WHERE owner_row.membership_id = v_target.id AND owner_row.ended_at IS NULL
    ) THEN
      RAISE EXCEPTION 'ACCESS_ACTIVE_OWNER_PROTECTED' USING ERRCODE = 'P1001';
    END IF;
    IF v_target.status = 'revoked' THEN
      RETURN jsonb_build_object(
        'membershipId', v_target.id,
        'status', v_target.status,
        'accessVersion', v_target.access_version,
        'idempotent', true
      );
    END IF;
    v_prior := jsonb_build_object('status',v_target.status,'accessVersion',v_target.access_version);
    UPDATE public.tenant_memberships
    SET status = 'revoked', access_version = access_version + 1,
        updated_at = clock_timestamp(), updated_by = v_uid,
        revoked_at = clock_timestamp(), revoked_by = v_uid, revoke_reason = v_reason
    WHERE id = v_target.id
    RETURNING * INTO v_target;
    UPDATE public.membership_template_assignments
    SET is_active = false, revoked_at = clock_timestamp(), revoked_by = v_uid, revoke_reason = v_reason
    WHERE membership_id = v_target.id AND is_active;
    IF v_target.employee_id IS NOT NULL THEN
      UPDATE public.employee_roles
      SET is_active = false, updated_at = clock_timestamp()
      WHERE tenant_id = v_target.tenant_id AND employee_id = v_target.employee_id AND is_active;
    END IF;
    UPDATE auth.users
    SET metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), '{role}', '"employee"'::jsonb, true),
        updated_at = clock_timestamp()
    WHERE id = v_target.user_id AND metadata->>'role' = 'hr';
    v_new := jsonb_build_object('status',v_target.status,'accessVersion',v_target.access_version);
    PERFORM public.write_access_audit(
      v_actor.tenant_id, v_uid, 'access.membership_revoked', 'tenant_membership', v_target.id::text,
      jsonb_build_object('subject_user_id',v_target.user_id,'prior',v_prior,'new',v_new,
                         'reason',v_reason,'correlation_id',v_correlation_id)
    );
    RETURN v_new || jsonb_build_object('membershipId',v_target.id,'correlationId',v_correlation_id);
  END IF;

  IF p_operation = 'membership.suspend' THEN
    v_reason := btrim(COALESCE(p_payload->>'reason',''));
    IF v_reason = '' THEN RAISE EXCEPTION 'ACCESS_REASON_REQUIRED' USING ERRCODE = 'P1001'; END IF;
    IF v_target.status = 'suspended' THEN
      RETURN jsonb_build_object('membershipId',v_target.id,'status','suspended','accessVersion',v_target.access_version,'idempotent',true);
    END IF;
    IF v_target.status = 'revoked' THEN RAISE EXCEPTION 'ACCESS_REVOKED_FINAL' USING ERRCODE = 'P1001'; END IF;
    IF EXISTS (SELECT 1 FROM public.tenant_ownerships o WHERE o.membership_id=v_target.id AND o.ended_at IS NULL) THEN
      RAISE EXCEPTION 'ACCESS_ACTIVE_OWNER_PROTECTED' USING ERRCODE = 'P1001';
    END IF;
    v_prior := jsonb_build_object('status',v_target.status,'accessVersion',v_target.access_version);
    UPDATE public.tenant_memberships
    SET status='suspended', access_version=access_version+1, updated_at=clock_timestamp(), updated_by=v_uid
    WHERE id=v_target.id RETURNING * INTO v_target;
    UPDATE public.membership_template_assignments
    SET is_active=false, revoked_at=clock_timestamp(), revoked_by=v_uid, revoke_reason=v_reason
    WHERE membership_id=v_target.id AND is_active;
    IF v_target.employee_id IS NOT NULL THEN
      UPDATE public.employee_roles SET is_active=false, updated_at=clock_timestamp()
      WHERE tenant_id=v_target.tenant_id AND employee_id=v_target.employee_id AND is_active;
    END IF;
    UPDATE auth.users
    SET metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{role}','"employee"'::jsonb,true), updated_at=clock_timestamp()
    WHERE id=v_target.user_id AND metadata->>'role'='hr';
    v_new := jsonb_build_object('status',v_target.status,'accessVersion',v_target.access_version);
    PERFORM public.write_access_audit(v_actor.tenant_id,v_uid,'access.membership_suspended','tenant_membership',v_target.id::text,
      jsonb_build_object('subject_user_id',v_target.user_id,'prior',v_prior,'new',v_new,'reason',v_reason,'correlation_id',v_correlation_id));
    RETURN v_new || jsonb_build_object('membershipId',v_target.id,'correlationId',v_correlation_id);
  END IF;

  IF p_operation = 'membership.activate' THEN
    IF v_target.status = 'active' THEN
      RETURN jsonb_build_object('membershipId',v_target.id,'status','active','accessVersion',v_target.access_version,'idempotent',true);
    END IF;
    IF v_target.status = 'revoked' THEN RAISE EXCEPTION 'ACCESS_REVOKED_FINAL' USING ERRCODE = 'P1001'; END IF;
    v_prior := jsonb_build_object('status',v_target.status,'accessVersion',v_target.access_version);
    UPDATE public.tenant_memberships
    SET status='active', access_version=access_version+1, updated_at=clock_timestamp(), updated_by=v_uid
    WHERE id=v_target.id RETURNING * INTO v_target;
    v_new := jsonb_build_object('status',v_target.status,'accessVersion',v_target.access_version);
    PERFORM public.write_access_audit(v_actor.tenant_id,v_uid,'access.membership_activated','tenant_membership',v_target.id::text,
      jsonb_build_object('subject_user_id',v_target.user_id,'prior',v_prior,'new',v_new,'reason',COALESCE(p_payload->>'reason','reactivated'),'correlation_id',v_correlation_id));
    RETURN v_new || jsonb_build_object('membershipId',v_target.id,'correlationId',v_correlation_id);
  END IF;

  IF p_operation = 'template.assign' THEN
    v_template := p_payload->>'templateKey';
    IF NOT EXISTS (SELECT 1 FROM public.access_templates WHERE key=v_template) THEN
      RAISE EXCEPTION 'ACCESS_TEMPLATE_UNKNOWN' USING ERRCODE = 'P1001';
    END IF;
    IF v_target.status <> 'active' THEN RAISE EXCEPTION 'ACCESS_TARGET_INACTIVE' USING ERRCODE = 'P1001'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.membership_template_assignments a
      WHERE a.membership_id=v_target.id AND a.template_key=v_template AND a.is_active
    ) THEN
      RETURN jsonb_build_object('membershipId',v_target.id,'templateKey',v_template,'accessVersion',v_target.access_version,'idempotent',true);
    END IF;
    INSERT INTO public.membership_template_assignments (
      membership_id,tenant_id,template_key,is_active,assigned_at,assigned_by,revoked_at,revoked_by,revoke_reason
    ) VALUES (v_target.id,v_target.tenant_id,v_template,true,clock_timestamp(),v_uid,NULL,NULL,NULL)
    ON CONFLICT (membership_id,template_key) DO UPDATE SET
      is_active=true, assigned_at=clock_timestamp(), assigned_by=v_uid,
      revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL;
    UPDATE public.tenant_memberships SET access_version=access_version+1,updated_at=clock_timestamp(),updated_by=v_uid
    WHERE id=v_target.id RETURNING * INTO v_target;
    IF v_target.employee_id IS NOT NULL AND v_template IN ('hr_admin','manager') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles r
        WHERE r.tenant_id=v_target.tenant_id AND r.employee_id=v_target.employee_id
          AND r.role=v_template AND r.scope_type='tenant' AND r.is_active
      ) THEN
        INSERT INTO public.employee_roles (tenant_id,employee_id,role,scope_type,is_active)
        VALUES (v_target.tenant_id,v_target.employee_id,v_template,'tenant',true);
      END IF;
    END IF;
    PERFORM public.write_access_audit(v_actor.tenant_id,v_uid,'access.template_assigned','tenant_membership',v_target.id::text,
      jsonb_build_object('subject_user_id',v_target.user_id,'prior',jsonb_build_object('template',v_template,'active',false),
                         'new',jsonb_build_object('template',v_template,'active',true,'accessVersion',v_target.access_version),
                         'reason',COALESCE(p_payload->>'reason','assigned'),'correlation_id',v_correlation_id));
    RETURN jsonb_build_object('membershipId',v_target.id,'templateKey',v_template,'accessVersion',v_target.access_version,'correlationId',v_correlation_id);
  END IF;

  IF p_operation = 'template.revoke' THEN
    v_template := p_payload->>'templateKey';
    v_reason := btrim(COALESCE(p_payload->>'reason',''));
    IF v_reason='' THEN RAISE EXCEPTION 'ACCESS_REASON_REQUIRED' USING ERRCODE='P1001'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.membership_template_assignments a WHERE a.membership_id=v_target.id AND a.template_key=v_template AND a.is_active) THEN
      RETURN jsonb_build_object('membershipId',v_target.id,'templateKey',v_template,'accessVersion',v_target.access_version,'idempotent',true);
    END IF;
    UPDATE public.membership_template_assignments
    SET is_active=false,revoked_at=clock_timestamp(),revoked_by=v_uid,revoke_reason=v_reason
    WHERE membership_id=v_target.id AND template_key=v_template AND is_active;
    UPDATE public.tenant_memberships SET access_version=access_version+1,updated_at=clock_timestamp(),updated_by=v_uid
    WHERE id=v_target.id RETURNING * INTO v_target;
    IF v_target.employee_id IS NOT NULL AND v_template IN ('hr_admin','manager') THEN
      UPDATE public.employee_roles SET is_active=false,updated_at=clock_timestamp()
      WHERE tenant_id=v_target.tenant_id AND employee_id=v_target.employee_id AND role=v_template AND is_active;
    END IF;
    PERFORM public.write_access_audit(v_actor.tenant_id,v_uid,'access.template_revoked','tenant_membership',v_target.id::text,
      jsonb_build_object('subject_user_id',v_target.user_id,'prior',jsonb_build_object('template',v_template,'active',true),
                         'new',jsonb_build_object('template',v_template,'active',false,'accessVersion',v_target.access_version),
                         'reason',v_reason,'correlation_id',v_correlation_id));
    RETURN jsonb_build_object('membershipId',v_target.id,'templateKey',v_template,'accessVersion',v_target.access_version,'correlationId',v_correlation_id);
  END IF;

  IF p_operation = 'employee.associate' THEN
    v_employee_id := NULLIF(p_payload->>'employeeId','')::uuid;
    IF v_employee_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id=v_employee_id AND e.tenant_id=v_actor.tenant_id AND e.user_id IS NULL
    ) THEN
      RAISE EXCEPTION 'EMPLOYEE_ASSOCIATION_TARGET_INVALID' USING ERRCODE='P1001';
    END IF;
    IF v_target.employee_id IS NOT NULL THEN RAISE EXCEPTION 'EMPLOYEE_ASSOCIATION_ALREADY_SET' USING ERRCODE='P1001'; END IF;
    UPDATE public.employees SET user_id=v_target.user_id,updated_at=clock_timestamp() WHERE id=v_employee_id;
    UPDATE public.tenant_memberships
    SET employee_id=v_employee_id,access_version=access_version+1,updated_at=clock_timestamp(),updated_by=v_uid
    WHERE id=v_target.id RETURNING * INTO v_target;
    INSERT INTO public.employee_roles (tenant_id,employee_id,role,scope_type,is_active)
    SELECT v_target.tenant_id,v_employee_id,a.template_key,'tenant',true
    FROM public.membership_template_assignments a
    WHERE a.membership_id=v_target.id AND a.is_active AND a.template_key IN ('hr_admin','manager')
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_roles r
        WHERE r.tenant_id=v_target.tenant_id AND r.employee_id=v_employee_id
          AND r.role=a.template_key AND r.scope_type='tenant' AND r.is_active
      );
    PERFORM public.write_access_audit(v_actor.tenant_id,v_uid,'access.employee_associated','tenant_membership',v_target.id::text,
      jsonb_build_object('subject_user_id',v_target.user_id,'prior',jsonb_build_object('employeeId',NULL),
                         'new',jsonb_build_object('employeeId',v_employee_id,'accessVersion',v_target.access_version),
                         'reason',COALESCE(p_payload->>'reason','associated'),'correlation_id',v_correlation_id));
    RETURN jsonb_build_object('membershipId',v_target.id,'employeeId',v_employee_id,'accessVersion',v_target.access_version,'correlationId',v_correlation_id);
  END IF;

  IF p_operation = 'owner.transfer.begin' THEN
    IF NOT v_is_owner THEN RAISE EXCEPTION 'OWNER_AUTHORITY_REQUIRED' USING ERRCODE='P1001'; END IF;
    v_target_id := NULLIF(p_payload->>'targetMembershipId','')::uuid;
    SELECT * INTO v_target FROM public.tenant_memberships
    WHERE id=v_target_id AND tenant_id=v_actor.tenant_id AND status='active' FOR UPDATE;
    IF NOT FOUND OR v_target.id=v_actor.id THEN RAISE EXCEPTION 'OWNER_TRANSFER_TARGET_INVALID' USING ERRCODE='P1001'; END IF;
    SELECT * INTO v_transfer FROM public.tenant_owner_transfers
    WHERE tenant_id=v_actor.tenant_id AND status='pending' FOR UPDATE;
    IF FOUND THEN
      IF v_transfer.target_membership_id=v_target.id AND v_transfer.expires_at>clock_timestamp() THEN
        RETURN jsonb_build_object('transferId',v_transfer.id,'status',v_transfer.status,'expiresAt',v_transfer.expires_at,'idempotent',true);
      END IF;
      RAISE EXCEPTION 'OWNER_TRANSFER_ALREADY_PENDING' USING ERRCODE='P1001';
    END IF;
    INSERT INTO public.tenant_owner_transfers (
      tenant_id,source_membership_id,target_membership_id,requested_by,expires_at
    ) VALUES (v_actor.tenant_id,v_actor.id,v_target.id,v_uid,clock_timestamp()+interval '24 hours')
    RETURNING * INTO v_transfer;
    PERFORM public.write_access_audit(v_actor.tenant_id,v_uid,'access.owner_transfer_requested','tenant_owner_transfer',v_transfer.id::text,
      jsonb_build_object('subject_user_id',v_target.user_id,'prior',jsonb_build_object('ownerMembershipId',v_actor.id),
                         'new',jsonb_build_object('pendingTargetMembershipId',v_target.id),
                         'reason',COALESCE(p_payload->>'reason','transfer requested'),'correlation_id',v_correlation_id));
    RETURN jsonb_build_object('transferId',v_transfer.id,'status',v_transfer.status,'expiresAt',v_transfer.expires_at,'correlationId',v_correlation_id);
  END IF;

  IF p_operation = 'owner.transfer.abandon' THEN
    IF NOT v_is_owner THEN RAISE EXCEPTION 'OWNER_AUTHORITY_REQUIRED' USING ERRCODE='P1001'; END IF;
    v_target_id := NULLIF(p_payload->>'transferId','')::uuid;
    SELECT * INTO v_transfer FROM public.tenant_owner_transfers
    WHERE id=v_target_id AND tenant_id=v_actor.tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_TRANSFER_NOT_FOUND' USING ERRCODE='P1001'; END IF;
    IF v_transfer.status='abandoned' THEN RETURN jsonb_build_object('transferId',v_transfer.id,'status','abandoned','idempotent',true); END IF;
    IF v_transfer.status<>'pending' THEN RAISE EXCEPTION 'OWNER_TRANSFER_NOT_PENDING' USING ERRCODE='P1001'; END IF;
    UPDATE public.tenant_owner_transfers
    SET status='abandoned',resolved_at=clock_timestamp(),resolved_by=v_uid WHERE id=v_transfer.id
    RETURNING * INTO v_transfer;
    PERFORM public.write_access_audit(v_actor.tenant_id,v_uid,'access.owner_transfer_abandoned','tenant_owner_transfer',v_transfer.id::text,
      jsonb_build_object('prior',jsonb_build_object('status','pending'),'new',jsonb_build_object('status','abandoned'),
                         'reason',COALESCE(p_payload->>'reason','abandoned'),'correlation_id',v_correlation_id));
    RETURN jsonb_build_object('transferId',v_transfer.id,'status',v_transfer.status,'correlationId',v_correlation_id);
  END IF;

  RAISE EXCEPTION 'ACCESS_OPERATION_UNKNOWN' USING ERRCODE = 'P1001';
END;
$$;
REVOKE ALL ON FUNCTION public.manage_tenant_access(text,jsonb,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_tenant_access(text,jsonb,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_tenant_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_user auth.users%ROWTYPE;
  v_invitation public.tenant_invitations%ROWTYPE;
  v_membership public.tenant_memberships%ROWTYPE;
  v_existing public.tenant_memberships%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'INVITATION_AUTHENTICATION_REQUIRED' USING ERRCODE='P1002'; END IF;
  IF length(COALESCE(p_token,'')) < 32 THEN RAISE EXCEPTION 'INVITATION_TOKEN_INVALID' USING ERRCODE='P1001'; END IF;

  SELECT * INTO v_user FROM auth.users WHERE id=v_uid;
  SELECT * INTO v_invitation
  FROM public.tenant_invitations invitation
  WHERE invitation.token_digest=encode(digest(p_token,'sha256'),'hex')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_TOKEN_INVALID' USING ERRCODE='P1001'; END IF;
  IF v_invitation.status <> 'pending' THEN RAISE EXCEPTION 'INVITATION_TOKEN_ALREADY_USED' USING ERRCODE='P1001'; END IF;
  IF v_invitation.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'INVITATION_TOKEN_EXPIRED' USING ERRCODE='P1001'; END IF;
  IF lower(v_user.email) <> v_invitation.email THEN RAISE EXCEPTION 'INVITATION_ACCOUNT_MISMATCH' USING ERRCODE='P1001'; END IF;
  IF NULLIF(v_user.metadata->>'tenant_id','') IS NOT NULL
     AND NULLIF(v_user.metadata->>'tenant_id','')::uuid <> v_invitation.tenant_id THEN
    RAISE EXCEPTION 'INVITATION_TENANT_MISMATCH' USING ERRCODE='P1001';
  END IF;

  SELECT * INTO v_existing FROM public.tenant_memberships m
  WHERE m.tenant_id=v_invitation.tenant_id AND m.user_id=v_uid
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.status <> 'active' THEN RAISE EXCEPTION 'INVITATION_MEMBERSHIP_INACTIVE' USING ERRCODE='P1001'; END IF;
    IF v_existing.employee_id IS NOT NULL
       AND v_invitation.employee_id IS DISTINCT FROM v_existing.employee_id THEN
      RAISE EXCEPTION 'INVITATION_EMPLOYEE_ASSOCIATION_CONFLICT' USING ERRCODE='P1001';
    END IF;
    IF v_existing.employee_id IS NULL AND v_invitation.employee_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.employees e WHERE e.id=v_invitation.employee_id AND e.user_id IS NOT NULL AND e.user_id<>v_uid) THEN
        RAISE EXCEPTION 'INVITATION_EMPLOYEE_ALREADY_ASSOCIATED' USING ERRCODE='P1001';
      END IF;
      UPDATE public.employees SET user_id=v_uid,updated_at=clock_timestamp() WHERE id=v_invitation.employee_id;
      UPDATE public.tenant_memberships SET employee_id=v_invitation.employee_id WHERE id=v_existing.id;
    END IF;
    v_membership := v_existing;
  ELSE
    IF v_invitation.employee_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id=v_invitation.employee_id AND e.user_id IS NOT NULL AND e.user_id<>v_uid
    ) THEN
      RAISE EXCEPTION 'INVITATION_EMPLOYEE_ALREADY_ASSOCIATED' USING ERRCODE='P1001';
    END IF;
    INSERT INTO public.tenant_memberships (
      tenant_id,user_id,employee_id,status,access_version,created_by,updated_by
    ) VALUES (
      v_invitation.tenant_id,v_uid,v_invitation.employee_id,'active',1,v_invitation.invited_by,v_invitation.invited_by
    ) RETURNING * INTO v_membership;
    IF v_invitation.employee_id IS NOT NULL THEN
      UPDATE public.employees SET user_id=v_uid,updated_at=clock_timestamp() WHERE id=v_invitation.employee_id;
    END IF;
  END IF;

  INSERT INTO public.membership_template_assignments (
    membership_id,tenant_id,template_key,is_active,assigned_at,assigned_by
  ) VALUES (
    v_membership.id,v_membership.tenant_id,v_invitation.template_key,true,clock_timestamp(),v_invitation.invited_by
  )
  ON CONFLICT (membership_id,template_key) DO UPDATE SET
    is_active=true,assigned_at=clock_timestamp(),assigned_by=EXCLUDED.assigned_by,
    revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.tenant_memberships
    SET access_version=access_version+1,updated_at=clock_timestamp(),updated_by=v_invitation.invited_by
    WHERE id=v_membership.id RETURNING * INTO v_membership;
  END IF;

  IF v_membership.employee_id IS NOT NULL AND v_invitation.template_key IN ('hr_admin','manager') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.employee_roles r
      WHERE r.tenant_id=v_membership.tenant_id AND r.employee_id=v_membership.employee_id
        AND r.role=v_invitation.template_key AND r.scope_type='tenant' AND r.is_active
    ) THEN
      INSERT INTO public.employee_roles (tenant_id,employee_id,role,scope_type,is_active)
      VALUES (v_membership.tenant_id,v_membership.employee_id,v_invitation.template_key,'tenant',true);
    END IF;
  END IF;

  UPDATE auth.users
  SET metadata = jsonb_set(
      jsonb_set(COALESCE(metadata,'{}'::jsonb),'{tenant_id}',to_jsonb(v_invitation.tenant_id::text),true),
      '{role}',
      CASE WHEN COALESCE(metadata->>'role','') IN ('superadmin','admin') THEN to_jsonb(metadata->>'role') ELSE '"employee"'::jsonb END,
      true
    ),
    updated_at=clock_timestamp()
  WHERE id=v_uid;

  UPDATE public.tenant_invitations
  SET status='accepted',accepted_at=clock_timestamp(),accepted_by=v_uid,accepted_membership_id=v_membership.id
  WHERE id=v_invitation.id;

  PERFORM public.write_access_audit(v_invitation.tenant_id,v_uid,'access.invitation_accepted','tenant_membership',v_membership.id::text,
    jsonb_build_object('subject_user_id',v_uid,'invitation_id',v_invitation.id,'template_key',v_invitation.template_key,
                       'scope_type',v_invitation.scope_type,'prior',NULL,
                       'new',jsonb_build_object('status','active','accessVersion',v_membership.access_version),
                       'reason','invitation accepted','correlation_id',v_correlation_id));
  RETURN jsonb_build_object('membershipId',v_membership.id,'tenantId',v_membership.tenant_id,
                            'accessVersion',v_membership.access_version,'correlationId',v_correlation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_tenant_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_tenant_invitation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_owner_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_transfer public.tenant_owner_transfers%ROWTYPE;
  v_target public.tenant_memberships%ROWTYPE;
  v_source public.tenant_memberships%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'OWNER_TRANSFER_AUTHENTICATION_REQUIRED' USING ERRCODE='P1002'; END IF;
  SELECT * INTO v_transfer FROM public.tenant_owner_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_TRANSFER_NOT_FOUND' USING ERRCODE='P1001'; END IF;
  SELECT * INTO v_target FROM public.tenant_memberships
  WHERE id=v_transfer.target_membership_id AND tenant_id=v_transfer.tenant_id FOR UPDATE;
  IF v_target.user_id<>v_uid THEN RAISE EXCEPTION 'OWNER_TRANSFER_TARGET_REQUIRED' USING ERRCODE='P1001'; END IF;
  IF v_transfer.status='accepted' THEN
    RETURN jsonb_build_object('transferId',v_transfer.id,'status','accepted','ownerMembershipId',v_target.id,'idempotent',true);
  END IF;
  IF v_transfer.status<>'pending' THEN RAISE EXCEPTION 'OWNER_TRANSFER_NOT_PENDING' USING ERRCODE='P1001'; END IF;
  IF v_transfer.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OWNER_TRANSFER_EXPIRED' USING ERRCODE='P1001'; END IF;
  IF v_target.status<>'active' THEN RAISE EXCEPTION 'OWNER_TRANSFER_TARGET_INACTIVE' USING ERRCODE='P1001'; END IF;
  SELECT * INTO v_source FROM public.tenant_memberships
  WHERE id=v_transfer.source_membership_id AND tenant_id=v_transfer.tenant_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_ownerships o
    WHERE o.tenant_id=v_transfer.tenant_id AND o.membership_id=v_source.id AND o.ended_at IS NULL
    FOR UPDATE
  ) THEN RAISE EXCEPTION 'OWNER_TRANSFER_SOURCE_CHANGED' USING ERRCODE='P1001'; END IF;

  UPDATE public.tenant_ownerships
  SET ended_at=clock_timestamp(),ended_by=v_uid,end_reason='accepted transfer'
  WHERE tenant_id=v_transfer.tenant_id AND membership_id=v_source.id AND ended_at IS NULL;
  INSERT INTO public.tenant_ownerships (tenant_id,membership_id,started_by)
  VALUES (v_transfer.tenant_id,v_target.id,v_uid);
  UPDATE public.tenant_owner_transfers
  SET status='accepted',resolved_at=clock_timestamp(),resolved_by=v_uid WHERE id=v_transfer.id;
  UPDATE public.tenant_memberships
  SET access_version=access_version+1,updated_at=clock_timestamp(),updated_by=v_uid
  WHERE id IN (v_source.id,v_target.id);
  PERFORM public.write_access_audit(v_transfer.tenant_id,v_uid,'access.owner_transfer_accepted','tenant_owner_transfer',v_transfer.id::text,
    jsonb_build_object('subject_user_id',v_uid,'prior',jsonb_build_object('ownerMembershipId',v_source.id),
                       'new',jsonb_build_object('ownerMembershipId',v_target.id),
                       'reason','target accepted','correlation_id',v_correlation_id));
  RETURN jsonb_build_object('transferId',v_transfer.id,'status','accepted','ownerMembershipId',v_target.id,'correlationId',v_correlation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_owner_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_owner_transfer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bootstrap_first_tenant_admin(p_tenant_id uuid,p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_membership public.tenant_memberships%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL OR NOT (SELECT public.is_superadmin()) THEN
    RAISE EXCEPTION 'PLATFORM_REPAIR_AUTHORITY_REQUIRED' USING ERRCODE='P1001';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.status NOT IN ('suspended','cancelled') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOTSTRAP_TENANT_INVALID' USING ERRCODE='P1001'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant_id)
     OR EXISTS (SELECT 1 FROM public.tenant_ownerships o WHERE o.tenant_id=p_tenant_id AND o.ended_at IS NULL) THEN
    RAISE EXCEPTION 'BOOTSTRAP_ALREADY_COMPLETE' USING ERRCODE='P1001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_target_user_id) THEN
    RAISE EXCEPTION 'BOOTSTRAP_USER_NOT_FOUND' USING ERRCODE='P1001';
  END IF;
  INSERT INTO public.tenant_memberships (tenant_id,user_id,status,access_version,created_by,updated_by)
  VALUES (p_tenant_id,p_target_user_id,'active',1,v_uid,v_uid) RETURNING * INTO v_membership;
  INSERT INTO public.membership_template_assignments (membership_id,tenant_id,template_key,assigned_by)
  VALUES (v_membership.id,p_tenant_id,'company_admin',v_uid);
  INSERT INTO public.tenant_ownerships (tenant_id,membership_id,started_by)
  VALUES (p_tenant_id,v_membership.id,v_uid);
  UPDATE auth.users
  SET metadata=jsonb_build_object('role','employee','tenant_id',p_tenant_id),updated_at=clock_timestamp()
  WHERE id=p_target_user_id;
  PERFORM public.write_access_audit(p_tenant_id,v_uid,'access.bootstrap_completed','tenant_membership',v_membership.id::text,
    jsonb_build_object('subject_user_id',p_target_user_id,'prior',NULL,
                       'new',jsonb_build_object('owner',true,'templates',jsonb_build_array('company_admin'),'accessVersion',1),
                       'reason','first tenant administrator','correlation_id',v_correlation_id));
  RETURN jsonb_build_object('membershipId',v_membership.id,'owner',true,'templates',jsonb_build_array('company_admin'),'correlationId',v_correlation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_first_tenant_admin(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_tenant_admin(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.repair_ownerless_tenant(p_tenant_id uuid,p_target_membership_id uuid,p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_target public.tenant_memberships%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL OR NOT (SELECT public.is_superadmin()) THEN
    RAISE EXCEPTION 'PLATFORM_REPAIR_AUTHORITY_REQUIRED' USING ERRCODE='P1001';
  END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'ACCESS_REASON_REQUIRED' USING ERRCODE='P1001'; END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id=p_tenant_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.tenant_ownerships o WHERE o.tenant_id=p_tenant_id AND o.ended_at IS NULL) THEN
    RAISE EXCEPTION 'OWNERLESS_REPAIR_NOT_REQUIRED' USING ERRCODE='P1001';
  END IF;
  SELECT * INTO v_target FROM public.tenant_memberships
  WHERE id=p_target_membership_id AND tenant_id=p_tenant_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_REPAIR_TARGET_INVALID' USING ERRCODE='P1001'; END IF;
  INSERT INTO public.tenant_ownerships (tenant_id,membership_id,started_by)
  VALUES (p_tenant_id,v_target.id,v_uid);
  UPDATE public.tenant_memberships SET access_version=access_version+1,updated_at=clock_timestamp(),updated_by=v_uid
  WHERE id=v_target.id RETURNING * INTO v_target;
  PERFORM public.write_access_audit(p_tenant_id,v_uid,'access.ownerless_tenant_repaired','tenant_membership',v_target.id::text,
    jsonb_build_object('subject_user_id',v_target.user_id,'prior',jsonb_build_object('owner',NULL),
                       'new',jsonb_build_object('ownerMembershipId',v_target.id,'accessVersion',v_target.access_version),
                       'reason',p_reason,'correlation_id',v_correlation_id));
  RETURN jsonb_build_object('membershipId',v_target.id,'owner',true,'accessVersion',v_target.access_version,'correlationId',v_correlation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.repair_ownerless_tenant(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_ownerless_tenant(uuid,uuid,text) TO authenticated;

-- Preserve the existing password-reset contract while moving its authority test onto the live
-- legacy is_hr() predicate plus the membership-backed tenant fence. Company Admin is not HR.
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
  actor_tenant_id uuid;
  updated_user_id uuid;
  target_user_id uuid;
  target_user_tenant_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  actor_tenant_id := (SELECT public.get_auth_tenant_id());
  IF actor_tenant_id IS NULL OR actor_tenant_id IS DISTINCT FROM tenant_uuid OR NOT (SELECT public.is_hr()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF nullif(btrim(target_email),'') IS NULL THEN RAISE EXCEPTION 'Employee email is required'; END IF;
  IF nullif(btrim(target_password_hash),'') IS NULL THEN RAISE EXCEPTION 'Password hash is required'; END IF;
  SELECT u.id,NULLIF(u.metadata->>'tenant_id','')::uuid INTO target_user_id,target_user_tenant_id
  FROM auth.users u WHERE lower(u.email)=lower(btrim(target_email));
  IF target_user_id IS NULL THEN RAISE EXCEPTION 'Auth user not found'; END IF;
  IF target_user_tenant_id IS NOT NULL AND target_user_tenant_id IS DISTINCT FROM tenant_uuid THEN
    RAISE EXCEPTION 'Employee not found for this tenant';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id=target_user_id
      AND (u.metadata->>'role') IN ('superadmin','admin','hr','hr_admin')
  ) THEN RAISE EXCEPTION 'Forbidden: cannot set password for a privileged account'; END IF;
  UPDATE auth.users
  SET password=target_password_hash,email_verified=true,
      metadata=jsonb_build_object('role','employee','tenant_id',tenant_uuid),updated_at=clock_timestamp()
  WHERE id=target_user_id RETURNING id INTO updated_user_id;
  UPDATE public.employees SET user_id=updated_user_id
  WHERE tenant_id=tenant_uuid AND lower(email)=lower(btrim(target_email));
  RETURN updated_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_employee_password_by_hr(text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_password_by_hr(text,text,uuid) TO authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.access_templates) <> 6 THEN
    RAISE EXCEPTION 'P1-02 expected six fixed templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.id <> md5(m.tenant_id::text || ':' || m.user_id::text)::uuid
  ) THEN RAISE EXCEPTION 'P1-02 membership id contract violated'; END IF;
  IF has_function_privilege('authenticated','public.check_rate_limit(uuid,uuid,text,integer,interval)','EXECUTE') THEN
    RAISE EXCEPTION 'P1-02 must not re-grant check_rate_limit to authenticated';
  END IF;
END;
$$;
