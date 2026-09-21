-- P3-02 closing work (brief §9 D5). Lead review of e14be9e found project_memberships was
-- created empty and never backfilled, an open-task hole in member deactivation, and three
-- pieces of pre-existing client behaviour (dates, department-mode assignment, manager display)
-- that the RPC migration silently dropped instead of restoring server-side.

-- D5.1: Backfill project_memberships from existing data. Same-tenant, active employees only.
-- Managers are inserted first, then task assignees as members with ON CONFLICT DO NOTHING —
-- a manager who is also an assignee keeps the manager role, never downgraded. This restores
-- membership FACTS the old manager_id/assigned_to columns held implicitly; no template grants.
INSERT INTO public.project_memberships(tenant_id,project_id,employee_id,role)
  SELECT p.tenant_id,p.id,p.manager_id,'manager'
  FROM public.projects p
  JOIN public.employees e ON e.id=p.manager_id AND e.tenant_id=p.tenant_id
  WHERE p.manager_id IS NOT NULL
    AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
  ON CONFLICT (tenant_id,project_id,employee_id) DO NOTHING;

INSERT INTO public.project_memberships(tenant_id,project_id,employee_id,role)
  SELECT DISTINCT t.tenant_id,t.project_id,t.assigned_to,'member'
  FROM public.tasks t
  JOIN public.employees e ON e.id=t.assigned_to AND e.tenant_id=t.tenant_id
  WHERE t.project_id IS NOT NULL AND t.archived_at IS NULL
    AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
  ON CONFLICT (tenant_id,project_id,employee_id) DO NOTHING;

