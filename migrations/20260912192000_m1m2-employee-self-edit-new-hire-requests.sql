-- C1: employee self-edit allowlist (D1/D2), and manager "add team member" becomes a
-- reviewable request instead of a direct employees insert (D3).
--
-- D1/D2 background: `enforce_employee_update_restrictions` was a DENYLIST -- any column not
-- explicitly named was employee-writable, including `work_mode` (self-exempts geofenced
-- attendance, migrations/20260903112531_...geofence...sql line 77) and `grade_id` (denylist
-- named `grade`, not `grade_id`). Body below is derived from pg_get_functiondef() on the live
-- TB-M1M2 function (2026-09-22); the HR bypass, the auth.uid() bypass and the "own row only"
-- check are unchanged. Only the restriction logic changes: it now diffs OLD/NEW via
-- to_jsonb() against an explicit ALLOWED list, so any column added to `employees` in the
-- future is HR-only by default (a true allowlist, not an enumerated denylist).
CREATE OR REPLACE FUNCTION public.enforce_employee_update_restrictions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  -- D1: contact-only self-edit allowlist, exact list from the 2026-09-22 product decision.
  v_allowed CONSTANT text[] := ARRAY[
    'phone','address','city','state','pincode',
    'emergency_contact_name','emergency_contact_phone','emergency_contact_relation',
    'employee_bio','linkedin_url','profile_photo_url','blood_group'
  ];
  v_key text;
BEGIN
  -- If there is no authenticated user (e.g. system/postgres session), allow the update
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- If actor is HR, allow the update to proceed
  IF public.is_hr() THEN
    RETURN NEW;
  END IF;

  -- Otherwise, verify that the employee is only updating their own row
  IF OLD.user_id IS DISTINCT FROM auth.uid() OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: employees can only update their own profile';
  END IF;

  -- D2: aadhaar_number/pan_number document references (OnboardingWizard.tsx ~248) may change
  -- ONLY while the employee is still in the onboarding status measured on OLD, and ONLY these
  -- two columns -- a narrow, status-conditioned carve-out, not a general self-edit widening.
  IF OLD.aadhaar_number IS DISTINCT FROM NEW.aadhaar_number AND OLD.status IS DISTINCT FROM 'pending_onboarding' THEN
    RAISE EXCEPTION 'Forbidden: aadhaar_number can only be set by the employee while onboarding is in progress';
  END IF;
  IF OLD.pan_number IS DISTINCT FROM NEW.pan_number AND OLD.status IS DISTINCT FROM 'pending_onboarding' THEN
    RAISE EXCEPTION 'Forbidden: pan_number can only be set by the employee while onboarding is in progress';
  END IF;

  -- D1 allowlist: every other changed column must be in v_allowed. aadhaar_number/pan_number
  -- are validated above (independently of this loop) and are skipped here.
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    CONTINUE WHEN v_key = ANY(v_allowed);
    CONTINUE WHEN v_key IN ('aadhaar_number', 'pan_number');
    IF v_old->v_key IS DISTINCT FROM v_new->v_key THEN
      RAISE EXCEPTION 'Forbidden: employees cannot modify administrative profile field "%"', v_key;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- D3: "Add team member" becomes a request, not a direct employees insert.
-- ============================================================================

-- managers_can_create_draft_reports (PERMISSIVE INSERT, WITH CHECK status='draft' AND
-- manager_id=get_my_employee_id()) held for EVERY employee, not only managers -- any employee
-- could create an employees row. AddTeamMemberModal.tsx inserted status:'inactive', which this
-- policy rejects anyway, so the screen was already broken. Dropping it leaves employees with NO
-- PERMISSIVE INSERT policy for a non-HR actor (employees_hr_all remains for HR), so a plain
-- employee -- manager or not -- can no longer insert into public.employees at all; the request
-- flow below is the only path.
DROP POLICY managers_can_create_draft_reports ON public.employees;

CREATE TABLE public.new_hire_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  requested_by uuid NOT NULL REFERENCES public.employees(id),
  name text NOT NULL,
  email text NOT NULL,
  job_title_id uuid REFERENCES public.job_titles(id),
  proposed_date_of_joining date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES public.employees(id),
  reviewed_at timestamptz,
  reason text,
  -- Approval does NOT auto-create the employee (D3). HR creates the employee through the
  -- normal onboarding flow and may link the resulting row back here for traceability.
  created_employee_id uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX new_hire_requests_tenant_status_idx ON public.new_hire_requests (tenant_id, status);
CREATE INDEX new_hire_requests_requested_by_idx ON public.new_hire_requests (requested_by);

ALTER TABLE public.new_hire_requests ENABLE ROW LEVEL SECURITY;

-- New tables inherit ALTER DEFAULT PRIVILEGES arwd for both anon and authenticated in this
-- project (confirmed live: this is why `employees` itself still carries a stray anon
-- INSERT/UPDATE/DELETE grant). Close writes at the GRANT level too, matching the
-- attendance_corrections/project_memberships pattern: reads stay policy-scoped, writes go
-- through the two SECURITY DEFINER RPCs below only.
REVOKE INSERT, UPDATE, DELETE ON public.new_hire_requests FROM anon, authenticated;

