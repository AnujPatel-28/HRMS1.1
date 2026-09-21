-- P3-02: explicit project membership and server-owned task lifecycle.
-- Project grants are intentionally not emitted by the P1 capability summary until P3-02b.

INSERT INTO public.modules(key,name,description,is_core,sort_order)
VALUES ('projects','Projects','Project membership and project workspace',false,65)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.tenant_modules(tenant_id,module_key,enabled,enabled_at)
SELECT tenant_id,'projects',enabled,now() FROM public.tenant_modules WHERE module_key='tasks'
ON CONFLICT (tenant_id,module_key) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_id_id_p302_idx ON public.projects(tenant_id,id);
CREATE TABLE public.project_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('manager','member')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,project_id,employee_id),
  FOREIGN KEY(tenant_id,project_id) REFERENCES public.projects(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,employee_id) REFERENCES public.employees(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX project_memberships_employee_idx ON public.project_memberships(tenant_id,employee_id,project_id) WHERE is_active;
ALTER TABLE public.project_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_memberships_tenant ON public.project_memberships AS RESTRICTIVE FOR ALL
  USING (tenant_id=public.get_auth_tenant_id()) WITH CHECK (tenant_id=public.get_auth_tenant_id());
CREATE POLICY project_memberships_module ON public.project_memberships AS RESTRICTIVE FOR ALL
  USING (public.tenant_has_module('projects')) WITH CHECK (public.tenant_has_module('projects'));
GRANT SELECT ON public.project_memberships TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.project_memberships FROM PUBLIC,anon,authenticated;

-- Membership is checked fresh from the server table on each call. The project id is a
-- record selector, never a claim of authority; tenant, employee and role are re-derived.
CREATE FUNCTION public.is_project_member(p_project_id uuid,p_role text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_memberships pm
    JOIN public.projects p ON p.id=pm.project_id AND p.tenant_id=pm.tenant_id
    JOIN public.tenant_memberships m ON m.tenant_id=pm.tenant_id AND m.employee_id=pm.employee_id
    JOIN public.employees e ON e.id=pm.employee_id AND e.tenant_id=pm.tenant_id
    WHERE pm.project_id=p_project_id AND pm.tenant_id=(SELECT public.get_auth_tenant_id())
      AND pm.is_active AND (p_role IS NULL OR pm.role=p_role)
      AND m.user_id=(SELECT auth.uid()) AND m.status='active'
      AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
      AND (SELECT public.can_access_tenant(pm.tenant_id))
      AND (SELECT public.tenant_has_module('projects'))
  );
$$;
REVOKE ALL ON FUNCTION public.is_project_member(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid,text) TO authenticated;

CREATE FUNCTION public.p3_project_scope(p_project_id uuid,p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT public.tenant_has_module('projects')) AND EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.project_memberships pm ON pm.project_id=p.id AND pm.tenant_id=p.tenant_id AND pm.is_active
    JOIN public.tenant_memberships m ON m.tenant_id=pm.tenant_id AND m.employee_id=pm.employee_id
      AND m.user_id=(SELECT auth.uid()) AND m.status='active'
    JOIN public.employees e ON e.id=pm.employee_id AND e.tenant_id=pm.tenant_id
    JOIN public.membership_template_assignments a ON a.membership_id=m.id AND a.tenant_id=m.tenant_id AND a.is_active
    WHERE p.id=p_project_id AND p.tenant_id=(SELECT public.get_auth_tenant_id())
      AND public.can_access_tenant(p.tenant_id)
      AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
      AND ((p_action='project.read' AND a.template_key IN ('employee','project_manager'))
        OR (p_action IN ('project.manage','project.members.manage','task.assign','task.review')
          AND a.template_key='project_manager' AND pm.role='manager'))
  );
