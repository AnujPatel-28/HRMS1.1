CREATE OR REPLACE FUNCTION public.set_hr_user_metadata(user_email text, tenant_uuid uuid, user_name text DEFAULT NULL)
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
  SET email_verified = true,
      metadata = jsonb_build_object('role', 'hr', 'tenant_id', tenant_uuid),
      profile = COALESCE(profile, '{}'::jsonb) || jsonb_build_object('name', COALESCE(user_name, user_email)),
      updated_at = now()
  WHERE email = user_email
  RETURNING id INTO updated_user_id;

  INSERT INTO public.platform_audit_logs (actor_user_id, actor_email, action, target_table, target_id, after_data)
  SELECT (SELECT auth.uid()), u.email, 'CREATE_HR_ADMIN', 'auth.users', updated_user_id,
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

  SELECT email INTO actor_email FROM auth.users WHERE id = (SELECT auth.uid());

  INSERT INTO public.platform_audit_logs (actor_user_id, actor_email, action, target_table, target_id, before_data, after_data)
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

DROP POLICY IF EXISTS tenants_superadmin_select_all ON public.tenants;
DROP POLICY IF EXISTS tenants_superadmin_update_all ON public.tenants;
DROP POLICY IF EXISTS tenants_superadmin_insert ON public.tenants;
DROP POLICY IF EXISTS tenants_select_own ON public.tenants;

CREATE POLICY tenants_superadmin_select_all ON public.tenants FOR SELECT TO authenticated USING ((SELECT public.is_superadmin()));
CREATE POLICY tenants_superadmin_update_all ON public.tenants FOR UPDATE TO authenticated USING ((SELECT public.is_superadmin())) WITH CHECK ((SELECT public.is_superadmin()));
CREATE POLICY tenants_superadmin_insert ON public.tenants FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_superadmin()));
CREATE POLICY tenants_select_own ON public.tenants FOR SELECT TO authenticated USING (id = (SELECT public.get_auth_tenant_id()) AND (SELECT public.tenant_is_active(id)));

DROP POLICY IF EXISTS tenant_isolation ON public.employees;
CREATE POLICY tenant_isolation ON public.employees FOR ALL TO authenticated USING ((SELECT public.can_access_tenant(tenant_id))) WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));