CREATE POLICY tenant_active_restrictive ON public.new_hire_requests AS RESTRICTIVE FOR ALL TO public
  USING (public.can_access_tenant(tenant_id));

CREATE POLICY new_hire_requests_select_own ON public.new_hire_requests FOR SELECT TO authenticated
  USING (requested_by = public.get_my_employee_id());

CREATE POLICY new_hire_requests_select_hr ON public.new_hire_requests FOR SELECT TO authenticated
  USING (public.is_hr());

-- Submit a new-hire request. Requires the Manager direct-reports authority
-- (has_access_action('employee.basic.read','direct_reports'), the same grant
-- AuthContext.tsx/canAccessTeam checks) -- a plain employee with no reports cannot call this.
CREATE OR REPLACE FUNCTION public.c1_submit_new_hire_request(
  p_name text,
  p_email text,
  p_job_title_id uuid DEFAULT NULL::uuid,
  p_proposed_date_of_joining date DEFAULT NULL::date
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_actor_name text;
  v_request uuid;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  v_actor := public.get_my_employee_id();
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_UNAVAILABLE' USING ERRCODE = 'P1002';
  END IF;

  IF NOT public.has_access_action('employee.basic.read', 'direct_reports') THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_DENIED' USING ERRCODE = 'P1003';
  END IF;

  IF NULLIF(btrim(p_name), '') IS NULL OR NULLIF(btrim(p_email), '') IS NULL THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_INPUT_INVALID' USING ERRCODE = 'P1003';
  END IF;

  IF p_job_title_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.job_titles jt WHERE jt.id = p_job_title_id AND jt.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_JOB_TITLE_INVALID' USING ERRCODE = 'P1003';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.employees WHERE id = v_actor;

  INSERT INTO public.new_hire_requests(tenant_id, requested_by, name, email, job_title_id, proposed_date_of_joining, status)
    VALUES (v_tenant, v_actor, btrim(p_name), lower(btrim(p_email)), p_job_title_id, p_proposed_date_of_joining, 'pending')
    RETURNING id INTO v_request;

  -- Notify HR, keyed on employee_id -- never notifications.user_id (FK to legacy profiles most
  -- employees lack; package-review-P3-02 §8).
  INSERT INTO public.notifications(tenant_id, employee_id, title, body, type, reference_id)
    SELECT v_tenant, e.id, 'New Hire Request',
           coalesce(v_actor_name, 'A manager') || ' requested to add ' || btrim(p_name) || ' as a new hire.',
           'general', v_request
    FROM public.employees e
    WHERE e.tenant_id = v_tenant AND public.employee_is_hr(e.id) AND e.status = 'active';

  RETURN v_request;
END;
$function$;
REVOKE ALL ON FUNCTION public.c1_submit_new_hire_request(text, text, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.c1_submit_new_hire_request(text, text, uuid, date) TO authenticated;

-- HR approves/rejects. Approval never creates the employee row itself (D3) -- HR creates it
-- through the normal onboarding flow and this call only records the decision, optionally
-- linking the resulting employee id when HR already has it at hand.
CREATE OR REPLACE FUNCTION public.c1_review_new_hire_request(
  p_request_id uuid,
  p_approved boolean,
  p_reason text DEFAULT NULL::text,
  p_created_employee_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_status text;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.is_hr() THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_REVIEW_DENIED' USING ERRCODE = 'P1003';
  END IF;
  v_actor := public.get_my_employee_id();

  IF NOT EXISTS(
    SELECT 1 FROM public.new_hire_requests r
    WHERE r.id = p_request_id AND r.tenant_id = v_tenant AND r.status = 'pending'
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_NOT_PENDING' USING ERRCODE = 'P1003';
  END IF;

  IF p_created_employee_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.employees e WHERE e.id = p_created_employee_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_EMPLOYEE_INVALID' USING ERRCODE = 'P1003';
  END IF;

  v_status := CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END;

  UPDATE public.new_hire_requests
    SET status = v_status,
        reviewed_by = v_actor,
        reviewed_at = now(),
        reason = p_reason,
        created_employee_id = CASE WHEN p_approved THEN p_created_employee_id ELSE NULL END,
        updated_at = now()
    WHERE id = p_request_id AND tenant_id = v_tenant;

  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.c1_review_new_hire_request(uuid, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.c1_review_new_hire_request(uuid, boolean, text, uuid) TO authenticated;

-- Hygiene: one pg_proc row per touched/created name (CREATE OR REPLACE with an appended
-- parameter creates a silent second overload instead of replacing -- P2-01 nearly shipped that).
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'enforce_employee_update_restrictions',
    'c1_submit_new_hire_request',
    'c1_review_new_hire_request'
  ] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C1 function overload invariant failed: %', fn;
    END IF;
  END LOOP;
END $$;
