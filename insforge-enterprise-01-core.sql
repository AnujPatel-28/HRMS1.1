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

UPDATE auth.users
SET email_verified = true,
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

UPDATE auth.users
SET metadata = COALESCE(metadata, '{}'::jsonb) - 'role' - 'tenant_id',
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
