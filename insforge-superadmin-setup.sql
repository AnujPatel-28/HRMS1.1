-- TalentMesh super admin setup and RLS fixes.
-- Run with project/admin database privileges.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('owner', 'support_admin', 'billing_admin')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL,
  target_table text,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

-- Ensure the required platform owner account has the intended metadata.
UPDATE auth.users
SET
  email_verified = true,
  metadata = jsonb_build_object('role', 'superadmin', 'tenant_id', NULL),
  profile = COALESCE(profile, '{}'::jsonb) || jsonb_build_object('name', 'TalentMesh Super Admin'),
  updated_at = now()
WHERE email = 'admin@talentmeshsolutions.com';

INSERT INTO public.platform_admins (user_id, email, role, is_active)
SELECT id, email, 'owner', true
FROM auth.users
WHERE email = 'admin@talentmeshsolutions.com'
ON CONFLICT (user_id) DO UPDATE
SET email = EXCLUDED.email,
    role = 'owner',
    is_active = true,
    updated_at = now();

-- Retire the previous temporary superadmin login if it exists.
UPDATE auth.users
SET
  metadata = COALESCE(metadata, '{}'::jsonb) - 'role' - 'tenant_id',
  updated_at = now()
WHERE email = 'admin@talentmesh.in';

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = (SELECT auth.uid())
      AND pa.is_active = true
      AND pa.role IN ('owner', 'support_admin', 'billing_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_platform_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT pa.role
  FROM public.platform_admins pa
  WHERE pa.user_id = (SELECT auth.uid())
    AND pa.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.tenant_is_active(tenant_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = tenant_uuid
      AND t.status IN ('trial', 'active')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_tenant(tenant_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT (SELECT public.is_superadmin())
    OR (
      tenant_uuid = (SELECT public.get_auth_tenant_id())
      AND (SELECT public.tenant_is_active(tenant_uuid))
    );
$$;

-- Keep the existing tenant helper aligned with auth.users.metadata.
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT (metadata->>'tenant_id')::uuid
  FROM auth.users
  WHERE id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.set_hr_user_metadata(
  user_email text,
  tenant_uuid uuid,
  user_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  updated_user_id uuid;
BEGIN
  IF NOT (SELECT public.is_superadmin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE auth.users
  SET
    email_verified = true,
    metadata = jsonb_build_object('role', 'hr', 'tenant_id', tenant_uuid),
    profile = COALESCE(profile, '{}'::jsonb) || jsonb_build_object('name', COALESCE(user_name, user_email)),
    updated_at = now()
  WHERE email = user_email
  RETURNING id INTO updated_user_id;

  INSERT INTO public.platform_audit_logs (
    actor_user_id,
    actor_email,
    action,
    target_table,
    target_id,
    after_data
  )
  SELECT
    (SELECT auth.uid()),
    u.email,
    'CREATE_HR_ADMIN',
    'auth.users',
    updated_user_id,
    jsonb_build_object('email', user_email, 'tenant_id', tenant_uuid)
  FROM auth.users u
  WHERE u.id = (SELECT auth.uid());

  RETURN updated_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_tenant_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor_email text;
BEGIN
  IF NOT (SELECT public.is_superadmin()) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT email INTO actor_email
  FROM auth.users
  WHERE id = (SELECT auth.uid());

  INSERT INTO public.platform_audit_logs (
    actor_user_id,
    actor_email,
    action,
    target_table,
    target_id,
    before_data,
    after_data
  )
  VALUES (
    (SELECT auth.uid()),
    actor_email,
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tenants_platform_audit ON public.tenants;
CREATE TRIGGER tenants_platform_audit
AFTER INSERT OR UPDATE OR DELETE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.audit_tenant_changes();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_subdomain_unique') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_subdomain_unique UNIQUE (subdomain);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_plan_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_plan_check CHECK (plan IN ('trial', 'starter', 'growth', 'pro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_status_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('trial', 'active', 'suspended', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_max_employees_positive') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_max_employees_positive CHECK (max_employees > 0);
  END IF;
END $$;

-- Tenant RLS: superadmin sees/manages every tenant; regular users see only their tenant.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS superadmin_select_all ON public.tenants;
DROP POLICY IF EXISTS superadmin_update_all ON public.tenants;
DROP POLICY IF EXISTS superadmin_insert ON public.tenants;
DROP POLICY IF EXISTS tenants_select_own ON public.tenants;

CREATE POLICY tenants_superadmin_select_all
ON public.tenants
FOR SELECT
TO authenticated
USING ((SELECT public.is_superadmin()));

CREATE POLICY tenants_superadmin_update_all
ON public.tenants
FOR UPDATE
TO authenticated
USING ((SELECT public.is_superadmin()))
WITH CHECK ((SELECT public.is_superadmin()));

CREATE POLICY tenants_superadmin_insert
ON public.tenants
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.is_superadmin()));

CREATE POLICY tenants_select_own
ON public.tenants
FOR SELECT
TO authenticated
USING (id = (SELECT public.get_auth_tenant_id()) AND (SELECT public.tenant_is_active(id)));

-- Superadmin dashboard needs global employee counts for usage/revenue.
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.employees;

CREATE POLICY tenant_isolation
ON public.employees
FOR ALL
TO authenticated
USING ((SELECT public.can_access_tenant(tenant_id)))
WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS platform_admins_select_self ON public.platform_admins;
DROP POLICY IF EXISTS platform_admins_owner_all ON public.platform_admins;
DROP POLICY IF EXISTS platform_audit_logs_admin_read ON public.platform_audit_logs;

CREATE POLICY platform_admins_select_self
ON public.platform_admins
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY platform_admins_owner_all
ON public.platform_admins
FOR ALL
TO authenticated
USING ((SELECT public.is_superadmin()))
WITH CHECK ((SELECT public.is_superadmin()));

CREATE POLICY platform_audit_logs_admin_read
ON public.platform_audit_logs
FOR SELECT
TO authenticated
USING ((SELECT public.is_superadmin()));

DROP POLICY IF EXISTS tenant_active_restrictive ON public.attendance;
CREATE POLICY tenant_active_restrictive ON public.attendance AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.calendar_events;
CREATE POLICY tenant_active_restrictive ON public.calendar_events AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.chat_channel_members;
CREATE POLICY tenant_active_restrictive ON public.chat_channel_members AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.chat_channels;
CREATE POLICY tenant_active_restrictive ON public.chat_channels AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.chat_messages;
CREATE POLICY tenant_active_restrictive ON public.chat_messages AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.employees;
CREATE POLICY tenant_active_restrictive ON public.employees AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.holidays;
CREATE POLICY tenant_active_restrictive ON public.holidays AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.hr_policies;
CREATE POLICY tenant_active_restrictive ON public.hr_policies AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.leaves;
CREATE POLICY tenant_active_restrictive ON public.leaves AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.notifications;
CREATE POLICY tenant_active_restrictive ON public.notifications AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.task_submissions;
CREATE POLICY tenant_active_restrictive ON public.task_submissions AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.tasks;
CREATE POLICY tenant_active_restrictive ON public.tasks AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
DROP POLICY IF EXISTS tenant_active_restrictive ON public.tenant_settings;
CREATE POLICY tenant_active_restrictive ON public.tenant_settings AS RESTRICTIVE FOR ALL TO public USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
