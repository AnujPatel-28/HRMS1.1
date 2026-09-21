-- P3-02 defect: the review RPC approved a task without the calendar mark
-- previously written by all three frontend approval callers. Calendar has a
-- unique (employee_id,date) index, so preserve that existing conflict target.
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
  IF p_approved THEN
    INSERT INTO public.calendar_events(tenant_id,employee_id,date,type,task_id,notes)
      VALUES(v_tenant,v_task.assigned_to,
        COALESCE(v_task.attendance_lock_date,v_task.due_date,public.tenant_business_date(v_tenant,now())),
        'green',p_task_id,'Task approved: '||v_task.title)
      ON CONFLICT (employee_id,date) DO UPDATE
        SET type=EXCLUDED.type,task_id=EXCLUDED.task_id,notes=EXCLUDED.notes
        WHERE calendar_events.tenant_id=EXCLUDED.tenant_id;
  END IF;
  INSERT INTO public.notifications(tenant_id,employee_id,title,body,type,reference_id)
    SELECT v_tenant,e.id,CASE WHEN p_approved THEN 'Task Approved' ELSE 'Task Rejected' END,
      btrim(p_reason),CASE WHEN p_approved THEN 'task_approved' ELSE 'task_rejected' END,p_task_id
    FROM public.employees e WHERE e.id=v_task.assigned_to AND e.tenant_id=v_tenant;
  RETURN jsonb_build_object('success',true,'duplicate',false,'submission_id',v_submission);
END; $function$;

DO $$ BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='p3_review_task') <> 1 THEN
    RAISE EXCEPTION 'p3_review_task overload drift';
  END IF;
END $$;