-- D5.2: p3_set_project_member refuses deactivating a member with an open task in that project.
-- Signature is unchanged, so CREATE OR REPLACE is correct here (no appended-parameter overload
-- risk). Body derived from pg_get_functiondef() on TB-M1M2 2026-09-21; only the new guard was
-- added, placed after the self-removal check so a manager removing themselves still gets that
-- more specific error.
CREATE OR REPLACE FUNCTION public.p3_set_project_member(p_project_id uuid,p_employee_id uuid,p_role text,p_active boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.p3_project_scope(p_project_id,'project.members.manage') THEN
    RAISE EXCEPTION 'PROJECT_MEMBERS_MANAGE_DENIED' USING ERRCODE='P1003'; END IF;
  IF p_role NOT IN ('manager','member') OR p_role IS NULL THEN RAISE EXCEPTION 'PROJECT_ROLE_INVALID' USING ERRCODE='P1003'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=p_employee_id AND e.tenant_id=v_tenant
      AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')) THEN
    RAISE EXCEPTION 'PROJECT_MEMBER_INVALID' USING ERRCODE='P1003'; END IF;
  IF p_employee_id=(SELECT m.employee_id FROM public.tenant_memberships m WHERE m.user_id=auth.uid() AND m.tenant_id=v_tenant)
    AND (NOT p_active OR p_role<>'manager') THEN RAISE EXCEPTION 'PROJECT_MANAGER_SELF_REMOVAL_DENIED' USING ERRCODE='P1003'; END IF;
  IF NOT p_active AND EXISTS(
      SELECT 1 FROM public.tasks t WHERE t.tenant_id=v_tenant AND t.project_id=p_project_id
        AND t.assigned_to=p_employee_id AND t.status<>'approved' AND t.archived_at IS NULL
    ) THEN RAISE EXCEPTION 'PROJECT_MEMBER_HAS_OPEN_TASKS' USING ERRCODE='P1003'; END IF;
  INSERT INTO public.project_memberships(tenant_id,project_id,employee_id,role,is_active)
    VALUES(v_tenant,p_project_id,p_employee_id,p_role,p_active)
    ON CONFLICT(tenant_id,project_id,employee_id) DO UPDATE
      SET role=EXCLUDED.role,is_active=EXCLUDED.is_active,updated_at=now();
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.p3_set_project_member(uuid,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_set_project_member(uuid,uuid,text,boolean) TO authenticated;

-- D5.3: project dates are editable again (end >= start). D5.4: department-mode assignment is
-- restored on p3_assign_task. All three parameter lists change, so each is DROP FUNCTION on the
-- exact live signature (no IF EXISTS — a signature mismatch must fail the migration loudly, not
-- silently no-op) followed by CREATE, then the grants are re-applied.
DROP FUNCTION public.p3_create_project(text,text);
CREATE FUNCTION public.p3_create_project(p_name text,p_description text DEFAULT NULL,p_start_date date DEFAULT NULL,p_end_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_tenant uuid; v_employee uuid; v_project uuid;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.can_access_tenant(v_tenant) OR NOT public.tenant_has_module('projects') THEN RAISE EXCEPTION 'PROJECT_UNAVAILABLE' USING ERRCODE='P1002'; END IF;
  SELECT m.employee_id INTO v_employee FROM public.tenant_memberships m
    JOIN public.employees e ON e.id=m.employee_id AND e.tenant_id=m.tenant_id
    JOIN public.membership_template_assignments a ON a.membership_id=m.id AND a.is_active AND a.template_key='project_manager'
    WHERE m.user_id=auth.uid() AND m.tenant_id=v_tenant AND m.status='active'
      AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding') LIMIT 1;
  IF v_employee IS NULL THEN RAISE EXCEPTION 'PROJECT_MANAGE_DENIED' USING ERRCODE='P1003'; END IF;
  IF NULLIF(btrim(p_name),'') IS NULL THEN RAISE EXCEPTION 'PROJECT_NAME_REQUIRED' USING ERRCODE='P1003'; END IF;
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL AND p_end_date<p_start_date THEN
    RAISE EXCEPTION 'PROJECT_DATE_RANGE_INVALID' USING ERRCODE='P1003'; END IF;
  INSERT INTO public.projects(tenant_id,name,description,status,manager_id,created_by,start_date,end_date)
    VALUES(v_tenant,btrim(p_name),p_description,'planning',v_employee,v_employee,p_start_date,p_end_date) RETURNING id INTO v_project;
  INSERT INTO public.project_memberships(tenant_id,project_id,employee_id,role)
    VALUES(v_tenant,v_project,v_employee,'manager');
  RETURN v_project;
END; $$;
REVOKE ALL ON FUNCTION public.p3_create_project(text,text,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_create_project(text,text,date,date) TO authenticated;

DROP FUNCTION public.p3_update_project(uuid,text,text,text);
CREATE FUNCTION public.p3_update_project(p_project_id uuid,p_name text,p_description text,p_status text,p_start_date date DEFAULT NULL,p_end_date date DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.p3_project_scope(p_project_id,'project.manage') THEN RAISE EXCEPTION 'PROJECT_MANAGE_DENIED' USING ERRCODE='P1003'; END IF;
  IF NULLIF(btrim(p_name),'') IS NULL OR p_status NOT IN ('planning','active','on_hold','completed','cancelled') THEN
    RAISE EXCEPTION 'PROJECT_INPUT_INVALID' USING ERRCODE='P1003'; END IF;
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL AND p_end_date<p_start_date THEN
    RAISE EXCEPTION 'PROJECT_DATE_RANGE_INVALID' USING ERRCODE='P1003'; END IF;
  UPDATE public.projects SET name=btrim(p_name),description=p_description,status=p_status,
      start_date=p_start_date,end_date=p_end_date,updated_at=now()
    WHERE id=p_project_id AND tenant_id=v_tenant;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.p3_update_project(uuid,text,text,text,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_update_project(uuid,text,text,text,date,date) TO authenticated;

-- department_filter is derived server-side from the org unit's name, as the removed client code
-- (git show e14be9e -- src/hr/TaskManagement.tsx) did with its local deptOptions lookup.
DROP FUNCTION public.p3_assign_task(uuid,text,uuid,text,text,date,time);
CREATE FUNCTION public.p3_assign_task(p_assigned_to uuid,p_title text,p_project_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,p_priority text DEFAULT 'medium',p_due_date date DEFAULT NULL,p_due_time time DEFAULT NULL,
  p_org_unit_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_tenant uuid; v_actor uuid; v_task uuid; v_dept_name text;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  SELECT e.id INTO v_actor FROM public.tenant_memberships m
    JOIN public.employees e ON e.id=m.employee_id AND e.tenant_id=m.tenant_id
    WHERE m.user_id=auth.uid() AND m.tenant_id=v_tenant AND m.status='active'
      AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding');
  IF v_tenant IS NULL OR v_actor IS NULL OR NOT public.tenant_has_module('tasks') THEN
    RAISE EXCEPTION 'TASK_ASSIGN_UNAVAILABLE' USING ERRCODE='P1002'; END IF;
  IF NULLIF(btrim(p_title),'') IS NULL OR p_priority NOT IN ('low','medium','high','urgent') THEN
    RAISE EXCEPTION 'TASK_INPUT_INVALID' USING ERRCODE='P1003'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=p_assigned_to AND e.tenant_id=v_tenant
    AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')) THEN
    RAISE EXCEPTION 'TASK_ASSIGNEE_INVALID' USING ERRCODE='P1003'; END IF;
  IF p_project_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND p.tenant_id=v_tenant)
    OR NOT EXISTS(SELECT 1 FROM public.project_memberships pm WHERE pm.project_id=p_project_id AND pm.tenant_id=v_tenant
      AND pm.employee_id=p_assigned_to AND pm.is_active)) THEN
    RAISE EXCEPTION 'TASK_PROJECT_MEMBER_REQUIRED' USING ERRCODE='P1003'; END IF;
  IF p_org_unit_id IS NOT NULL THEN
    SELECT name INTO v_dept_name FROM public.org_units WHERE id=p_org_unit_id AND tenant_id=v_tenant;
    IF v_dept_name IS NULL THEN RAISE EXCEPTION 'TASK_ORG_UNIT_INVALID' USING ERRCODE='P1003'; END IF;
  END IF;
  IF NOT public.p3_task_scope(v_tenant,p_assigned_to,p_project_id,'assign') THEN
    RAISE EXCEPTION 'TASK_ASSIGN_DENIED' USING ERRCODE='P1003'; END IF;
  INSERT INTO public.tasks(tenant_id,title,description,assigned_to,assigned_by,priority,due_date,due_time,status,project_id,attendance_lock_date,org_unit_id,department_filter)
    VALUES(v_tenant,btrim(p_title),p_description,p_assigned_to,v_actor,p_priority,p_due_date,p_due_time,'assigned',p_project_id,p_due_date,p_org_unit_id,v_dept_name)
    RETURNING id INTO v_task;
  INSERT INTO public.notifications(tenant_id,employee_id,title,body,type,reference_id)
    SELECT v_tenant,e.id,'New Task Assigned','You have been assigned: '||btrim(p_title),'task_assigned',v_task
    FROM public.employees e WHERE e.id=p_assigned_to AND e.tenant_id=v_tenant;
  RETURN v_task;
END; $$;
REVOKE ALL ON FUNCTION public.p3_assign_task(uuid,text,uuid,text,text,date,time,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_assign_task(uuid,text,uuid,text,text,date,time,uuid) TO authenticated;

DO $verify$
DECLARE v_name text; v_count integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['p3_set_project_member','p3_create_project','p3_update_project','p3_assign_task'] LOOP
    SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_name;
    IF v_count<>1 THEN RAISE EXCEPTION 'P3-02 closure overload count for %: %',v_name,v_count; END IF;
  END LOOP;
END $verify$;