$$;
REVOKE ALL ON FUNCTION public.p3_project_scope(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_project_scope(uuid,text) TO authenticated;

CREATE POLICY project_memberships_read ON public.project_memberships FOR SELECT TO authenticated
  USING (public.is_project_member(project_id,NULL) OR public.p3_project_scope(project_id,'project.members.manage'));

-- The P1 resolver deliberately rejects project scope. Company/direct-report checks still use
-- it; project checks use the membership-backed helper above. Every path is same-tenant.
CREATE FUNCTION public.p3_task_scope(p_tenant_id uuid,p_assignee uuid,p_project_id uuid,p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_tenant_id=(SELECT public.get_auth_tenant_id())
    AND public.can_access_tenant(p_tenant_id)
    AND (SELECT public.tenant_has_module('tasks'))
    AND (p_project_id IS NULL OR EXISTS(SELECT 1 FROM public.projects p
      WHERE p.id=p_project_id AND p.tenant_id=p_tenant_id))
    AND EXISTS (SELECT 1 FROM public.employees target WHERE target.id=p_assignee AND target.tenant_id=p_tenant_id)
    AND (
      (p_action='read' AND EXISTS (
        SELECT 1 FROM public.tenant_memberships m JOIN public.employees e ON e.id=m.employee_id AND e.tenant_id=m.tenant_id
        WHERE m.user_id=(SELECT auth.uid()) AND m.tenant_id=p_tenant_id AND m.status='active'
          AND e.id=p_assignee AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
          AND (SELECT public.has_access_action('task.submit','self',NULL))
          AND (p_project_id IS NULL OR (SELECT public.is_project_member(p_project_id,NULL)))
      ))
      OR (p_action='submit' AND EXISTS (
        SELECT 1 FROM public.tenant_memberships m JOIN public.employees e ON e.id=m.employee_id AND e.tenant_id=m.tenant_id
        WHERE m.user_id=(SELECT auth.uid()) AND m.tenant_id=p_tenant_id AND m.status='active'
          AND e.id=p_assignee AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
          AND (SELECT public.has_access_action('task.submit','self',NULL))
          AND (p_project_id IS NULL OR (SELECT public.is_project_member(p_project_id,NULL)))
      ))
      OR (p_action IN ('read','assign','review') AND
          (SELECT public.has_access_action(CASE WHEN p_action='read' THEN 'task.review' ELSE 'task.'||p_action END,'company',NULL)))
      OR (p_action IN ('read','assign','review') AND
          (SELECT public.has_access_action(CASE WHEN p_action='read' THEN 'task.review' ELSE 'task.'||p_action END,'direct_reports',NULL))
          AND (SELECT public.is_manager_of(p_assignee)))
      OR (p_action IN ('read','assign','review') AND p_project_id IS NOT NULL
          AND (SELECT public.p3_project_scope(p_project_id,CASE WHEN p_action='read' THEN 'task.review' ELSE 'task.'||p_action END)))
    );
$$;
REVOKE ALL ON FUNCTION public.p3_task_scope(uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_task_scope(uuid,uuid,uuid,text) TO authenticated;

-- All direct writes are removed at GRANT and policy level. Reads remain scoped.
REVOKE INSERT,UPDATE,DELETE ON public.tasks,public.task_submissions,public.projects FROM PUBLIC,anon,authenticated;
ALTER TABLE public.tasks ADD COLUMN archived_at timestamptz;
DROP POLICY IF EXISTS tasks_hr_all ON public.tasks;
DROP POLICY IF EXISTS tasks_self_read ON public.tasks;
DROP POLICY IF EXISTS tasks_self_update ON public.tasks;
CREATE POLICY tasks_p302_read ON public.tasks FOR SELECT TO authenticated
  USING (archived_at IS NULL AND public.p3_task_scope(tenant_id,assigned_to,project_id,'read'));

DROP POLICY IF EXISTS task_submissions_hr_all ON public.task_submissions;
DROP POLICY IF EXISTS task_submissions_self_rw ON public.task_submissions;
CREATE POLICY task_submissions_p302_read ON public.task_submissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id=task_id AND t.tenant_id=task_submissions.tenant_id
    AND t.assigned_to=task_submissions.employee_id AND t.archived_at IS NULL));

DROP POLICY IF EXISTS projects_hr_all ON public.projects;
DROP POLICY IF EXISTS projects_employee_read ON public.projects;
DROP POLICY IF EXISTS tenant_isolation ON public.projects;
CREATE POLICY tenant_isolation ON public.projects AS RESTRICTIVE FOR ALL
  USING (tenant_id=public.get_auth_tenant_id()) WITH CHECK (tenant_id=public.get_auth_tenant_id());
DROP POLICY IF EXISTS module_enabled_tasks ON public.projects;
CREATE POLICY module_enabled_projects ON public.projects AS RESTRICTIVE FOR ALL
  USING (public.tenant_has_module('projects')) WITH CHECK (public.tenant_has_module('projects'));
CREATE POLICY projects_p302_read ON public.projects FOR SELECT TO authenticated
  USING (public.p3_project_scope(id,'project.read'));

-- Project creation requires the project_manager template, then establishes its first
-- explicit manager membership atomically. manager_id remains display only.
CREATE FUNCTION public.p3_create_project(p_name text,p_description text DEFAULT NULL)
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
  INSERT INTO public.projects(tenant_id,name,description,status,manager_id,created_by)
    VALUES(v_tenant,btrim(p_name),p_description,'planning',v_employee,v_employee) RETURNING id INTO v_project;
  INSERT INTO public.project_memberships(tenant_id,project_id,employee_id,role)
    VALUES(v_tenant,v_project,v_employee,'manager');
  RETURN v_project;
END; $$;
REVOKE ALL ON FUNCTION public.p3_create_project(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_create_project(text,text) TO authenticated;

CREATE FUNCTION public.p3_set_project_member(p_project_id uuid,p_employee_id uuid,p_role text,p_active boolean DEFAULT true)
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
  INSERT INTO public.project_memberships(tenant_id,project_id,employee_id,role,is_active)
    VALUES(v_tenant,p_project_id,p_employee_id,p_role,p_active)
    ON CONFLICT(tenant_id,project_id,employee_id) DO UPDATE
      SET role=EXCLUDED.role,is_active=EXCLUDED.is_active,updated_at=now();
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.p3_set_project_member(uuid,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_set_project_member(uuid,uuid,text,boolean) TO authenticated;

CREATE FUNCTION public.p3_update_project(p_project_id uuid,p_name text,p_description text,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.p3_project_scope(p_project_id,'project.manage') THEN RAISE EXCEPTION 'PROJECT_MANAGE_DENIED' USING ERRCODE='P1003'; END IF;
  IF NULLIF(btrim(p_name),'') IS NULL OR p_status NOT IN ('planning','active','on_hold','completed','cancelled') THEN
    RAISE EXCEPTION 'PROJECT_INPUT_INVALID' USING ERRCODE='P1003'; END IF;
  UPDATE public.projects SET name=btrim(p_name),description=p_description,status=p_status,updated_at=now()
    WHERE id=p_project_id AND tenant_id=v_tenant;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.p3_update_project(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_update_project(uuid,text,text,text) TO authenticated;

CREATE FUNCTION public.p3_archive_project(p_project_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.p3_project_scope(p_project_id,'project.manage') THEN RAISE EXCEPTION 'PROJECT_MANAGE_DENIED' USING ERRCODE='P1003'; END IF;
  UPDATE public.projects SET status='completed',updated_at=now() WHERE id=p_project_id AND tenant_id=v_tenant;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.p3_archive_project(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_archive_project(uuid) TO authenticated;

CREATE FUNCTION public.p3_assign_task(p_assigned_to uuid,p_title text,p_project_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,p_priority text DEFAULT 'medium',p_due_date date DEFAULT NULL,p_due_time time DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_tenant uuid; v_actor uuid; v_task uuid;
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
  IF NOT public.p3_task_scope(v_tenant,p_assigned_to,p_project_id,'assign') THEN
    RAISE EXCEPTION 'TASK_ASSIGN_DENIED' USING ERRCODE='P1003'; END IF;
  INSERT INTO public.tasks(tenant_id,title,description,assigned_to,assigned_by,priority,due_date,due_time,status,project_id,attendance_lock_date)
    VALUES(v_tenant,btrim(p_title),p_description,p_assigned_to,v_actor,p_priority,p_due_date,p_due_time,'assigned',p_project_id,p_due_date)
    RETURNING id INTO v_task;
  INSERT INTO public.notifications(tenant_id,employee_id,user_id,title,body,type,reference_id)
    SELECT v_tenant,e.id,e.user_id,'New Task Assigned','You have been assigned: '||btrim(p_title),'task_assigned',v_task
    FROM public.employees e WHERE e.id=p_assigned_to AND e.tenant_id=v_tenant;
  RETURN v_task;
END; $$;
REVOKE ALL ON FUNCTION public.p3_assign_task(uuid,text,uuid,text,text,date,time) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_assign_task(uuid,text,uuid,text,text,date,time) TO authenticated;

CREATE FUNCTION public.p3_set_task_state(p_task_id uuid,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_task public.tasks%ROWTYPE; v_tenant uuid;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  SELECT * INTO v_task FROM public.tasks WHERE id=p_task_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND OR v_tenant IS NULL OR NOT public.tenant_has_module('tasks') THEN
    RAISE EXCEPTION 'TASK_UNAVAILABLE' USING ERRCODE='P1003'; END IF;
  IF NOT public.p3_task_scope(v_tenant,v_task.assigned_to,v_task.project_id,'assign') THEN
    RAISE EXCEPTION 'TASK_ASSIGN_DENIED' USING ERRCODE='P1003'; END IF;
  IF p_status<>'in_progress' OR v_task.status NOT IN ('assigned','rejected') THEN
    RAISE EXCEPTION 'TASK_TRANSITION_INVALID' USING ERRCODE='P1003'; END IF;
  UPDATE public.tasks SET status=p_status,updated_at=now() WHERE id=p_task_id AND tenant_id=v_tenant;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.p3_set_task_state(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_set_task_state(uuid,text) TO authenticated;

CREATE FUNCTION public.p3_archive_task(p_task_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_task public.tasks%ROWTYPE; v_tenant uuid;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  SELECT * INTO v_task FROM public.tasks WHERE id=p_task_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND OR v_tenant IS NULL OR NOT public.tenant_has_module('tasks') THEN
    RAISE EXCEPTION 'TASK_UNAVAILABLE' USING ERRCODE='P1003'; END IF;
  IF NOT public.p3_task_scope(v_tenant,v_task.assigned_to,v_task.project_id,'assign') THEN
    RAISE EXCEPTION 'TASK_ARCHIVE_DENIED' USING ERRCODE='P1003'; END IF;
  UPDATE public.tasks SET archived_at=COALESCE(archived_at,now()),updated_at=now()
    WHERE id=p_task_id AND tenant_id=v_tenant;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.p3_archive_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_archive_task(uuid) TO authenticated;

-- Exact existing signature: no appended parameters or competing overload.
CREATE OR REPLACE FUNCTION public.submit_task_request(p_task_id uuid,p_notes text,p_attachment_url text,p_attachment_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_task public.tasks%ROWTYPE; v_tenant uuid; v_actor uuid; v_submission uuid; v_notified integer:=0;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  SELECT * INTO v_task FROM public.tasks WHERE id=p_task_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND OR v_tenant IS NULL OR NOT public.tenant_has_module('tasks') OR v_task.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'TASK_UNAVAILABLE' USING ERRCODE='P1003'; END IF;
  SELECT e.id INTO v_actor FROM public.tenant_memberships m
    JOIN public.employees e ON e.id=m.employee_id AND e.tenant_id=m.tenant_id
    WHERE m.user_id=auth.uid() AND m.tenant_id=v_tenant AND m.status='active'
      AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding');
  IF v_actor IS NULL OR v_task.assigned_to<>v_actor
     OR NOT public.p3_task_scope(v_tenant,v_task.assigned_to,v_task.project_id,'submit') THEN
    RAISE EXCEPTION 'TASK_SUBMIT_DENIED' USING ERRCODE='P1003'; END IF;
  IF v_task.status='submitted' THEN
    SELECT id INTO v_submission FROM public.task_submissions
      WHERE task_id=p_task_id AND tenant_id=v_tenant AND employee_id=v_actor AND status='pending'
      ORDER BY submitted_at DESC,id DESC LIMIT 1;
    RETURN jsonb_build_object('success',true,'submission_id',v_submission,'notified',0,'duplicate',true);
  END IF;
  IF v_task.status NOT IN ('assigned','in_progress','rejected') THEN
    RAISE EXCEPTION 'TASK_TRANSITION_INVALID' USING ERRCODE='P1003'; END IF;
  INSERT INTO public.task_submissions(task_id,tenant_id,employee_id,notes,attachment_url,attachment_name,status)
    VALUES(p_task_id,v_tenant,v_actor,p_notes,p_attachment_url,p_attachment_name,'pending') RETURNING id INTO v_submission;
  UPDATE public.tasks SET status='submitted',updated_at=now() WHERE id=p_task_id AND tenant_id=v_tenant;

  -- Current, eligible reviewers only. The primary manager is resolved at submission time;
  -- mentor/reviewer/secondary relationships have no notification authority.
  INSERT INTO public.notifications(tenant_id,employee_id,user_id,title,body,type,reference_id)
  SELECT DISTINCT v_tenant,e.id,e.user_id,'Task Submitted','A task awaits review: '||v_task.title,'general',p_task_id
  FROM public.employees e
  JOIN public.tenant_memberships m ON m.tenant_id=e.tenant_id AND m.employee_id=e.id AND m.status='active'
  JOIN public.membership_template_assignments a ON a.membership_id=m.id AND a.tenant_id=m.tenant_id AND a.is_active
  WHERE e.tenant_id=v_tenant AND e.id<>v_actor
    AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding')
    AND ((a.template_key='hr_admin')
      OR (a.template_key='manager' AND EXISTS(
        SELECT 1 FROM public.employee_reporting_relationships r
        WHERE r.tenant_id=v_tenant AND r.employee_id=v_actor AND r.manager_id=e.id
          AND r.relationship_type='primary' AND r.is_active
          AND r.effective_from<=public.tenant_business_date(v_tenant,now())
          AND (r.effective_to IS NULL OR r.effective_to>public.tenant_business_date(v_tenant,now()))))
      OR (a.template_key='project_manager' AND v_task.project_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.project_memberships pm WHERE pm.tenant_id=v_tenant
          AND pm.project_id=v_task.project_id AND pm.employee_id=e.id AND pm.role='manager' AND pm.is_active)));
  GET DIAGNOSTICS v_notified=ROW_COUNT;
  RETURN jsonb_build_object('success',true,'submission_id',v_submission,'notified',v_notified,'duplicate',false);
END; $$;
REVOKE ALL ON FUNCTION public.submit_task_request(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_task_request(uuid,text,text,text) TO authenticated;

CREATE FUNCTION public.p3_review_task(p_task_id uuid,p_approved boolean,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_task public.tasks%ROWTYPE; v_tenant uuid; v_actor uuid; v_subject_user uuid;
  v_submission uuid; v_status text; v_unapproved integer;
BEGIN
  v_tenant:=public.get_auth_tenant_id();
  SELECT * INTO v_task FROM public.tasks WHERE id=p_task_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND OR v_tenant IS NULL OR NOT public.tenant_has_module('tasks') OR v_task.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'TASK_UNAVAILABLE' USING ERRCODE='P1003'; END IF;
  SELECT e.user_id INTO v_subject_user FROM public.employees e
    WHERE e.id=v_task.assigned_to AND e.tenant_id=v_tenant;
  PERFORM public.assert_distinct_approver(v_subject_user);
  SELECT e.id INTO v_actor FROM public.tenant_memberships m
    JOIN public.employees e ON e.id=m.employee_id AND e.tenant_id=m.tenant_id
    WHERE m.user_id=auth.uid() AND m.tenant_id=v_tenant AND m.status='active'
      AND e.status NOT IN ('inactive','terminated','draft','pending_hr_review','pending_onboarding');
  IF v_actor IS NULL OR NOT public.p3_task_scope(v_tenant,v_task.assigned_to,v_task.project_id,'review') THEN
    RAISE EXCEPTION 'TASK_REVIEW_DENIED' USING ERRCODE='P1003'; END IF;
  v_status:=CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END;
  IF v_task.status=v_status THEN RETURN jsonb_build_object('success',true,'duplicate',true); END IF;
  IF v_task.status<>'submitted' THEN RAISE EXCEPTION 'TASK_TRANSITION_INVALID' USING ERRCODE='P1003'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'TASK_REVIEW_REASON_REQUIRED' USING ERRCODE='P1003'; END IF;
  SELECT s.id INTO v_submission FROM public.task_submissions s
    WHERE s.task_id=p_task_id AND s.tenant_id=v_tenant AND s.employee_id=v_task.assigned_to AND s.status='pending'
    ORDER BY s.submitted_at DESC,s.id DESC LIMIT 1 FOR UPDATE;
  IF v_submission IS NULL THEN RAISE EXCEPTION 'TASK_SUBMISSION_MISSING' USING ERRCODE='P1003'; END IF;
  UPDATE public.task_submissions SET status=v_status,reviewed_by=v_actor,reviewed_at=now(),review_notes=btrim(p_reason)
    WHERE id=v_submission AND tenant_id=v_tenant;
  UPDATE public.tasks SET status=v_status,updated_at=now() WHERE id=p_task_id AND tenant_id=v_tenant;

  -- Preserve the existing approval-side attendance unlock. The P2 punch-out gate is untouched.
  IF p_approved AND v_task.attendance_lock_date IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=v_tenant AND t.punch_out_gate_enabled) THEN
    SELECT count(*) INTO v_unapproved FROM public.tasks t
      WHERE t.tenant_id=v_tenant AND t.assigned_to=v_task.assigned_to
        AND t.attendance_lock_date=v_task.attendance_lock_date AND t.archived_at IS NULL AND t.status<>'approved';
    IF v_unapproved=0 THEN
      UPDATE public.attendance SET punch_out_allowed=true
        WHERE tenant_id=v_tenant AND employee_id=v_task.assigned_to AND date=v_task.attendance_lock_date;
    END IF;
  END IF;
  INSERT INTO public.notifications(tenant_id,employee_id,user_id,title,body,type,reference_id)
    SELECT v_tenant,e.id,e.user_id,CASE WHEN p_approved THEN 'Task Approved' ELSE 'Task Rejected' END,
      btrim(p_reason),CASE WHEN p_approved THEN 'task_approved' ELSE 'task_rejected' END,p_task_id
    FROM public.employees e WHERE e.id=v_task.assigned_to AND e.tenant_id=v_tenant;
  RETURN jsonb_build_object('success',true,'duplicate',false,'submission_id',v_submission);
END; $$;
REVOKE ALL ON FUNCTION public.p3_review_task(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.p3_review_task(uuid,boolean,text) TO authenticated;

-- Keep existing UI/API entrypoints on their exact signatures; all decisions are in p3_review_task.
CREATE OR REPLACE FUNCTION public.approve_task_request(p_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF public.get_auth_tenant_id() IS NULL OR NOT EXISTS
    (SELECT 1 FROM public.tasks WHERE id=p_task_id AND tenant_id=public.get_auth_tenant_id()) THEN
    RAISE EXCEPTION 'TASK_UNAVAILABLE' USING ERRCODE='P1003'; END IF;
  RETURN public.p3_review_task(p_task_id,true,'Approved');
END; $$;
REVOKE ALL ON FUNCTION public.approve_task_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_task_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_task_request(p_task_id uuid,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF public.get_auth_tenant_id() IS NULL OR NOT EXISTS
    (SELECT 1 FROM public.tasks WHERE id=p_task_id AND tenant_id=public.get_auth_tenant_id()) THEN
    RAISE EXCEPTION 'TASK_UNAVAILABLE' USING ERRCODE='P1003'; END IF;
  RETURN public.p3_review_task(p_task_id,false,p_notes);
END; $$;
REVOKE ALL ON FUNCTION public.reject_task_request(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reject_task_request(uuid,text) TO authenticated;
