-- P3-02 forward repair derived from TB-M1M2 pg_get_functiondef() on 2026-09-21.
-- Only notification user_id columns and matching SELECT expressions change.

CREATE OR REPLACE FUNCTION public.p3_assign_task(p_assigned_to uuid, p_title text, p_project_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_priority text DEFAULT 'medium'::text, p_due_date date DEFAULT NULL::date, p_due_time time without time zone DEFAULT NULL::time without time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  INSERT INTO public.notifications(tenant_id,employee_id,title,body,type,reference_id)
    SELECT v_tenant,e.id,'New Task Assigned','You have been assigned: '||btrim(p_title),'task_assigned',v_task
    FROM public.employees e WHERE e.id=p_assigned_to AND e.tenant_id=v_tenant;
  RETURN v_task;
END; $function$;

CREATE OR REPLACE FUNCTION public.p3_review_task(p_task_id uuid, p_approved boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  INSERT INTO public.notifications(tenant_id,employee_id,title,body,type,reference_id)
    SELECT v_tenant,e.id,CASE WHEN p_approved THEN 'Task Approved' ELSE 'Task Rejected' END,
      btrim(p_reason),CASE WHEN p_approved THEN 'task_approved' ELSE 'task_rejected' END,p_task_id
    FROM public.employees e WHERE e.id=v_task.assigned_to AND e.tenant_id=v_tenant;
  RETURN jsonb_build_object('success',true,'duplicate',false,'submission_id',v_submission);
END; $function$;

CREATE OR REPLACE FUNCTION public.submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  INSERT INTO public.notifications(tenant_id,employee_id,title,body,type,reference_id)
  SELECT DISTINCT v_tenant,e.id,'Task Submitted','A task awaits review: '||v_task.title,'general',p_task_id
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
END; $function$;

DO $verify$
DECLARE v_name text; v_count integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['p3_assign_task','submit_task_request','p3_review_task'] LOOP
    SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_name;
    IF v_count<>1 THEN RAISE EXCEPTION 'P3-02 overload count for %: %',v_name,v_count; END IF;
  END LOOP;
END $verify$;

